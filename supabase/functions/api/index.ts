// @ts-nocheck
// La Jamonera · Edge Function `api` (reemplaza a la Cloud Function de Firebase con las mismas rutas).
//   GET  /me                       → { ok, uid, email, admin, role, puede_editar, puede_borrar, persona_id, activo, theme }
//   POST /ia                       → chat/completions (Gemini)               (usuario activo)
//   POST /ia/image                 → { ok, mimeType, data }                   (usuario activo)
//   POST /email                    → { ok, id }  (Resend)                     (usuario activo)
//   GET/POST /config/ai, POST /config/ai/test, GET /config/ai/models         (admin)
//   GET/POST /config/email, POST /config/email/test                          (admin)
//   POST /admin-users { action }   → ver admin-users.ts                       (admin)
//   POST /auto-egresos/run         → corrida manual (dryRun por defecto)       (admin)
//   POST /auto-egresos/cron        → corrida horaria (header x-cron-secret, lo llama pg_cron)
//   POST /bootstrap                → alta del admin inicial + secretos (token de un solo uso)
// Claves (Gemini, Resend) en Supabase Vault: sólo esta función las lee, con service_role.
import {
  admin, json, HttpError, str, EMAIL_RE, requireActive, requireAdmin, secretGet, secretSet, secretDelete,
  configGet, configPatch, maskKey, readEmailConfig, sendResend, cleanName, sha256Hex, audit, corsHeaders
} from './shared.ts';
import * as gemini from './gemini.ts';
import { handleAdminUsers } from './admin-users.ts';
import { runAutoEgresos } from './egresos.ts';

async function readAiConfig() {
  const cfg = await configGet('_ai');
  return {
    apiKey: await secretGet('gemini_api_key'),
    textModel: str(cfg.textModel) || gemini.DEFAULT_TEXT_MODEL,
    imageModel: str(cfg.imageModel) || gemini.DEFAULT_IMAGE_MODEL,
    updatedAt: Number(cfg.updatedAt || 0),
    updatedBy: str(cfg.updatedBy)
  };
}
const publicAiConfig = (cfg) => ({
  ok: true, provider: 'gemini', configured: Boolean(cfg.apiKey), keyMasked: maskKey(cfg.apiKey),
  textModel: cfg.textModel, imageModel: cfg.imageModel, updatedAt: cfg.updatedAt, updatedBy: cfg.updatedBy
});
const publicEmailConfig = (cfg) => ({
  ok: true, provider: 'resend', configured: Boolean(cfg.apiKey && cfg.fromEmail), hasKey: Boolean(cfg.apiKey),
  hasSender: Boolean(cfg.fromEmail), keyMasked: maskKey(cfg.apiKey), fromEmail: cfg.fromEmail, fromName: cfg.fromName,
  updatedAt: cfg.updatedAt, updatedBy: cfg.updatedBy
});
const readBody = async (req) => { try { return await req.json(); } catch { return {}; } };

