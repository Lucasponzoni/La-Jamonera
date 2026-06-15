/**
 * La Jamonera - Cloud Functions proxy (reemplazo de cors.sh)
 *
 * Una sola function HTTP (Express) con 3 rutas:
 *   POST /email   -> envia mail via MailUp SMTP+ (credenciales server-side)
 *   POST /ia      -> proxy a DeepSeek chat/completions (API key server-side)
 *   GET  /image   -> descarga una imagen de Firebase Storage con cabeceras CORS
 *
 * Seguridad:
 *   - Todas las rutas exigen un Firebase ID token valido (Authorization: Bearer ...).
 *   - Las credenciales (MailUp / DeepSeek) se leen de RTDB con el Admin SDK,
 *     nunca viajan al navegador.
 *   - /image solo acepta URLs de Firebase Storage (evita open-proxy / SSRF).
 */

const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

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

// --- POST /ia : DeepSeek chat/completions ---
app.post('/ia', requireAuth, async (req, res) => {
  try {
    const node = (await db().ref('/deepseek/apiKey').once('value')).val();
    const apiKey = typeof node === 'string' ? str(node) : str(node && node.apiKey);
    if (!apiKey) return res.status(500).json({ ok: false, error: 'ia_key_missing' });

    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(req.body || {})
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (error) {
    console.error('ia error:', error);
    return res.status(500).json({ ok: false, error: error.message });
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

exports.api = onRequest({ timeoutSeconds: 60, memory: '512MiB' }, app);
