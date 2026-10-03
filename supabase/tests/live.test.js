// Pruebas en vivo de la Edge Function api. No imprime claves.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const cfg = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, '.la-jamonera-supabase-local.json'), 'utf8'));
const API = `${cfg.url}/functions/v1/api`;
const signIn = async (email, password) => {
  const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json(); return { status: r.status, token: j.access_token, error: j.error_description || j.msg || j.error_code };
};
const call = async (method, p, token, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j; try { j = await r.json(); } catch { j = null; } return { status: r.status, json: j };
};
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'OK ' : 'FALLA'} ${name}${extra ? ' · ' + extra : ''}`); if (!cond) process.exitCode = 1; };
(async () => {
  const STEP = process.argv[2] || 'all';
  let r = await call('GET', '/me', null); ok('sin JWT → 401', r.status === 401, r.status);
  r = await call('GET', '/me', cfg.anonKey); ok('JWT anon (no usuario) → 401', r.status === 401, JSON.stringify(r.json));
  const adm = await signIn('lajamonera@abr.com', process.env.LJ_ADMIN_PASS); ok('login admin', adm.status === 200, adm.error || '');
  r = await call('GET', '/me', adm.token); ok('/me admin', r.json?.admin === true && r.json?.role === 'admin', JSON.stringify({ role: r.json?.role, theme: r.json?.theme }));
  r = await call('GET', '/config/ai', adm.token); ok('/config/ai', r.json?.configured === true && /•/.test(String(r.json?.keyMasked || '')) && !(process.env.GEMINI_KEY && JSON.stringify(r.json).includes(process.env.GEMINI_KEY)), `${r.json?.keyMasked} ${r.json?.textModel} ${r.json?.imageModel}`);
  r = await call('POST', '/config/ai/test', adm.token); ok('/config/ai/test', r.json?.ok === true, `${r.json?.ms}ms "${r.json?.reply}"`);
  r = await call('GET', '/config/ai/models', adm.token); ok('/config/ai/models', r.json?.ok && r.json.text.length > 0, `${r.json?.latestText} / ${r.json?.latestImage}`);
  r = await call('GET', '/config/email', adm.token); ok('/config/email', r.json?.ok === true, JSON.stringify({ configured: r.json?.configured, hasKey: r.json?.hasKey, hasSender: r.json?.hasSender, keyMasked: r.json?.keyMasked, fromName: r.json?.fromName }));
  r = await call('POST', '/config/ai', adm.token, { textModel: 'evil; drop' }); ok('/config/ai modelo inválido ignorado', r.json?.textModel === 'gemini-3.8-flash', r.json?.textModel);
  r = await call('POST', '/ia', adm.token, { messages: [{ role: 'system', content: 'Respondé en JSON {"color":string}' }, { role: 'user', content: 'color del cielo' }], response_format: { type: 'json_object' } });
  ok('/ia chat', r.status === 200 && /color/.test(r.json?.choices?.[0]?.message?.content || ''), `${r.json?.model} ${r.json?.choices?.[0]?.message?.content}`);
  if (STEP === 'all' || STEP === 'image') {
    const t0 = Date.now(); r = await call('POST', '/ia/image', adm.token, { prompt: 'Ícono estilo emoji 3D de un frasco de orégano, fondo blanco liso' });
    ok('/ia/image', r.json?.ok && r.json.data?.length > 1000, `${r.json?.mimeType} ${Math.round((r.json?.data?.length || 0) * 0.75 / 1024)}KB ${Date.now() - t0}ms`);
  }
  r = await call('POST', '/ia/image', adm.token, { prompt: '' }); ok('/ia/image sin prompt → 400', r.status === 400);
  r = await call('POST', '/email', adm.token, { toEmail: 'no-es-email', subject: 'x', html: 'x' }); ok('/email inválido → 400', r.status === 400, JSON.stringify(r.json));
  r = await call('POST', '/bootstrap', cfg.anonKey, { token: 'malo' }); ok('/bootstrap token malo → 403', r.status === 403);
  r = await call('POST', '/auto-egresos/cron', cfg.anonKey, {}); ok('/auto-egresos/cron sin secreto → 403', r.status === 403);
  r = await call('GET', '/nada', adm.token); ok('ruta inexistente → 404', r.status === 404);
  fs.writeFileSync(path.join(__dirname, '.adm-token'), adm.token);
})().catch((e) => { console.error('FALLA', e.message); process.exit(1); });
