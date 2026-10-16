// @ts-nocheck
// Ventas del local: InfoManager IM5 → Supabase (im5_comprobantes / im5_items) → ventaslocal.html.
// IM5 no tiene la API oficial habilitada: se usa la misma API JSON que usa su página
// (/IM5_IMP/api/...). Por eso todo lo de IM5 vive en este archivo: si mañana se habilita la
// oficial, se cambia acá y nada más. Detalle completo en docs/ventas-local-im5.md (no público).
//
//   POST /ventas/credenciales { base, usuario, password }  (admin)   → prueba el login y guarda en Vault
//   GET  /ventas/credenciales                               (admin)   → { configurada, base, usuario }
//   POST /ventas/sync                                       (ver ventas) → corrida ya («Actualizar ahora»)
//   POST /ventas/cron                                       (x-cron-secret, cada 10 min) → decide si toca
import { admin, HttpError, str, secretGet, secretSet, readEmailConfig, sendResend, EMAIL_RE } from './shared.ts';

const IM5_URL = 'https://app.infomanager.com.ar';
const IM5_BASE_PATH = '/IM5_IMP';
const IM5_VERSION_DEFAULT = '1.0.502';
const TZ = 'America/Argentina/Buenos_Aires';
const PRESUPUESTO_MS = 110_000;        // la función corta a los 150 s
const DIAS_RECIENTES = 3;              // en cada corrida se revisan los últimos N días (cambios, anulaciones)
const MESES_VACIOS_FIN = 6;            // el historial termina tras N meses seguidos sin comprobantes
const PARALELO_ITEMS = 4;
const SECRETO = 'im5_credenciales';
const JOB = 'ventas_im5';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Fechas en hora de Argentina ----------
export function ahoraAR(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24, minuto: Number(p.minute), dow };
}
export const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const inicioMes = (iso) => `${iso.slice(0, 7)}-01`;

// ¿Le toca al cron una corrida "normal" (traer lo nuevo)? Días + ventana horaria + intervalo.
export function tocaCorrer(cfg, estado, now = new Date()) {
  if (cfg.activa === false) return { toca: false, motivo: 'apagada' };
  const ar = ahoraAR(now);
  const dias = Array.isArray(cfg.dias) ? cfg.dias.map(Number) : [1, 2, 3, 4, 5];
  if (!dias.includes(ar.dow)) return { toca: false, motivo: 'dia_fuera' };
  const desde = Number(cfg.desde ?? 8); const hasta = Number(cfg.hasta ?? 19);
  if (ar.hora < desde || ar.hora > hasta) return { toca: false, motivo: 'hora_fuera' };
  const cada = Math.max(10, Number(cfg.cadaMin || 120));
  const ultima = estado?.ultimaOk ? Date.parse(estado.ultimaOk) : 0;
  // 2 min de margen: el cron es cada 10 y una corrida tarda; si no, "cada 2 h" se corre a 2 h 10.
  if (ultima && now.getTime() - ultima < (cada - 2) * 60_000) return { toca: false, motivo: 'intervalo' };
  return { toca: true };
}

// Próxima corrida programada (para mostrar en la página). Recorre en pasos de 10 min hasta 8 días.
export function proximaCorrida(cfg, estado, now = new Date()) {
  if (cfg.activa === false) return null;
  const base = estado?.ultimaOk ? Date.parse(estado.ultimaOk) + Math.max(10, Number(cfg.cadaMin || 120)) * 60_000 : now.getTime();
  let t = Math.max(base, now.getTime());
  t = Math.ceil(t / 600_000) * 600_000;
  for (let i = 0; i < 8 * 144; i++, t += 600_000) {
    const r = tocaCorrer(cfg, { ...estado, ultimaOk: null }, new Date(t));
    if (r.toca) return new Date(t).toISOString();
  }
  return null;
}

