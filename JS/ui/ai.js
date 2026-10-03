(function ljAiModule() {
  // IA del sitio: Google Gemini a través de la Cloud Function (la clave vive sólo en el servidor).
  //   LJAI.chat(payload)  → { choices: [{ message: { content } }] }  (formato chat/completions)
  //   LJAI.image(prompt)  → Blob webp comprimido, listo para subir a Storage
  const ICON_SRC = './IMG/gemini.webp';

  const proxy = () => {
    if (!window.laJamoneraProxy) throw new Error('El servicio de IA no está disponible.');
    return window.laJamoneraProxy;
  };

  const readError = async (res) => {
    const body = await res.json().catch(() => null);
    const code = body && body.error ? String(body.error) : `HTTP ${res.status}`;
    if (code === 'ia_key_missing') return new Error('La IA no está configurada. Cargá la clave de Gemini en Configuración.');
    return new Error(`IA: ${code}`);
  };

  const ready = async () => {
    if (window.laJamoneraReady) {
      try { await window.laJamoneraReady; } catch (_) { /* sin sesión: el proxy responde 401 */ }
    }
  };

  async function chat(payload) {
    await ready();
    const res = await proxy().postJson('/ia', payload || {});
    if (!res.ok) throw await readError(res);
    return res.json();
  }

  // Texto de la primera respuesta, sin cercos ```...```.
  async function chatText(payload) {
    const data = await chat(payload);
    const content = String(data?.choices?.[0]?.message?.content || '');
    return content.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  const base64ToBlob = (b64, type) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'image/png' });
  };

  // Reduce a maxSize px (lado mayor) y convierte a webp. Si el navegador no puede, devuelve el original.
  async function compress(blob, { maxSize = 512, quality = 0.85 } = {}) {
    try {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
      return out && out.size ? out : blob;
    } catch (_) {
      return blob;
    }
  }

  async function image(prompt, options) {
    await ready();
    const res = await proxy().postJson('/ia/image', { prompt: String(prompt || '') });
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    if (!data || !data.data) throw new Error('La IA no devolvió una imagen.');
    return compress(base64ToBlob(data.data, data.mimeType), options);
  }

  window.LJAI = { ICON_SRC, chat, chatText, image, compress };
})();
