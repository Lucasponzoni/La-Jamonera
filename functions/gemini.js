// Cliente de Gemini (Google Generative Language API) para la Cloud Function.
// Recibe/devuelve el formato "chat/completions" que ya usaban los módulos (messages → choices),
// así el front no cambia de forma al pasar de DeepSeek a Gemini.
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_TEXT_MODEL = 'gemini-2.5-flash';
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';

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
  // En Flash el "razonamiento" consume del límite de tokens y suma latencia: lo apagamos por defecto.
  if (/flash/.test(model)) request.generationConfig.thinkingConfig = { thinkingBudget: 0 };
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

const maskKey = (key) => {
  const k = str(key);
  if (!k) return '';
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••••${k.slice(-4)}`;
};

module.exports = { DEFAULT_TEXT_MODEL, DEFAULT_IMAGE_MODEL, toGeminiRequest, toChatResponse, chat, image, maskKey };
