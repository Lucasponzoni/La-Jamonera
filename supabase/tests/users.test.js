// Pruebas en vivo de /admin-users, permisos del empleado y RLS. No imprime claves.
const fs = require('fs'); const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, '.la-jamonera-supabase-local.json'), 'utf8'));
const API = `${cfg.url}/functions/v1/api`;
const signIn = async (email, password) => { const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); const j = await r.json(); return { status: r.status, token: j.access_token, error: j.error_description || j.msg || j.error_code }; };
const call = async (method, p, token, body) => { const r = await fetch(`${API}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j; try { j = await r.json(); } catch { j = null; } return { status: r.status, json: j }; };
const rest = (method, p, token, body) => fetch(`${cfg.url}/rest/v1/${p}`, { method, headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined }).then(async (x) => ({ status: x.status, json: await x.json().catch(() => null) }));
const AU = (token, body) => call('POST', '/admin-users', token, body);
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'OK ' : 'FALLA'} ${name}${extra ? ' · ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const EMP = 'empleado.prueba@test.lajamonera.invalid';

(async () => {
  const adm = await signIn('lajamonera@abr.com', process.env.LJ_ADMIN_PASS);
  const A = adm.token;
  let r = await AU(A, { action: 'list' });
  const self = (r.json && r.json.loginsSinPersona || [])[0];
  ok('list', r.json && r.json.ok && r.json.personas.length >= 9, `${r.json && r.json.personas.length} personas · admin sin persona: ${self && self.email}`);
  r = await AU(A, { action: 'grantAccess', personaId: 'test_sb_emp', role: 'empleado', puedeEditar: false, puedeBorrar: false, mode: 'password', tempPassword: 'Prueba-1234' });
  ok('grantAccess password', r.json && r.json.ok && r.json.estado === 'activa', JSON.stringify(r.json));
  r = await AU(A, { action: 'grantAccess', personaId: 'test_sb_emp', role: 'empleado', mode: 'password' });
  ok('grantAccess repetido → 409', r.status === 409, r.json && r.json.error);
  const emp = await signIn(EMP, 'Prueba-1234'); ok('login empleado', emp.status === 200, emp.error || '');
  r = await call('GET', '/me', emp.token);
  ok('/me empleado', r.json && r.json.role === 'empleado' && r.json.puede_editar === false && r.json.puede_borrar === false && r.json.mustChangePassword === true, JSON.stringify(r.json));
  r = await call('GET', '/config/ai', emp.token); ok('empleado /config/ai → 403', r.status === 403, r.json && r.json.error);
  r = await call('POST', '/config/email', emp.token, { fromEmail: 'x@y.com' }); ok('empleado POST /config/email → 403', r.status === 403);
  r = await AU(emp.token, { action: 'list' }); ok('empleado /admin-users → 403', r.status === 403);
  r = await call('POST', '/auto-egresos/run', emp.token, {}); ok('empleado /auto-egresos/run → 403', r.status === 403);
  r = await call('POST', '/ia', emp.token, { messages: [{ role: 'user', content: 'Decí OK' }] }); ok('empleado /ia permitido', r.status === 200);

  let q = await rest('GET', 'ingredientes?select=id&limit=1', emp.token); ok('RLS empleado lee', q.status === 200 && q.json.length === 1);
  const ingId = q.json[0].id;
  q = await rest('PATCH', `ingredientes?id=eq.${ingId}`, emp.token, { updated_at: new Date().toISOString() });
  ok('RLS empleado sin editar: 0 filas', q.status === 200 && q.json.length === 0, `status ${q.status} filas ${q.json && q.json.length}`);
  q = await rest('GET', 'personas?select=pin_hash&limit=1', emp.token); ok('pin_hash no legible', q.status >= 400, `status ${q.status}`);
  r = await AU(A, { action: 'setPermisos', personaId: 'test_sb_emp', puedeEditar: true, puedeBorrar: false }); ok('setPermisos', r.json && r.json.ok);
  q = await rest('PATCH', `ingredientes?id=eq.${ingId}`, emp.token, { updated_at: new Date().toISOString() });
  ok('RLS con editar: 1 fila', q.status === 200 && q.json.length === 1, `filas ${q.json && q.json.length}`);

  r = await AU(A, { action: 'setRole', userId: self.userId, role: 'empleado' }); ok('último admin no deja de serlo → 409', r.status === 409, r.json && r.json.error);
  r = await AU(A, { action: 'setActive', userId: self.userId, activo: false }); ok('admin no se desactiva → 409', r.status === 409, r.json && r.json.error);
  r = await AU(A, { action: 'setActive', personaId: 'test_sb_emp', activo: false }); ok('setActive false', r.json && r.json.ok, JSON.stringify(r.json));
  const banned = await signIn(EMP, 'Prueba-1234'); ok('desactivado no entra', banned.status !== 200, banned.error || banned.status);
  r = await call('GET', '/me', emp.token); ok('token viejo de desactivado → 403/401', r.status === 403 || r.status === 401, r.status);
  r = await AU(A, { action: 'setActive', personaId: 'test_sb_emp', activo: true }); ok('setActive true', r.json && r.json.ok);
  r = await AU(A, { action: 'resetPassword', personaId: 'test_sb_emp', mode: 'temp', tempPassword: 'Otra-56789' }); ok('resetPassword temp', r.json && r.json.tempPassword === 'Otra-56789');
  const emp2 = await signIn(EMP, 'Otra-56789'); ok('login con nueva temporal', emp2.status === 200, emp2.error || '');

  r = await AU(A, { action: 'getTemplate' }); ok('getTemplate default', r.json && r.json.isDefault === true && /\{\{link\}\}/.test(r.json.html));
  r = await AU(A, { action: 'saveTemplate', asunto: 'Hola {{nombre}}', html: '<p>sin link</p>' }); ok('saveTemplate sin {{link}} → 400', r.status === 400, r.json && r.json.error);
  r = await AU(A, { action: 'saveTemplate', asunto: 'Hola {{nombre}}', html: '<p onclick="x()">Hola {{nombre}} <a href="javascript:alert(1)">x</a><script>alert(1)</script> <a href="{{link}}">Activar</a></p>' });
  ok('saveTemplate sanea', r.json && r.json.ok && !/script|onclick|javascript:/i.test(r.json.html), r.json && r.json.html);
  r = await AU(A, { action: 'previewTemplate' }); ok('previewTemplate', r.json && r.json.ok && r.json.html.includes('Juan Pérez') && r.json.html.includes('login.html'), r.json && r.json.asunto);
  r = await AU(A, { action: 'restoreTemplate' }); ok('restoreTemplate', r.json && r.json.ok);
  if (process.argv.includes('--invite')) {
    r = await AU(A, { action: 'grantAccess', personaId: 'test_sb_inv', role: 'empleado', mode: 'invite' });
    ok('grantAccess invite (Resend → delivered@resend.dev)', r.json && r.json.ok && r.json.estado === 'pendiente' && r.json.emailId, JSON.stringify(r.json));
    r = await AU(A, { action: 'resendInvite', personaId: 'test_sb_inv' }); ok('resendInvite', r.json && r.json.ok, JSON.stringify(r.json));
  }
  r = await AU(A, { action: 'nada' }); ok('acción inválida → 400', r.status === 400);
})().catch((e) => { console.error('FALLA', e.message); process.exit(1); });
