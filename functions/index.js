/**
 * La Jamonera - Cloud Functions proxy (reemplazo de cors.sh)
 *
 * Una sola function HTTP (Express):
 *   POST /email       -> envía un correo con Resend (clave server-side)
 *   GET/POST /config/email, POST /config/email/test -> configuración de correo (clave enmascarada)
 *   POST /ia          -> chat con Google Gemini (formato chat/completions; API key server-side)
 *   POST /ia/image    -> genera una imagen con Gemini (base64)
 *   GET/POST /config/ai, POST /config/ai/test -> configuración de IA (clave enmascarada)
 *   GET  /image   -> descarga una imagen de Firebase Storage con cabeceras CORS
 *   GET  /me      -> uid, email y si es administrador
 *   POST /auto-egresos/run -> corrida manual de auto-egresos (admin; dryRun por defecto)
 * /config/* y /auto-egresos/run exigen administrador (ver isAdminUser).
 *
 * Seguridad:
 *   - Todas las rutas exigen un Firebase ID token valido (Authorization: Bearer ...).
 *   - Las credenciales (Resend / Gemini) se leen de RTDB con el Admin SDK,
 *     nunca viajan al navegador.
 *   - /image solo acepta URLs de Firebase Storage (evita open-proxy / SSRF).
 */

const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const gemini = require('./gemini');
const autoEgresosModule = require('./auto-egresos');

admin.initializeApp({
  databaseURL: 'https://fg-lj-d6325-default-rtdb.firebaseio.com'
});

// Region cercana a Argentina. maxInstances acota costo ante picos.
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

const ALLOWED_ORIGINS = [
  'https://www.lajamonera.online',
  'https://lajamonera.online',
  'https://lucasponzoni.github.io'
];

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // peticiones sin Origin (server-to-server, curl)
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  return false;
};

const str = (value) => (value === undefined || value === null ? '' : String(value));
const db = () => admin.database();

const app = express();
app.use(cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: false }));
app.use(express.json({ limit: '20mb' }));

