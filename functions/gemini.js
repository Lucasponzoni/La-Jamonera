// Cliente de Gemini (Google Generative Language API) para la Cloud Function.
// Recibe/devuelve el formato "chat/completions" que ya usaban los módulos (messages → choices),
// así el front no cambia de forma.
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_TEXT_MODEL = 'gemini-3.8-flash';
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';

const str = (v) => String(v == null ? '' : v).trim();

// messages estilo OpenAI → { systemInstruction, contents } de Gemini.
function toGeminiRequest(body = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.filter((m) => m && m.role === 'system').map((m) => str(m.content)).filter(Boolean).join('\n\n');
  const contents = messages
    .filter((m) => m && m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: str(m.content) }] }))
    .filter((c) => c.parts[0].text);
  const generationConfig = {};
  if (Number.isFinite(Number(body.temperature))) generationConfig.temperature = Number(body.temperature);
  if (Number.isFinite(Number(body.max_tokens))) generationConfig.maxOutputTokens = Number(body.max_tokens);
  if (body.response_format && body.response_format.type === 'json_object') generationConfig.responseMimeType = 'application/json';
  const request = { contents, generationConfig };
  if (system) request.systemInstruction = { parts: [{ text: system }] };
  return request;
}

// Respuesta de Gemini → { choices: [{ message: { role, content } }], usage } (formato chat/completions).
function toChatResponse(gemini = {}, model = '') {
  const candidate = (gemini.candidates || [])[0] || {};
  const text = ((candidate.content && candidate.content.parts) || []).map((p) => p.text || '').join('');
  return {
    id: gemini.responseId || '',
    model,
    provider: 'gemini',
    choices: [{ index: 0, finish_reason: str(candidate.finishReason).toLowerCase() || 'stop', message: { role: 'assistant', content: text } }],
    usage: gemini.usageMetadata
      ? { prompt_tokens: gemini.usageMetadata.promptTokenCount || 0, completion_tokens: gemini.usageMetadata.candidatesTokenCount || 0, total_tokens: gemini.usageMetadata.totalTokenCount || 0 }
      : undefined
  };
}

async function callGemini({ apiKey, model, request, fetchImpl = fetch }) {
  const res = await fetchImpl(`${API}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(request)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (json.error && json.error.message) || `gemini_${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return json;
}

async function chat({ apiKey, model = DEFAULT_TEXT_MODEL, body, fetchImpl }) {
  const request = toGeminiRequest(body);
  // El "razonamiento" consume del límite de tokens y suma latencia: lo dejamos al mínimo.
  // Gemini 3+ usa thinkingLevel (Flash no acepta 'minimal'); 2.5 Flash usa thinkingBudget 0.
  const generation = Number((/^gemini-(\d+)/.exec(model) || [])[1] || 0);
  if (generation >= 3) request.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  else if (/flash/.test(model)) request.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const json = await callGemini({ apiKey, model, request, fetchImpl });
  return toChatResponse(json, model);
}

// Genera una imagen. Devuelve { mimeType, data (base64), text }.
async function image({ apiKey, model = DEFAULT_IMAGE_MODEL, prompt, fetchImpl }) {
  const request = {
    contents: [{ role: 'user', parts: [{ text: str(prompt) }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
  };
  const json = await callGemini({ apiKey, model, request, fetchImpl });
  const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
  const img = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!img) {
    const text = parts.map((p) => p.text || '').join(' ').trim();
    const error = new Error(text || 'gemini_no_image');
    error.status = 422;
    throw error;
  }
  return { mimeType: img.inlineData.mimeType || 'image/png', data: img.inlineData.data, text: parts.map((p) => p.text || '').join(' ').trim() };
}

// Lista los modelos de la cuenta y los separa en texto e imágenes, del más nuevo al más viejo.
// latest = el Flash estable (sin preview/lite) más nuevo de cada tipo.
const EXCLUDE_TEXT = /(image|tts|transcribe|robotics|computer-use|omni|customtools|latest|embedding|aqa)/;
const versionOf = (id) => Number((/^gemini-(\d+(?:\.\d+)?)/.exec(id) || [])[1] || 0);
const byNewest = (a, b) => (b.version - a.version) || (a.preview - b.preview) || a.id.localeCompare(b.id);

async function listModels({ apiKey, fetchImpl = fetch }) {
  const res = await fetchImpl(`${API}?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error((json.error && json.error.message) || `gemini_${res.status}`);
    error.status = res.status;
    throw error;
  }
  const all = (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => {
      const id = str(m.name).replace(/^models\//, '');
      return { id, name: str(m.displayName) || id, version: versionOf(id), preview: /preview|exp/.test(id) ? 1 : 0 };
    })
    .filter((m) => m.id.startsWith('gemini-'));
  const text = all.filter((m) => !EXCLUDE_TEXT.test(m.id)).sort(byNewest);
  const image = all.filter((m) => /-image/.test(m.id)).sort(byNewest);
  const latestText = (text.find((m) => /^gemini-[\d.]+-flash$/.test(m.id)) || text[0] || {}).id || '';
  const latestImage = (image.find((m) => /^gemini-[\d.]+-flash-image$/.test(m.id)) || image[0] || {}).id || '';
  return { text, image, latestText, latestImage };
}

const maskKey = (key) => {
  const k = str(key);
  if (!k) return '';
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••••${k.slice(-4)}`;
};

module.exports = { DEFAULT_TEXT_MODEL, DEFAULT_IMAGE_MODEL, toGeminiRequest, toChatResponse, chat, image, listModels, maskKey };