// ---------- Cliente IM5 ----------
class Im5 {
  constructor(cred) {
    this.cred = cred; this.token = ''; this.empresa = null;
    this.cliente = cred.clienteId || crypto.randomUUID();
    this.version = cred.version || IM5_VERSION_DEFAULT;
    this.llamadas = 0;
  }
  headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', 'X-IM5-Cliente': this.cliente, ...extra };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }
  async req(path, { method = 'GET', body, reintentos = 2 } = {}) {
    for (let i = 0; ; i++) {
      this.llamadas++;
      let res;
      try {
        res = await fetch(`${IM5_URL}${IM5_BASE_PATH}${path}`, { method, headers: this.headers(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        if (i < reintentos) { await sleep(1500 * (i + 1)); continue; }
        throw new HttpError(502, `im5_sin_respuesta: ${e?.message || e}`);
      }
      const txt = await res.text();
      let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _texto: txt.slice(0, 200) }; }
      if ((res.status >= 500 || res.status === 429) && i < reintentos) { await sleep(2000 * (i + 1)); continue; }
      if (!res.ok) {
        const msg = str(data.error || data.message || data._texto || `http_${res.status}`).slice(0, 200);
        const e = new HttpError(res.status === 401 || res.status === 403 ? 401 : 502, `im5_${res.status}: ${msg}`);
        e.im5Status = res.status; throw e;
      }
      return data;
    }
  }
  async login() {
    const r = await this.req('/api/auth/login', { method: 'POST', reintentos: 1, body: {
      username: this.cred.usuario, password: this.cred.password, targetSchema: this.cred.base, basePath: IM5_BASE_PATH, version: this.version
    } });
    if (!r.token) throw new HttpError(401, 'im5_login_sin_token');
    this.token = r.token;
    this.empresa = Number(r.user?.cod_empresa || r.user?.empresa?.cod_empresa || 1) || 1;
    this.usuarioNombre = str(r.user?.displayName || r.user?.username || this.cred.usuario);
    return r;
  }
  async usarEmpresa(cod) {
    if (this.empresa === cod) return;
    const r = await this.req('/api/auth/change-empresa', { method: 'POST', body: { cod_empresa: cod } });
    if (!r.success) throw new HttpError(502, `im5_change_empresa_${cod}`);
    if (r.token) this.token = r.token;
    this.empresa = cod;
  }
  async listar(tipo, desde, hasta, limit = 500) {
    const q = new URLSearchParams({ tipo, desde, hasta, incluir_anuladas: 'S', limit: String(limit) });
    const r = await this.req(`/api/comprobantes?${q}`);
    return { filas: Array.isArray(r.comprobantes) ? r.comprobantes : [], truncado: r.truncado === true };
  }
  // Baja un rango; si IM5 lo trunca, lo parte en dos hasta llegar a un día.
  async listarRango(tipo, desde, hasta) {
    const { filas, truncado } = await this.listar(tipo, desde, hasta);
    if (!truncado) return filas;
    if (desde === hasta) {
      const big = await this.listar(tipo, desde, hasta, 5000);
      if (big.truncado) throw new HttpError(502, `im5_dia_truncado_${tipo}_${desde}`);
      return big.filas;
    }
    const d0 = Date.parse(`${desde}T12:00:00Z`); const d1 = Date.parse(`${hasta}T12:00:00Z`);
    const medio = new Date(d0 + Math.floor((d1 - d0) / 86_400_000 / 2) * 86_400_000).toISOString().slice(0, 10);
    return [...await this.listarRango(tipo, desde, medio), ...await this.listarRango(tipo, sumarDias(medio, 1), hasta)];
  }
  detalle(id) { return this.req(`/api/comprobantes/${encodeURIComponent(id)}`); }
  async cerrar() {
    if (!this.token) return;
    try { await fetch(`${IM5_URL}${IM5_BASE_PATH}/api/sesiones/cerrar`, { method: 'POST', headers: this.headers(), body: '{}', signal: AbortSignal.timeout(8000) }); } catch { /* best effort */ }
  }
}

// ---------- Mapeo IM5 → filas ----------
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const numONull = (v) => (v === null || v === undefined || v === '' ? null : num(v));
export function fechaHora(c) {
  const f = str(c.usuario_fecha || c.fecha).slice(0, 10);
  let h = str(c.usuario_hora).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(h)) return null;
  if (h.length <= 5) h += ':00';
  return new Date(`${f}T${h.padStart(8, '0')}-03:00`).toISOString();
}
export function filaComprobante(empresa, tipo, c) {
  return {
    empresa, id: Number(c.id), tipo, letra: str(c.tipo_factura) || null,
    punto_venta: c.punto_de_venta == null ? null : Number(c.punto_de_venta) || null,
    numero: c.numero == null ? null : Number(c.numero) || null,
    fecha: str(c.fecha).slice(0, 10), fecha_hora: fechaHora(c),
    cod_cliente: str(c.cod_cliente) || null, cliente: str(c.cliente_nombre) || null,
    cliente_iva: str(c.cliente_categoria_iva_desc || c.cliente_categoria_iva) || null,
    total: num(c.total), importe_pago: numONull(c.importe_pago),
    vendedor: str(c.vendedor_nombre) || null, usuario: str(c.usuario) || null,
    condicion_venta: str(c.condicion_venta_nombre) || null, condicion_venta_tipo: str(c.condicion_venta_tipo) || null,
    observaciones: str(c.observaciones) || null, anulada: str(c.anulada).toUpperCase() === 'S',
    cae: str(c.cae) || null, raw: c, sync_at: new Date().toISOString()
  };
}
export function filasItems(empresa, comprobanteId, items) {
  return (Array.isArray(items) ? items : []).map((it, i) => ({
    empresa, comprobante_id: Number(comprobanteId), item_id: Number(it.id) || i + 1, orden: i,
    cod_articulo: str(it.cod_articulo) || null, descripcion: str(it.descripcion || it.detalle) || null,
    cantidad: num(it.cantidad), unidad: str(it.unidad_de_medida || it.unidad_venta) || null,
    precio_con_iva: numONull(it.precio_con_iva), importe: num(it.importe), iva_por: numONull(it.iva_por), raw: it
  }));
}
// Huella de lo que importa de la cabecera: si cambia, se vuelve a bajar el detalle.
const huella = (f) => `${f.total}|${f.anulada}|${f.fecha}|${f.condicion_venta}`;