// --- Middleware de autenticacion (Firebase ID token) ---
const requireAuth = async (req, res, next) => {
  try {
    const header = req.get('Authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ ok: false, error: 'missing_token' });
    req.user = await admin.auth().verifyIdToken(match[1]);
    return next();
  } catch (error) {
    console.warn('auth fallo:', error.message);
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }
};

// --- IA: Google Gemini ---
// La configuración vive en RTDB /_secure/ai (sólo la lee/escribe esta function con el Admin SDK;
// el navegador nunca recibe la clave). Fallback: variable de entorno GEMINI_API_KEY.
const AI_PATH = '/_secure/ai';
const readAiConfig = async () => {
  const cfg = (await db().ref(AI_PATH).once('value')).val() || {};
  return {
    apiKey: str(cfg.apiKey) || str(process.env.GEMINI_API_KEY),
    textModel: str(cfg.textModel) || gemini.DEFAULT_TEXT_MODEL,
    imageModel: str(cfg.imageModel) || gemini.DEFAULT_IMAGE_MODEL,
    updatedAt: Number(cfg.updatedAt || 0),
    updatedBy: str(cfg.updatedBy)
  };
};
const publicAiConfig = (cfg) => ({
  ok: true,
  provider: 'gemini',
  configured: Boolean(cfg.apiKey),
  keyMasked: gemini.maskKey(cfg.apiKey),
  textModel: cfg.textModel,
  imageModel: cfg.imageModel,
  updatedAt: cfg.updatedAt,
  updatedBy: cfg.updatedBy
});
const aiError = (res, error, label) => {
  console.error(`${label} error:`, error.message);
  const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
  return res.status(status).json({ ok: false, error: error.message });
};

// --- Administradores ---
// No hay roles en la app: los administradores se declaran sólo del lado del servidor, con
//   - custom claim { admin: true } en Firebase Auth, o
//   - RTDB /_secure/admins/{uid} = true (se carga desde la consola de Firebase), o
//   - variable de entorno ADMIN_UIDS="uid1,uid2".
// Nunca se confía en el cliente: el uid sale del ID token verificado.
const ADMINS_PATH = '/_secure/admins';
const isAdminUser = async (user) => {
  if (!user || !user.uid) return false;
  if (user.admin === true) return true;
  const envList = str(process.env.ADMIN_UIDS).split(',').map((v) => v.trim()).filter(Boolean);
  if (envList.includes(user.uid)) return true;
  const flag = (await db().ref(`${ADMINS_PATH}/${user.uid}`).once('value')).val();
  return flag === true;
};
const requireAdmin = async (req, res, next) => {
  try {
    if (await isAdminUser(req.user)) return next();
    return res.status(403).json({ ok: false, error: 'admin_required' });
  } catch (error) {
    console.error('admin check fallo:', error.message);
    return res.status(500).json({ ok: false, error: 'admin_check_failed' });
  }
};

// GET /me : quién es el usuario y si es administrador (para mostrar u ocultar Configuración)
app.get('/me', requireAuth, async (req, res) => {
  try {
    return res.json({ ok: true, uid: req.user.uid, email: str(req.user.email), admin: await isAdminUser(req.user) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// --- Correo: Resend ---
// Configuración en RTDB /_secure/email { apiKey, fromEmail, fromName } (sólo Admin SDK).
// Fallback: variable de entorno RESEND_API_KEY.
const EMAIL_PATH = '/_secure/email';
const RESEND_URL = 'https://api.resend.com/emails';
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const readEmailConfig = async () => {
  const cfg = (await db().ref(EMAIL_PATH).once('value')).val() || {};
  return {
    apiKey: str(cfg.apiKey) || str(process.env.RESEND_API_KEY),
    fromEmail: str(cfg.fromEmail),
    fromName: str(cfg.fromName) || 'La Jamonera',
    updatedAt: Number(cfg.updatedAt || 0),
    updatedBy: str(cfg.updatedBy)
  };
};
const publicEmailConfig = (cfg) => ({
  ok: true,
  provider: 'resend',
  configured: Boolean(cfg.apiKey && cfg.fromEmail),
  hasKey: Boolean(cfg.apiKey),
  hasSender: Boolean(cfg.fromEmail),
  keyMasked: gemini.maskKey(cfg.apiKey),
  fromEmail: cfg.fromEmail,
  fromName: cfg.fromName,
  updatedAt: cfg.updatedAt,
  updatedBy: cfg.updatedBy
});
// Quita comillas y signos que romperían el encabezado "Nombre <correo>".
const cleanName = (value) => str(value).replace(/["<>\r\n]/g, '').trim();

const sendResend = async (cfg, { fromName, to, subject, html }) => {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ from: `${cleanName(fromName) || cfg.fromName} <${cfg.fromEmail}>`, to: [to], subject, html })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(json.message || json.name || `resend_${res.status}`);
    error.status = res.status;
    throw error;
  }
  return json;
};

// POST /email : { name, subject, html, toName, toEmail } → { ok, id }
app.post('/email', requireAuth, async (req, res) => {
  try {
    const cfg = await readEmailConfig();
    if (!cfg.apiKey) return res.status(500).json({ ok: false, error: 'email_key_missing' });
    if (!cfg.fromEmail) return res.status(500).json({ ok: false, error: 'email_config_incomplete' });
    const body = req.body || {};
    const to = str(body.toEmail).trim();
    if (!EMAIL_RE.test(to)) return res.status(400).json({ ok: false, error: 'invalid_email' });
    const toName = cleanName(body.toName);
    const out = await sendResend(cfg, {
      fromName: body.name,
      to: toName ? `${toName} <${to}>` : to,
      subject: str(body.subject).slice(0, 300),
      html: str(body.html)
    });
    return res.json({ ok: true, id: out.id || '' });
  } catch (error) {
    return aiError(res, error, 'email');
  }
});

// GET /config/email : estado (clave enmascarada)
app.get('/config/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    return res.json(publicEmailConfig(await readEmailConfig()));
  } catch (error) {
    return aiError(res, error, 'config/email');
  }
});

// POST /config/email : { apiKey?, fromEmail?, fromName? } (apiKey vacío = no cambiar)
app.post('/config/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const apiKey = str(body.apiKey).trim();
    const fromEmail = str(body.fromEmail).trim();
    if (apiKey && !/^re_\w{8,}/.test(apiKey)) return res.status(400).json({ ok: false, error: 'invalid_key' });
    if (fromEmail && !EMAIL_RE.test(fromEmail)) return res.status(400).json({ ok: false, error: 'invalid_email' });
    const patch = { updatedAt: Date.now(), updatedBy: str(req.user && (req.user.email || req.user.uid)) };
    if (apiKey) patch.apiKey = apiKey;
    if (fromEmail) patch.fromEmail = fromEmail;
    if (cleanName(body.fromName)) patch.fromName = cleanName(body.fromName).slice(0, 80);
    await db().ref(EMAIL_PATH).update(patch);
    return res.json(publicEmailConfig(await readEmailConfig()));
  } catch (error) {
    return aiError(res, error, 'config/email');
  }
});

// POST /config/email/test : manda un correo de prueba al usuario logueado
app.post('/config/email/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cfg = await readEmailConfig();
    if (!cfg.apiKey) return res.status(400).json({ ok: false, error: 'email_key_missing' });
    if (!cfg.fromEmail) return res.status(400).json({ ok: false, error: 'email_config_incomplete' });
    const to = str(req.user && req.user.email);
    if (!EMAIL_RE.test(to)) return res.status(400).json({ ok: false, error: 'invalid_email' });
    const out = await sendResend(cfg, {
      fromName: cfg.fromName,
      to,
      subject: 'Prueba de correo · La Jamonera',
      html: '<p>Este es un correo de prueba enviado desde <strong>Configuración</strong> de La Jamonera.</p><p>Si lo recibiste, el envío por Resend funciona.</p>'
    });
    return res.json({ ok: true, id: out.id || '', to });
  } catch (error) {
    return aiError(res, error, 'config/email/test');
  }
});

