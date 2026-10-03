/**
 * La Jamonera - Cloud Functions proxy (reemplazo de cors.sh)
 *
 * Una sola function HTTP (Express) con 3 rutas:
 *   POST /email   -> envia mail via MailUp SMTP+ (credenciales server-side)
 *   POST /ia          -> chat con Google Gemini (formato chat/completions; API key server-side)
 *   POST /ia/image    -> genera una imagen con Gemini (base64)
 *   GET/POST /config/ai, POST /config/ai/test -> configuración de IA (clave enmascarada)
 *   GET  /image   -> descarga una imagen de Firebase Storage con cabeceras CORS
 *
 * Seguridad:
 *   - Todas las rutas exigen un Firebase ID token valido (Authorization: Bearer ...).
 *   - Las credenciales (MailUp / Gemini) se leen de RTDB con el Admin SDK,
 *     nunca viajan al navegador.
 *   - /image solo acepta URLs de Firebase Storage (evita open-proxy / SSRF).
 */

const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const gemini = require('./gemini');

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

// --- POST /email : MailUp SMTP+ sendmessage ---
app.post('/email', requireAuth, async (req, res) => {
  try {
    const cfg = (await db().ref('/email_sender').once('value')).val() || {};
    const username = str(cfg.SMTP_USERNAME_E3);
    const secret = str(cfg.SMTP_SECRET_E3);
    if (!username || !secret) {
      return res.status(500).json({ ok: false, error: 'email_config_incomplete' });
    }

    // Endpoint MailUp directo (sin envoltura cors.sh, por si quedo guardada).
    let endpoint = str(cfg.EMAIL_API_URL_E3) || 'https://send.mailup.com/API/v2.0/messages/sendmessage';
    endpoint = endpoint.replace(/^https?:\/\/proxy\.cors\.sh\//i, '');

    const fromName = str(req.body.name) || str(cfg.EMAIL_FROM_NAME_E3) || 'Novogar';
    const fromEmail = str(cfg.EMAIL_FROM_ADDRESS_E3) || 'posventa@novogar.com.ar';
    const charset = str(cfg.EMAIL_CHARSET_E3) || 'utf-8';

    const emailData = {
      Html: { DocType: null, Head: null, Body: str(req.body.html), BodyTag: '<body>' },
      Text: '',
      Subject: str(req.body.subject),
      From: { Name: fromName, Email: fromEmail },
      To: [{ Name: str(req.body.toName), Email: str(req.body.toEmail) }],
      ReplyTo: null,
      CharSet: charset,
      ExtendedHeaders: null,
      Attachments: null,
      EmbeddedImages: [],
      XSmtpAPI: {
        CampaignName: 'Test Campaign',
        CampaignCode: '1001',
        Header: false,
        Footer: true,
        ClickTracking: null,
        ViewTracking: null,
        Priority: null,
        Schedule: null,
        DynamicFields: [],
        CampaignReport: null,
        SkipDynamicFields: null
      },
      User: { Username: username, Secret: secret }
    };

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailData)
    });
    const result = await upstream.json().catch(() => null);
    return res.status(200).json({ ok: result?.Status === 'done', result });
  } catch (error) {
    console.error('email error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

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
app.get('/config/ai', requireAuth, async (req, res) => {
  try {
    return res.json(publicAiConfig(await readAiConfig()));
  } catch (error) {
    return aiError(res, error, 'config/ai');
  }
});

// POST /config/ai : { apiKey?, textModel?, imageModel? } (apiKey vacío = no cambiar)
app.post('/config/ai', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const patch = { updatedAt: Date.now(), updatedBy: str(req.user && (req.user.email || req.user.uid)) };
    if (str(body.apiKey)) patch.apiKey = str(body.apiKey).trim();
    if (/^gemini-[w.-]+$/.test(str(body.textModel))) patch.textModel = str(body.textModel);
    if (/^gemini-[w.-]+$/.test(str(body.imageModel))) patch.imageModel = str(body.imageModel);
    await db().ref(AI_PATH).update(patch);
    return res.json(publicAiConfig(await readAiConfig()));
  } catch (error) {
    return aiError(res, error, 'config/ai');
  }
});

// POST /config/ai/test : prueba de conexión con un pedido mínimo
app.post('/config/ai/test', requireAuth, async (req, res) => {
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

// --- healthcheck ---
app.get('/', (req, res) => res.json({ ok: true, service: 'la-jamonera-proxy' }));

exports.api = onRequest({ timeoutSeconds: 120, memory: '512MiB' }, app);
