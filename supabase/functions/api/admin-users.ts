// @ts-nocheck
// POST /admin-users { action, ... } — sólo admin activo.
import { admin, HttpError, str, EMAIL_RE, audit, readEmailConfig, sendResend, SITE_URL } from './shared.ts';
import { DEFAULT_INVITE, sanitizeHtml, renderTemplate, validateTemplate, formatVence } from './templates.ts';

const ROLES = new Set(['admin', 'empleado']);
const ROL_LABEL = { admin: 'Administrador', empleado: 'Empleado' };
const BAN_FOREVER = '876000h';

async function getTemplate() {
  const { data } = await admin.from('config_plantillas').select('asunto, html, updated_at').eq('clave', 'invitacion').maybeSingle();
  return data ? { ...data, isDefault: false } : { ...DEFAULT_INVITE, isDefault: true };
}

async function allAuthUsers() {
  const out = [];
  for (let page = 1; page < 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new HttpError(500, error.message);
    out.push(...(data?.users || []));
    if (!data || data.users.length < 1000) break;
  }
  return out;
}

async function findAuthUserByEmail(email: string) {
  const lower = email.toLowerCase();
  return (await allAuthUsers()).find((u) => String(u.email || '').toLowerCase() === lower) || null;
}

async function loadPersona(personaId: string) {
  const { data } = await admin.from('personas').select('*').eq('id', personaId).maybeSingle();
  if (!data) throw new HttpError(404, 'persona_inexistente');
  return data;
}

async function resolveTarget(body) {
  if (body.personaId) {
    const persona = await loadPersona(str(body.personaId));
    if (!persona.auth_user_id) throw new HttpError(400, 'persona_sin_login');
    return { persona, userId: persona.auth_user_id };
  }
  if (body.userId) {
    const { data: persona } = await admin.from('personas').select('*').eq('auth_user_id', str(body.userId)).maybeSingle();
    return { persona: persona || null, userId: str(body.userId) };
  }
  throw new HttpError(400, 'destino_requerido');
}

async function activeAdmins() {
  const { data } = await admin.from('profiles').select('id').eq('role', 'admin').eq('activo', true);
  return (data || []).map((r) => r.id);
}

async function sendLinkEmail({ to, nombre, rol, link, venceDate, kind }) {
  const cfg = await readEmailConfig();
  if (!cfg.apiKey) throw new HttpError(400, 'email_key_missing');
  if (!cfg.fromEmail) throw new HttpError(400, 'email_config_incomplete');
  const vars = { nombre, email: to, rol: ROL_LABEL[rol] || rol, empresa: 'La Jamonera', link, vence: formatVence(venceDate), remitente: cfg.fromName };
  let asunto; let html;
  if (kind === 'invite') {
    const tpl = await getTemplate();
    asunto = renderTemplate(tpl.asunto, vars).replace(/&amp;/g, '&');
    html = renderTemplate(sanitizeHtml(tpl.html), vars);
  } else {
    asunto = 'Restablecer tu contraseña · La Jamonera';
    html = renderTemplate('<p>Hola {{nombre}},</p><p>Para elegir una contraseña nueva entrá a este link (vence el {{vence}}):</p><p><a href="{{link}}">Restablecer contraseña</a></p><p>Si no lo pediste, ignorá este correo.</p>', vars);
  }
  const out = await sendResend(cfg, { fromName: cfg.fromName, to, subject: asunto.slice(0, 300), html });
  return out.id || '';
}

const redirectFor = (body) => {
  const r = str(body.redirectTo);
  return /^https:\/\/(www\.)?lajamonera\.online\//.test(r) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(r) ? r : `${SITE_URL}/login.html`;
};

async function generateLink(type: 'invite' | 'recovery', email: string, body, nombre: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type, email, options: { redirectTo: redirectFor(body), data: type === 'invite' ? { nombre } : undefined } });
  if (error) throw new HttpError(400, error.message);
  return { link: data.properties.action_link, user: data.user };
}