// POST /ia : chat (mismo formato chat/completions que usaban los módulos)
app.post('/ia', requireAuth, async (req, res) => {
  try {
    const cfg = await readAiConfig();
    if (!cfg.apiKey) return res.status(500).json({ ok: false, error: 'ia_key_missing' });
    const model = str(req.body && req.body.model).startsWith('gemini') ? str(req.body.model) : cfg.textModel;
    return res.json(await gemini.chat({ apiKey: cfg.apiKey, model, body: req.body || {} }));
  } catch (error) {
    return aiError(res, error, 'ia');
  }
});

// POST /ia/image : { prompt } → { ok, mimeType, data (base64) }
app.post('/ia/image', requireAuth, async (req, res) => {
  try {
    const prompt = str(req.body && req.body.prompt).slice(0, 2000);
    if (!prompt) return res.status(400).json({ ok: false, error: 'prompt_required' });
    const cfg = await readAiConfig();
    if (!cfg.apiKey) return res.status(500).json({ ok: false, error: 'ia_key_missing' });
    const out = await gemini.image({ apiKey: cfg.apiKey, model: cfg.imageModel, prompt });
    return res.json({ ok: true, mimeType: out.mimeType, data: out.data });
  } catch (error) {
    return aiError(res, error, 'ia/image');
  }
});

// GET /config/ai : estado de la configuración (clave enmascarada)
app.get('/config/ai', requireAuth, requireAdmin, async (req, res) => {
  try {
    return res.json(publicAiConfig(await readAiConfig()));
  } catch (error) {
    return aiError(res, error, 'config/ai');
  }
});

// POST /config/ai : { apiKey?, textModel?, imageModel? } (apiKey vacío = no cambiar)
app.post('/config/ai', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const patch = { updatedAt: Date.now(), updatedBy: str(req.user && (req.user.email || req.user.uid)) };
    if (str(body.apiKey)) patch.apiKey = str(body.apiKey).trim();
    if (/^gemini-[\w.-]+$/.test(str(body.textModel))) patch.textModel = str(body.textModel);
    if (/^gemini-[\w.-]+$/.test(str(body.imageModel))) patch.imageModel = str(body.imageModel);
    await db().ref(AI_PATH).update(patch);
    return res.json(publicAiConfig(await readAiConfig()));
  } catch (error) {
    return aiError(res, error, 'config/ai');
  }
});

// POST /config/ai/test : prueba de conexión con un pedido mínimo
app.post('/config/ai/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cfg = await readAiConfig();
    if (!cfg.apiKey) return res.status(400).json({ ok: false, error: 'ia_key_missing' });
    const t0 = Date.now();
    const out = await gemini.chat({ apiKey: cfg.apiKey, model: cfg.textModel, body: { messages: [{ role: 'user', content: 'Respondé sólo: OK' }], temperature: 0, max_tokens: 5 } });
    return res.json({ ok: true, ms: Date.now() - t0, model: cfg.textModel, reply: out.choices[0].message.content });
  } catch (error) {
    return aiError(res, error, 'config/ai/test');
  }
});

// --- GET /image?url=... : proxy de imagenes de Firebase Storage ---
const isStorageUrl = (url) =>
  /^https:\/\/(firebasestorage\.googleapis\.com|[a-z0-9.-]+\.firebasestorage\.app)\//i.test(url);

app.get('/image', requireAuth, async (req, res) => {
  try {
    const url = str(req.query.url);
    if (!isStorageUrl(url)) return res.status(400).json({ ok: false, error: 'invalid_url' });

    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(upstream.status).json({ ok: false, error: `upstream_${upstream.status}` });

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  } catch (error) {
    console.error('image error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// --- POST /auto-egresos/run : corrida manual (por defecto dryRun: calcula sin escribir) ---
app.post('/auto-egresos/run', requireAuth, requireAdmin, async (req, res) => {
  try {
    const dryRun = !(req.body && req.body.dryRun === false);
    const summary = await autoEgresosModule.runAutoEgresos({ db: db(), dryRun });
    return res.json({ ok: true, dryRun, summary });
  } catch (error) {
    return aiError(res, error, 'auto-egresos/run');
  }
});

// --- healthcheck ---
app.get('/', (req, res) => res.json({ ok: true, service: 'la-jamonera-proxy' }));

exports.api = onRequest({ timeoutSeconds: 300, memory: '512MiB' }, app);

// Auto-egresos "Venta en mostrador": programada cada hora (reemplaza al Apps Script).
exports.autoEgresos = autoEgresosModule.autoEgresos;
