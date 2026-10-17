// @ts-nocheck
// Mercado Pago (solo lectura): detalle de los pagos que IM5 registra con id de pago externo (Point / QR).
// Token: se pide a la conexión de NinjaPos (el sistema que maneja el OAuth de MP) con la clave guardada en Vault
// (`ninjasoft_mp_key`). NinjaPos es el único que renueva y nunca entrega el refresh_token. Acá NUNCA se renueva:
// en Mercado Pago el refresh_token es de un solo uso y renovarlo rompería el POS. Sin clave cargada se usa el
// access_token guardado a mano (`mp_credenciales`), como antes.
import { admin, HttpError, str, secretGet, secretSet } from './shared.ts';

const SECRETO = 'mp_credenciales';
const SECRETO_NINJA = 'ninjasoft_mp_key';
const BROKER = 'https://hrkditzrsavehnhngakb.supabase.co/functions/v1/mp_token_broker';
const ERR_BROKER = { 401: 'ninjapos_clave_invalida', 403: 'ninjapos_ip_no_permitida', 404: 'ninjapos_mp_desconectado' };
let cacheBroker = null; // { cred, hasta } en memoria de la función

// Pide el token vigente a NinjaPos. Se reusa mientras falten más de 3 días para que venza (y como mucho 6 h).
async function credDeNinjaPos(clave, { forzar = false } = {}) {
  if (!forzar && cacheBroker && cacheBroker.hasta > Date.now()) return cacheBroker.cred;
  let res;
  try { res = await fetch(BROKER, { headers: { 'x-api-key': clave }, signal: AbortSignal.timeout(12_000) }); }
  catch (e) { throw new HttpError(502, `ninjapos_sin_respuesta: ${e?.message || e}`); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 401 ? 400 : 502, ERR_BROKER[res.status] || `ninjapos_${res.status}`);
  if (!str(data.access_token)) throw new HttpError(502, 'ninjapos_sin_token');
  const cred = { access_token: data.access_token, mp_user_id: str(data.mp_user_id), expires_at: str(data.expires_at), origen: 'NinjaPos' };
  const vence = Date.parse(cred.expires_at) || 0;
  cacheBroker = { cred, hasta: Math.min(Date.now() + 6 * 3600e3, vence ? vence - 3 * 24 * 3600e3 : Date.now() + 3600e3) };
  return cred;
}
const API = 'https://api.mercadopago.com';
const LOTE = 25;           // ids por llamada desde la página
const PARALELO = 4;
const REVISAR_PENDIENTE_MS = 30 * 60e3;

async function leerManual() {
  const raw = await secretGet(SECRETO);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// estricto: el error de NinjaPos se propaga (para mostrarlo en el estado); si no, cae al token manual.
async function leerCred({ estricto = false } = {}) {
  const clave = await secretGet(SECRETO_NINJA);
  if (clave) {
    try { return await credDeNinjaPos(clave); }
    catch (e) { const manual = estricto ? null : await leerManual(); if (manual?.access_token) return manual; throw e; }
  }
  return leerManual();
}

async function mpGet(token, path) {
  let res;
  try { res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) }); }
  catch (e) { throw new HttpError(502, `mp_sin_respuesta: ${e?.message || e}`); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new HttpError(401, 'mp_token_vencido');
  return { status: res.status, data };
}

const fila = (id, p) => ({
  id_pago: String(id),
  estado: str(p.status) || null,
  estado_detalle: str(p.status_detail) || null,
  metodo: str(p.payment_method_id) || null,
  tipo: str(p.payment_type_id) || null,
  monto: p.transaction_amount ?? null,
  neto: p.transaction_details?.net_received_amount ?? null,
  comision: Array.isArray(p.fee_details) ? Number(p.fee_details.reduce((s, f) => s + Number(f.amount || 0), 0).toFixed(2)) : null,
  ultimos4: str(p.card?.last_four_digits) || null,
  cuotas: p.installments ?? null,
  aprobado_at: p.date_approved || null,
  acreditacion_at: p.money_release_date || null,
  origen: str(p.point_of_interaction?.type) || null,
  // Sin datos personales del pagador: sólo lo que hace falta para conciliar.
  raw: { status: p.status, status_detail: p.status_detail, payment_method_id: p.payment_method_id, payment_type_id: p.payment_type_id,
    transaction_amount: p.transaction_amount, net_received_amount: p.transaction_details?.net_received_amount, fee_details: p.fee_details,
    installments: p.installments, date_created: p.date_created, date_approved: p.date_approved, money_release_date: p.money_release_date,
    money_release_status: p.money_release_status, point_of_interaction_type: p.point_of_interaction?.type, description: p.description },
  consultado_at: new Date().toISOString()
});