export async function handleAdminUsers(caller, body) {
  const action = str(body.action);
  const actorId = caller.user.id;

  if (action === 'list') {
    const [{ data: personas }, { data: profiles }, users] = await Promise.all([
      admin.from('personas').select('id, nombre, puesto, email, foto_url, telefono, acceso, auth_user_id, invitacion_estado, invitacion_enviada_at, activo, created_at, updated_at').order('nombre'),
      admin.from('profiles').select('*'),
      allAuthUsers()
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    const profileById = new Map((profiles || []).map((p) => [p.id, p]));
    const login = (uid) => {
      if (!uid) return null;
      const u = byId.get(uid); const p = profileById.get(uid);
      return {
        userId: uid, email: u?.email || p?.email || '', role: p?.role || null,
        puedeEditar: p ? (p.role === 'admin' || p.puede_editar) : false,
        puedeBorrar: p ? (p.role === 'admin' || p.puede_borrar) : false,
        activo: Boolean(p?.activo), lastSignInAt: u?.last_sign_in_at || null,
        confirmado: Boolean(u?.email_confirmed_at), baneado: Boolean(u?.banned_until && new Date(u.banned_until) > new Date())
      };
    };
    const linked = new Set((personas || []).map((p) => p.auth_user_id).filter(Boolean));
    return {
      ok: true,
      personas: (personas || []).map((p) => ({ ...p, login: login(p.auth_user_id) })),
      loginsSinPersona: (profiles || []).filter((p) => !linked.has(p.id)).map((p) => ({ nombre: p.nombre, ...login(p.id) }))
    };
  }

  if (action === 'grantAccess') {
    const persona = await loadPersona(str(body.personaId));
    const role = ROLES.has(str(body.role)) ? str(body.role) : 'empleado';
    const puedeEditar = body.puedeEditar !== false;
    const puedeBorrar = body.puedeBorrar === true;
    const mode = str(body.mode) === 'password' ? 'password' : 'invite';
    const email = str(body.email || persona.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'email_invalido');
    if (persona.auth_user_id && persona.acceso === 'login') throw new HttpError(409, 'ya_tiene_acceso');

    let userId = persona.auth_user_id || null;
    let tempPassword = '';
    let emailId = '';
    const existing = userId ? null : await findAuthUserByEmail(email);
    if (existing) {
      const { data: otro } = await admin.from('personas').select('id').eq('auth_user_id', existing.id).maybeSingle();
      if (otro && otro.id !== persona.id) throw new HttpError(409, 'email_de_otra_persona');
      userId = existing.id;
    }
    if (userId) {
      await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
    } else if (mode === 'password') {
      tempPassword = str(body.tempPassword) || `${crypto.randomUUID().slice(0, 8)}A1!`;
      if (tempPassword.length < 8) throw new HttpError(400, 'password_corta');
      const { data, error } = await admin.auth.admin.createUser({ email, password: tempPassword, email_confirm: true, user_metadata: { nombre: persona.nombre, must_change_password: true } });
      if (error) throw new HttpError(400, error.message);
      userId = data.user.id;
    } else {
      const { link, user } = await generateLink('invite', email, body, persona.nombre);
      userId = user.id;
      emailId = await sendLinkEmail({ to: email, nombre: persona.nombre, rol: role, link, venceDate: new Date(Date.now() + 24 * 3600e3), kind: 'invite' });
    }

    const { error: pErr } = await admin.from('profiles').upsert({
      id: userId, email, nombre: persona.nombre, role, puede_editar: puedeEditar, puede_borrar: puedeBorrar,
      activo: true, persona_id: persona.id, updated_at: new Date().toISOString()
    });
    if (pErr) throw new HttpError(500, pErr.message);
    const estado = mode === 'invite' && !existing ? 'pendiente' : 'activa';
    await admin.from('personas').update({
      acceso: 'login', auth_user_id: userId, email, invitacion_estado: estado,
      invitacion_enviada_at: mode === 'invite' ? new Date().toISOString() : persona.invitacion_enviada_at, updated_at: new Date().toISOString()
    }).eq('id', persona.id);
    await audit(actorId, 'grantAccess', persona.id, { userId, role, puedeEditar, puedeBorrar, mode });
    return { ok: true, userId, estado, emailId, ...(tempPassword ? { tempPassword } : {}) };
  }

  if (action === 'resendInvite') {
    const { persona, userId } = await resolveTarget(body);
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const email = str(u?.user?.email);
    const { data: prof } = await admin.from('profiles').select('role, nombre').eq('id', userId).maybeSingle();
    const confirmed = Boolean(u?.user?.email_confirmed_at && u?.user?.last_sign_in_at);
    const { link } = await generateLink(confirmed ? 'recovery' : 'invite', email, body, persona?.nombre || prof?.nombre || '');
    const emailId = await sendLinkEmail({ to: email, nombre: persona?.nombre || prof?.nombre || '', rol: prof?.role || 'empleado', link, venceDate: new Date(Date.now() + 24 * 3600e3), kind: confirmed ? 'recovery' : 'invite' });
    if (persona) await admin.from('personas').update({ invitacion_enviada_at: new Date().toISOString() }).eq('id', persona.id);
    await audit(actorId, 'resendInvite', persona?.id || userId, { tipo: confirmed ? 'recovery' : 'invite' });
    return { ok: true, emailId, tipo: confirmed ? 'recovery' : 'invite' };
  }

  if (action === 'setRole') {
    const { persona, userId } = await resolveTarget(body);
    const role = str(body.role);
    if (!ROLES.has(role)) throw new HttpError(400, 'rol_invalido');
    if (role !== 'admin') {
      const admins = await activeAdmins();
      if (admins.includes(userId) && admins.length <= 1) throw new HttpError(409, 'ultimo_admin');
      if (userId === actorId) throw new HttpError(409, 'no_podes_quitarte_admin');
    }
    await admin.from('profiles').update({ role, updated_at: new Date().toISOString() }).eq('id', userId);
    await audit(actorId, 'setRole', persona?.id || userId, { role });
    return { ok: true };
  }

  if (action === 'setPermisos') {
    const { persona, userId } = await resolveTarget(body);
    const patch = { puede_editar: body.puedeEditar !== false, puede_borrar: body.puedeBorrar === true, updated_at: new Date().toISOString() };
    await admin.from('profiles').update(patch).eq('id', userId);
    await audit(actorId, 'setPermisos', persona?.id || userId, patch);
    return { ok: true };
  }

  if (action === 'setActive') {
    const { persona, userId } = await resolveTarget(body);
    const activo = body.activo === true;
    if (!activo) {
      if (userId === actorId) throw new HttpError(409, 'no_podes_desactivarte');
      const admins = await activeAdmins();
      if (admins.includes(userId) && admins.length <= 1) throw new HttpError(409, 'ultimo_admin');
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: activo ? 'none' : BAN_FOREVER });
    if (error) throw new HttpError(400, error.message);
    await admin.from('profiles').update({ activo, updated_at: new Date().toISOString() }).eq('id', userId);
    if (persona) {
      await admin.from('personas').update({ acceso: activo ? 'login' : 'interno', invitacion_estado: activo ? 'activa' : 'desactivada', updated_at: new Date().toISOString() }).eq('id', persona.id);
    }
    await audit(actorId, 'setActive', persona?.id || userId, { activo });
    return { ok: true };
  }

  if (action === 'resetPassword') {
    const { persona, userId } = await resolveTarget(body);
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const email = str(u?.user?.email);
    if (str(body.mode) === 'link') {
      const { data: prof } = await admin.from('profiles').select('role, nombre').eq('id', userId).maybeSingle();
      const { link } = await generateLink('recovery', email, body, prof?.nombre || '');
      const emailId = await sendLinkEmail({ to: email, nombre: prof?.nombre || '', rol: prof?.role || 'empleado', link, venceDate: new Date(Date.now() + 3600e3), kind: 'recovery' });
      await audit(actorId, 'resetPassword', persona?.id || userId, { mode: 'link' });
      return { ok: true, emailId };
    }
    const tempPassword = str(body.tempPassword) || `${crypto.randomUUID().slice(0, 8)}A1!`;
    if (tempPassword.length < 8) throw new HttpError(400, 'password_corta');
    const { error } = await admin.auth.admin.updateUserById(userId, { password: tempPassword, user_metadata: { ...(u?.user?.user_metadata || {}), must_change_password: true } });
    if (error) throw new HttpError(400, error.message);
    await audit(actorId, 'resetPassword', persona?.id || userId, { mode: 'temp' });
    return { ok: true, tempPassword };
  }

  if (action === 'getTemplate') {
    return { ok: true, ...(await getTemplate()), variables: ['nombre', 'email', 'rol', 'empresa', 'link', 'vence', 'remitente'] };
  }

  if (action === 'saveTemplate' || action === 'restoreTemplate') {
    const asunto = action === 'restoreTemplate' ? DEFAULT_INVITE.asunto : str(body.asunto).trim();
    const html = action === 'restoreTemplate' ? DEFAULT_INVITE.html : sanitizeHtml(str(body.html));
    const invalid = validateTemplate(asunto, html);
    if (invalid) throw new HttpError(400, invalid);
    const { error } = await admin.from('config_plantillas').upsert({ clave: 'invitacion', asunto, html, updated_by: actorId, updated_at: new Date().toISOString() });
    if (error) throw new HttpError(500, error.message);
    await audit(actorId, action, 'invitacion', { largo: html.length });
    return { ok: true, asunto, html };
  }

  if (action === 'previewTemplate' || action === 'testTemplate') {
    const tpl = body.html ? { asunto: str(body.asunto), html: sanitizeHtml(str(body.html)) } : await getTemplate();
    const invalid = validateTemplate(tpl.asunto, tpl.html);
    if (invalid) throw new HttpError(400, invalid);
    const vars = { nombre: 'Juan Pérez', email: caller.user.email, rol: 'Empleado', empresa: 'La Jamonera', link: `${SITE_URL}/login.html#ejemplo`, vence: formatVence(new Date(Date.now() + 24 * 3600e3)), remitente: 'La Jamonera' };
    const html = renderTemplate(tpl.html, vars);
    const asunto = renderTemplate(tpl.asunto, vars).replace(/&amp;/g, '&');
    if (action === 'previewTemplate') return { ok: true, asunto, html };
    const cfg = await readEmailConfig();
    if (!cfg.apiKey) throw new HttpError(400, 'email_key_missing');
    if (!cfg.fromEmail) throw new HttpError(400, 'email_config_incomplete');
    const out = await sendResend(cfg, { fromName: cfg.fromName, to: caller.user.email, subject: `[Prueba] ${asunto}`, html });
    return { ok: true, id: out.id || '', to: caller.user.email };
  }

  throw new HttpError(400, 'accion_invalida');
}