// ---------- Base ----------
async function leerConfig() {
  const { data, error } = await admin.from('ventas_config').select('config, estado').eq('id', 1).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return { cfg: data?.config || {}, estado: data?.estado || {} };
}
async function guardarEstado(estado) {
  const { error } = await admin.from('ventas_config').update({ estado }).eq('id', 1);
  if (error) console.error('ventas estado', error.message);
}
export async function leerCredenciales() {
  const raw = await secretGet(SECRETO);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function upsertCabeceras(filas) {
  if (!filas.length) return { nuevos: 0, cambiados: 0 };
  const claves = filas.map((f) => f.id);
  const previos = new Map();
  for (let i = 0; i < claves.length; i += 500) {
    const { data, error } = await admin.from('im5_comprobantes').select('empresa, id, total, anulada, fecha, condicion_venta, items_ok')
      .eq('empresa', filas[0].empresa).in('id', claves.slice(i, i + 500));
    if (error) throw new HttpError(500, error.message);
    for (const r of data || []) previos.set(r.id, r);
  }
  let nuevos = 0; let cambiados = 0;
  const filasOut = filas.map((f) => {
    const p = previos.get(f.id);
    if (!p) { nuevos++; return { ...f, items_ok: false }; }
    const cambio = huella({ ...p, total: num(p.total) }) !== huella(f);
    if (cambio) cambiados++;
    return { ...f, items_ok: cambio ? false : p.items_ok };
  });
  for (let i = 0; i < filasOut.length; i += 300) {
    const { error } = await admin.from('im5_comprobantes').upsert(filasOut.slice(i, i + 300), { onConflict: 'empresa,id' });
    if (error) throw new HttpError(500, error.message);
  }
  return { nuevos, cambiados };
}

async function bajarItems(im5, empresa, limiteMs) {
  let hechos = 0; let fallas = 0;
  while (Date.now() < limiteMs) {
    const { data, error } = await admin.from('im5_comprobantes').select('id').eq('empresa', empresa).eq('items_ok', false)
      .order('fecha', { ascending: false }).limit(PARALELO_ITEMS * 5);
    if (error) throw new HttpError(500, error.message);
    if (!data?.length) break;
    for (let i = 0; i < data.length && Date.now() < limiteMs; i += PARALELO_ITEMS) {
      const tanda = data.slice(i, i + PARALELO_ITEMS);
      const res = await Promise.allSettled(tanda.map(async ({ id }) => {
        let d;
        try { d = await im5.detalle(id); } catch (e) {
          if (e?.im5Status !== 404) throw e;
          await admin.from('im5_comprobantes').update({ items_ok: true }).eq('empresa', empresa).eq('id', id);
          return;
        }
        const items = filasItems(empresa, id, d.items);
        await admin.from('im5_items').delete().eq('empresa', empresa).eq('comprobante_id', id);
        if (items.length) {
          const { error: e1 } = await admin.from('im5_items').insert(items);
          if (e1) throw new Error(e1.message);
        }
        const { error: e2 } = await admin.from('im5_comprobantes').update({ items_ok: true }).eq('empresa', empresa).eq('id', id);
        if (e2) throw new Error(e2.message);
      }));
      for (const r of res) { if (r.status === 'fulfilled') hechos++; else { fallas++; console.error('ventas item', r.reason?.message); } }
      if (fallas > 20) throw new HttpError(502, 'im5_detalle_falla_repetida');
    }
  }
  return { hechos, fallas };
}

// ---------- Corrida ----------
// modo: 'cron' (decide sola) · 'manual' (botón Actualizar ahora: trae lo nuevo ya)
export async function runVentas({ modo = 'cron', quien = '' } = {}) {
  const t0 = Date.now();
  const limite = t0 + PRESUPUESTO_MS;
  const { cfg, estado: estado0 } = await leerConfig();
  const estado = { ...estado0 };
  const runId = `run_${t0}`;

  const decision = modo === 'cron' ? tocaCorrer(cfg, estado0) : { toca: true };
  const backfill = { ...(estado0.backfill || {}) };
  const empresas = (Array.isArray(cfg.empresas) && cfg.empresas.length ? cfg.empresas : [1, 2]).map(Number);
  const historialPendiente = empresas.some((e) => !backfill[e]?.terminado);
  const itemsPendientes = await contarSinItems();
  if (!decision.toca && !historialPendiente && !itemsPendientes) {
    estado.proxima = proximaCorrida(cfg, estado);
    estado.ultimoChequeo = new Date().toISOString();
    await guardarEstado(estado);
    return { ok: true, salteada: decision.motivo, proxima: estado.proxima };
  }

  const cred = await leerCredenciales();
  if (!cred?.base || !cred?.usuario || !cred?.password) {
    estado.ok = false; estado.error = 'Faltan las credenciales de IM5 (cargalas en la página).'; estado.ultimaCorrida = new Date().toISOString();
    await guardarEstado(estado);
    return { ok: false, error: 'sin_credenciales' };
  }

  if (!(await tryLock(runId))) return { ok: false, error: 'ocupada' };
  estado.corriendo = { desde: new Date().toISOString(), modo, quien };
  await guardarEstado(estado);

  const im5 = new Im5(cred);
  const resumen = { modo, nuevos: 0, cambiados: 0, items: 0, fallasItems: 0, historial: [], llamadas: 0 };
  let error = null;
  try {
    await im5.login();
    const tipos = (Array.isArray(cfg.tipos) && cfg.tipos.length ? cfg.tipos : ['FA', 'NC', 'ND']).map(String);
    const hoy = ahoraAR().fecha;

    for (const emp of empresas) {
      if (Date.now() > limite) break;
      await im5.usarEmpresa(emp);

      // 1) Lo nuevo y lo reciente (cambios / anulaciones de los últimos días).
      if (decision.toca) {
        const desde = sumarDias(hoy, -DIAS_RECIENTES);
        for (const tipo of tipos) {
          const filas = (await im5.listarRango(tipo, desde, hoy)).map((c) => filaComprobante(emp, tipo, c)).filter((f) => f.id && f.fecha);
          const r = await upsertCabeceras(filas);
          resumen.nuevos += r.nuevos; resumen.cambiados += r.cambiados;
        }
      }

      // 2) Historial hacia atrás, de a un mes, hasta N meses vacíos seguidos.
      const bf = { hasta: sumarDias(hoy, -DIAS_RECIENTES - 1), vacios: 0, terminado: false, total: 0, ...(backfill[emp] || {}) };
      while (!bf.terminado && Date.now() < limite - 20_000) {
        const hasta = bf.hasta; const desde = inicioMes(hasta);
        let enMes = 0;
        for (const tipo of tipos) {
          const filas = (await im5.listarRango(tipo, desde, hasta)).map((c) => filaComprobante(emp, tipo, c)).filter((f) => f.id && f.fecha);
          enMes += filas.length;
          const r = await upsertCabeceras(filas);
          resumen.nuevos += r.nuevos;
        }
        bf.total += enMes;
        bf.vacios = enMes ? 0 : bf.vacios + 1;
        bf.hasta = sumarDias(desde, -1);
        resumen.historial.push({ empresa: emp, mes: desde.slice(0, 7), comprobantes: enMes });
        if (bf.vacios >= MESES_VACIOS_FIN || bf.hasta < '2000-01-01') { bf.terminado = true; bf.terminadoAt = new Date().toISOString(); }
        backfill[emp] = bf;
        estado.backfill = backfill;
        await guardarEstado({ ...estado });
      }
      backfill[emp] = bf;
    }

    // 3) Detalle (productos) de lo que falta, lo más nuevo primero, por empresa.
    for (const emp of empresas) {
      if (Date.now() > limite) break;
      await im5.usarEmpresa(emp);
      const r = await bajarItems(im5, emp, limite);
      resumen.items += r.hechos; resumen.fallasItems += r.fallas;
    }
  } catch (e) {
    error = e?.message || String(e);
    console.error('ventas run', error);
  } finally {
    await im5.cerrar();
    resumen.llamadas = im5.llamadas;
    await releaseLock(runId);
  }

  const fin = new Date().toISOString();
  const pendientesItems = await contarSinItems();
  const corrida = { id: runId, inicio: new Date(t0).toISOString(), fin, ms: Date.now() - t0, ok: !error, error, ...resumen, pendientesItems };
  const errAntes = Number(estado0.erroresSeguidos || 0);
  const nuevoEstado = {
    ...estado, corriendo: null, backfill, ultimaCorrida: fin, ok: !error, error,
    erroresSeguidos: error ? errAntes + 1 : 0,
    pendientesItems,
    historialTerminado: empresas.every((e) => backfill[e]?.terminado),
    ultimaCorridaDetalle: corrida,
    corridas: [corrida, ...(Array.isArray(estado0.corridas) ? estado0.corridas : [])].slice(0, 30)
  };
  if (!error && decision.toca) nuevoEstado.ultimaOk = fin;
  nuevoEstado.proxima = proximaCorrida(cfg, nuevoEstado);
  await guardarEstado(nuevoEstado);
  if (error) await avisarFalla(cfg, nuevoEstado, error);
  else if (errAntes > 0) await avisarRecuperada(cfg, nuevoEstado);
  return { ok: !error, error, resumen: corrida };
}

async function contarSinItems() {
  const { count } = await admin.from('im5_comprobantes').select('id', { count: 'exact', head: true }).eq('items_ok', false);
  return count || 0;
}
async function tryLock(run) {
  const { data, error } = await admin.rpc('job_try_lock', { p_job: JOB, p_run: run, p_seconds: 180 });
  if (error) throw new HttpError(500, error.message);
  return data === true;
}
async function releaseLock(run) { try { await admin.rpc('job_release', { p_job: JOB, p_run: run }); } catch { /* vence solo */ } }

// ---------- Avisos por mail ----------
// Uno al pasar a error y, si sigue fallando, uno cada 24 h. Uno cuando se recupera.
async function avisarFalla(cfg, estado, error) {
  const destinos = str(cfg.mailAvisos).split(',').map((s) => s.trim()).filter((s) => EMAIL_RE.test(s));
  if (!destinos.length) return;
  const ultimo = estado.ultimoAvisoMail ? Date.parse(estado.ultimoAvisoMail) : 0;
  if (estado.erroresSeguidos > 1 && Date.now() - ultimo < 24 * 3600e3) return;
  await mandar(destinos, 'Ventas del local: la sincronización con IM5 falló',
    `<p>La sincronización de ventas con InfoManager falló.</p><p><b>Motivo:</b> ${escapar(error)}</p>
     <p>Errores seguidos: ${estado.erroresSeguidos}. Última vez que anduvo: ${escapar(estado.ultimaOk || 'nunca')}.</p>
     <p><a href="https://www.lajamonera.online/ventaslocal.html">Abrir Ventas del local</a></p>`);
  estado.ultimoAvisoMail = new Date().toISOString();
  await guardarEstado(estado);
}
async function avisarRecuperada(cfg, estado) {
  const destinos = str(cfg.mailAvisos).split(',').map((s) => s.trim()).filter((s) => EMAIL_RE.test(s));
  if (!destinos.length || !estado.ultimoAvisoMail) return;
  await mandar(destinos, 'Ventas del local: la sincronización volvió a andar', '<p>La sincronización de ventas con InfoManager volvió a funcionar.</p>');
  estado.ultimoAvisoMail = null;
  await guardarEstado(estado);
}
async function mandar(destinos, asunto, html) {
  try {
    const cfg = await readEmailConfig();
    if (!cfg.apiKey || !cfg.fromEmail) return;
    for (const to of destinos) await sendResend(cfg, { fromName: cfg.fromName, to, subject: asunto, html });
  } catch (e) { console.error('ventas mail', e?.message); }
}
const escapar = (s) => str(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Credenciales ----------
// IM5 identifica la empresa por el nombre de la base (schema). Se le pregunta a IM5 cuál es, igual
// que su pantalla de login: tolera mayúsculas y espacios; un nombre que no conoce da 'base_no_encontrada'.
async function resolverBase(texto) {
  const t = str(texto).trim();
  if (!t) return '';
  let res;
  try { res = await fetch(`${IM5_URL}${IM5_BASE_PATH}/api/auth/resolve/${encodeURIComponent(t)}`, { signal: AbortSignal.timeout(15_000) }); }
  catch (e) { throw new HttpError(502, `im5_sin_respuesta: ${e?.message || e}`); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.schema) throw new HttpError(400, 'base_no_encontrada');
  return str(data.schema).trim().toLowerCase();
}

export async function guardarCredenciales(body, actor) {
  const actual = (await leerCredenciales()) || {};
  const cred = {
    base: (str(body.base).trim() ? await resolverBase(body.base) : '') || actual.base || '',
    usuario: str(body.usuario).trim() || actual.usuario || '',
    password: str(body.password) || actual.password || '',
    clienteId: actual.clienteId || crypto.randomUUID(),
    version: str(body.version).trim() || actual.version || IM5_VERSION_DEFAULT
  };
  if (!/^[a-z0-9_]{3,80}$/i.test(cred.base)) throw new HttpError(400, 'base_invalida');
  if (!cred.usuario || cred.usuario.length > 80) throw new HttpError(400, 'usuario_invalido');
  if (!cred.password) throw new HttpError(400, 'password_requerida');
  // Se prueba antes de guardar: credenciales malas no pisan las buenas.
  const im5 = new Im5(cred);
  const t0 = Date.now();
  try { await im5.login(); } finally { await im5.cerrar(); }
  await secretSet(SECRETO, JSON.stringify(cred));
  return { ok: true, base: cred.base, usuario: cred.usuario, ms: Date.now() - t0, actor };
}
export async function estadoCredenciales() {
  const c = await leerCredenciales();
  return { ok: true, configurada: Boolean(c?.base && c?.usuario && c?.password), base: c?.base || '', usuario: c?.usuario || '' };
}