// Devuelve el detalle de los pagos pedidos: usa la caché y consulta a MP sólo los que faltan
// (o los que estaban pendientes hace más de 30 min).
export async function pagosMP(ids) {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map((x) => str(x).trim()).filter((x) => /^\d{6,20}$/.test(x)))].slice(0, LOTE);
  if (!lista.length) return { ok: true, pagos: [] };
  const { data: cache, error } = await admin.from('im5_mp_pagos').select('*').in('id_pago', lista);
  if (error) throw new HttpError(500, error.message);
  const porId = new Map((cache || []).map((r) => [r.id_pago, r]));
  const faltan = lista.filter((id) => {
    const r = porId.get(id);
    return !r || (['pending', 'in_process'].includes(r.estado) && Date.now() - Date.parse(r.consultado_at) > REVISAR_PENDIENTE_MS);
  });
  if (faltan.length) {
    const cred = await leerCred();
    if (!cred?.access_token) return { ok: true, pagos: [...porId.values()], sinCredenciales: true };
    const nuevas = [];
    for (let i = 0; i < faltan.length; i += PARALELO) {
      const res = await Promise.allSettled(faltan.slice(i, i + PARALELO).map(async (id) => {
        const { status, data } = await mpGet(cred.access_token, `/v1/payments/${id}`);
        if (status === 200) return fila(id, data);
        if (status === 404) return { id_pago: id, estado: 'no_encontrado', raw: null, consultado_at: new Date().toISOString() };
        throw new HttpError(502, `mp_${status}`);
      }));
      for (const r of res) {
        if (r.status === 'fulfilled') nuevas.push(r.value);
        else if (r.reason?.message === 'mp_token_vencido') throw r.reason;
      }
    }
    if (nuevas.length) {
      const { error: e2 } = await admin.from('im5_mp_pagos').upsert(nuevas, { onConflict: 'id_pago' });
      if (e2) throw new HttpError(500, e2.message);
      nuevas.forEach((r) => porId.set(r.id_pago, r));
    }
  }
  return { ok: true, pagos: [...porId.values()].map(({ raw, ...r }) => r) };
}

// Estado de la conexión (sin devolver el token).
export async function estadoMP() {
  let cred;
  try { cred = await leerCred({ estricto: true }); }
  catch (e) { return { ok: true, configurada: true, ninjapos: true, error: str(e?.message) }; }
  if (!cred?.access_token) return { ok: true, configurada: false };
  let cuenta = null;
  try {
    const { status, data } = await mpGet(cred.access_token, '/users/me');
    if (status === 200) cuenta = { id: data.id, nickname: data.nickname, site: data.site_id };
  } catch (e) { if (e?.message === 'mp_token_vencido') return { ok: true, configurada: true, vencido: true, vence: cred.expires_at || '' }; }
  return { ok: true, configurada: true, cuenta, vence: cred.expires_at || '', origen: cred.origen || '', ninjapos: cred.origen === 'NinjaPos' };
}

// Guarda la clave de la conexión de NinjaPos. Se prueba antes: tiene que entregar un token de la misma cuenta.
export async function guardarClaveNinjaPos(body) {
  const clave = str(body?.ninjasoft_key).trim();
  if (clave.length < 20 || /\s/.test(clave)) throw new HttpError(400, 'ninjapos_clave_formato');
  const cred = await credDeNinjaPos(clave, { forzar: true });
  const { status, data } = await mpGet(cred.access_token, '/users/me');
  if (status !== 200) throw new HttpError(400, 'mp_token_rechazado');
  const actual = await (async () => { const raw = await secretGet(SECRETO); try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
  if (actual.mp_user_id && String(actual.mp_user_id) !== String(data.id)) throw new HttpError(400, 'mp_otra_cuenta');
  await secretSet(SECRETO_NINJA, clave);
  return { ok: true, cuenta: { id: data.id, nickname: data.nickname, site: data.site_id }, vence: cred.expires_at };
}

// Carga un access_token nuevo (cuando el otro sistema lo renovó). Se prueba antes de guardar.
export async function guardarCredMP(body, actor) {
  const token = str(body?.access_token).trim();
  if (!/^APP_USR-[\w-]{20,}$/.test(token)) throw new HttpError(400, 'mp_token_invalido');
  const { status, data } = await mpGet(token, '/users/me');
  if (status !== 200) throw new HttpError(400, 'mp_token_rechazado');
  const actual = (await leerCred()) || {};
  if (actual.mp_user_id && String(actual.mp_user_id) !== String(data.id)) throw new HttpError(400, 'mp_otra_cuenta');
  await secretSet(SECRETO, JSON.stringify({ access_token: token, mp_user_id: String(data.id), expires_at: str(body?.expires_at) || '', origen: `cargado por ${actor}`, actualizado: new Date().toISOString() }));
  return { ok: true, cuenta: { id: data.id, nickname: data.nickname, site: data.site_id } };
}