async function route(req: Request, path: string) {
  const method = req.method;

  if (path === '/' || path === '') return { ok: true, service: 'la-jamonera-api' };

  if (path === '/me' && method === 'GET') {
    const c = await requireActive(req);
    const p = c.profile;
    return { ok: true, uid: c.user.id, email: c.user.email, admin: p.role === 'admin', role: p.role, puede_editar: p.role === 'admin' || p.puede_editar, puede_borrar: p.role === 'admin' || p.puede_borrar, persona_id: p.persona_id, activo: p.activo, theme: p.theme, mustChangePassword: Boolean(c.user.user_metadata?.must_change_password) };
  }

  if (path === '/ia' && method === 'POST') {
    await requireActive(req);
    const body = await readBody(req);
    const cfg = await readAiConfig();
    if (!cfg.apiKey) throw new HttpError(500, 'ia_key_missing');
    const model = str(body.model).startsWith('gemini') ? str(body.model) : cfg.textModel;
    return await gemini.chat({ apiKey: cfg.apiKey, model, body });
  }

  if (path === '/ia/image' && method === 'POST') {
    await requireActive(req);
    const body = await readBody(req);
    const prompt = str(body.prompt).slice(0, 2000);
    if (!prompt) throw new HttpError(400, 'prompt_required');
    const cfg = await readAiConfig();
    if (!cfg.apiKey) throw new HttpError(500, 'ia_key_missing');
    const out = await gemini.image({ apiKey: cfg.apiKey, model: cfg.imageModel, prompt });
    return { ok: true, mimeType: out.mimeType, data: out.data };
  }

  if (path === '/email' && method === 'POST') {
    await requireActive(req);
    const body = await readBody(req);
    const cfg = await readEmailConfig();
    if (!cfg.apiKey) throw new HttpError(500, 'email_key_missing');
    if (!cfg.fromEmail) throw new HttpError(500, 'email_config_incomplete');
    const to = str(body.toEmail).trim();
    if (!EMAIL_RE.test(to)) throw new HttpError(400, 'invalid_email');
    const toName = cleanName(body.toName);
    const out = await sendResend(cfg, { fromName: body.name, to: toName ? `${toName} <${to}>` : to, subject: str(body.subject).slice(0, 300), html: str(body.html) });
    return { ok: true, id: out.id || '' };
  }

  if (path === '/config/ai') {
    const c = await requireAdmin(req);
    if (method === 'GET') return publicAiConfig(await readAiConfig());
    if (method === 'POST') {
      const body = await readBody(req);
      const patch = { updatedAt: Date.now(), updatedBy: str(c.user.email || c.user.id) };
      if (str(body.apiKey).trim()) await secretSet('gemini_api_key', str(body.apiKey).trim());
      if (/^gemini-[\w.-]+$/.test(str(body.textModel))) patch.textModel = str(body.textModel);
      if (/^gemini-[\w.-]+$/.test(str(body.imageModel))) patch.imageModel = str(body.imageModel);
      await configPatch('_ai', patch, c.user.id);
      await audit(c.user.id, 'config_ai', '_ai', { keyChanged: Boolean(str(body.apiKey).trim()), textModel: patch.textModel, imageModel: patch.imageModel });
      return publicAiConfig(await readAiConfig());
    }
  }
  if (path === '/config/ai/test' && method === 'POST') {
    await requireAdmin(req);
    const cfg = await readAiConfig();
    if (!cfg.apiKey) throw new HttpError(400, 'ia_key_missing');
    const t0 = Date.now();
    const out = await gemini.chat({ apiKey: cfg.apiKey, model: cfg.textModel, body: { messages: [{ role: 'user', content: 'Respondé sólo: OK' }], temperature: 0, max_tokens: 20 } });
    return { ok: true, ms: Date.now() - t0, model: cfg.textModel, reply: out.choices[0].message.content };
  }
  if (path === '/config/ai/models' && method === 'GET') {
    await requireAdmin(req);
    const cfg = await readAiConfig();
    if (!cfg.apiKey) throw new HttpError(400, 'ia_key_missing');
    const out = await gemini.listModels({ apiKey: cfg.apiKey });
    return { ok: true, ...out, current: { textModel: cfg.textModel, imageModel: cfg.imageModel } };
  }

  if (path === '/config/email') {
    const c = await requireAdmin(req);
    if (method === 'GET') return publicEmailConfig(await readEmailConfig());
    if (method === 'POST') {
      const body = await readBody(req);
      const apiKey = str(body.apiKey).trim();
      const fromEmail = str(body.fromEmail).trim();
      if (apiKey && !/^re_\w{8,}/.test(apiKey)) throw new HttpError(400, 'invalid_key');
      if (fromEmail && !EMAIL_RE.test(fromEmail)) throw new HttpError(400, 'invalid_email');
      const patch = { updatedAt: Date.now(), updatedBy: str(c.user.email || c.user.id) };
      if (apiKey) await secretSet('resend_api_key', apiKey);
      if (fromEmail) patch.fromEmail = fromEmail;
      if (cleanName(body.fromName)) patch.fromName = cleanName(body.fromName).slice(0, 80);
      await configPatch('_email', patch, c.user.id);
      await audit(c.user.id, 'config_email', '_email', { keyChanged: Boolean(apiKey), fromEmail: patch.fromEmail });
      return publicEmailConfig(await readEmailConfig());
    }
  }
  if (path === '/config/email/test' && method === 'POST') {
    const c = await requireAdmin(req);
    const cfg = await readEmailConfig();
    if (!cfg.apiKey) throw new HttpError(400, 'email_key_missing');
    if (!cfg.fromEmail) throw new HttpError(400, 'email_config_incomplete');
    const to = str(c.user.email);
    if (!EMAIL_RE.test(to)) throw new HttpError(400, 'invalid_email');
    const out = await sendResend(cfg, { fromName: cfg.fromName, to, subject: 'Prueba de correo · La Jamonera', html: '<p>Este es un correo de prueba enviado desde <strong>Configuración</strong> de La Jamonera.</p><p>Si lo recibiste, el envío por Resend funciona.</p>' });
    return { ok: true, id: out.id || '', to };
  }

  if (path === '/admin-users' && method === 'POST') {
    const c = await requireAdmin(req);
    return await handleAdminUsers(c, await readBody(req));
  }

  if (path === '/auto-egresos/run' && method === 'POST') {
    await requireAdmin(req);
    const body = await readBody(req);
    const dryRun = body.dryRun !== false;
    const summary = await runAutoEgresos({ dryRun, onlyIngredients: Array.isArray(body.ingredientes) ? body.ingredientes.map(String) : undefined, aiChat: body.ai === false ? null : undefined });
    if (dryRun && body.full !== true) summary.lots = summary.lots.slice(0, 50);
    return { ok: true, dryRun, summary };
  }

  if (path === '/auto-egresos/cron' && method === 'POST') {
    const secret = await secretGet('cron_secret');
    if (!secret || req.headers.get('x-cron-secret') !== secret) throw new HttpError(403, 'cron_forbidden');
    const summary = await runAutoEgresos({ dryRun: false });
    summary.lots = summary.lots.length;
    return { ok: true, summary };
  }

  if (path === '/bootstrap' && method === 'POST') {
    // Alta del administrador inicial y carga de secretos desde Firebase. Token de un solo uso:
    // en Vault sólo está su sha256; al terminar se borra y la ruta queda inutilizable.
    const body = await readBody(req);
    const expected = await secretGet('bootstrap_token_sha256');
    if (!expected || (await sha256Hex(str(body.token))) !== expected) throw new HttpError(403, 'bootstrap_forbidden');
    const out = { ok: true, steps: [] };
    if (body.ai && str(body.ai.apiKey)) {
      await secretSet('gemini_api_key', str(body.ai.apiKey));
      await configPatch('_ai', { textModel: str(body.ai.textModel) || gemini.DEFAULT_TEXT_MODEL, imageModel: str(body.ai.imageModel) || gemini.DEFAULT_IMAGE_MODEL, updatedAt: Number(body.ai.updatedAt) || Date.now(), updatedBy: str(body.ai.updatedBy) || 'migración' });
      out.steps.push('ai');
    }
    if (body.email) {
      if (str(body.email.apiKey)) await secretSet('resend_api_key', str(body.email.apiKey));
      const patch = { updatedAt: Number(body.email.updatedAt) || Date.now(), updatedBy: str(body.email.updatedBy) || 'migración' };
      if (EMAIL_RE.test(str(body.email.fromEmail))) patch.fromEmail = str(body.email.fromEmail);
      if (cleanName(body.email.fromName)) patch.fromName = cleanName(body.email.fromName);
      await configPatch('_email', patch);
      out.steps.push(`email${str(body.email.apiKey) ? '+key' : ''}`);
    }
    if (body.adminUser) {
      const email = str(body.adminUser.email).toLowerCase();
      const password = str(body.adminUser.password);
      if (!EMAIL_RE.test(email) || password.length < 6) throw new HttpError(400, 'admin_invalido');
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      let user = (list?.users || []).find((u) => String(u.email).toLowerCase() === email);
      if (!user) {
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nombre: str(body.adminUser.nombre) || 'La Jamonera' } });
        if (error) throw new HttpError(400, error.message);
        user = data.user;
        out.steps.push('admin_creado');
      } else {
        await admin.auth.admin.updateUserById(user.id, { password, ban_duration: 'none' });
        out.steps.push('admin_actualizado');
      }
      const theme = ['light', 'dark'].includes(str(body.adminUser.theme)) ? str(body.adminUser.theme) : null;
      const { error: pErr } = await admin.from('profiles').upsert({ id: user.id, email, nombre: str(body.adminUser.nombre) || 'La Jamonera', role: 'admin', puede_editar: true, puede_borrar: true, activo: true, theme, updated_at: new Date().toISOString() });
      if (pErr) throw new HttpError(500, pErr.message);
      await audit(user.id, 'bootstrap_admin', user.id, { email });
      out.adminUserId = user.id;
    }
    if (body.finish === true) { await secretDelete('bootstrap_token_sha256'); out.steps.push('token_borrado'); }
    return out;
  }

  throw new HttpError(404, 'not_found');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(functions\/v1\/)?api/, '').replace(/\/+$/, '') || '/';
  try {
    return json(req, await route(req, path));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : (error?.status >= 400 && error?.status < 600 ? error.status : 500);
    if (status >= 500) console.error(path, error?.message);
    return json(req, { ok: false, error: error?.message || 'error' }, status);
  }
});
