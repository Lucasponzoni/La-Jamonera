// @ts-nocheck
// Conciliación Mercado Pago ↔ InfoManager (Ventas del local → Conciliación).
//  1. Baja los pagos de la cuenta de MP del rango (payments/search) a la caché im5_mp_pagos.
//  2. Lee de IM5 qué cupones ya están conciliados (conciliacion-tarjetas, 1 llamada por rango).
//  3. Cruza cada cobro con MP de IM5 (MERCADO PAGO 1/2, Point, QR en Point) contra su pago de MP:
//     id de pago externo (Point/QR) → cupón (n° de operación que tipea la cajera) → importe + hora (único).
//  4. Graba en IM5 (Conciliación de Tarjetas) sólo lo que un admin confirma desde la página.
// El token de MP sale de mp.ts (NinjaPos o manual). Acá NUNCA se renueva.
// Frecuencia: cruce diario (cron 7:00), aviso los lunes con lo listo para grabar y el día 1 con el cierre del mes.
import { admin, HttpError, str, audit } from './shared.ts';
import { leerCred, mpGet, filaMP } from './mp.ts';
import { Im5, leerCredenciales, plantillaMail, mandar, destinosAviso, ahoraAR, sumarDias } from './ventas-im5.ts';

const TZ = 'America/Argentina/Buenos_Aires';
const TARJETAS_MP = [1, 3, 6, 7];                 // MERCADO PAGO 1, MERCADO PAGO 2, Point, QR en Point
const TOL_IMPORTE = 0.01;
const TOL_MIN = 10;
const DIAS_CRON = 35;                              // devoluciones y contracargos aparecen tarde
const MAX_PAGINAS = 60;                            // 6000 pagos por corrida
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const isoAR = (d, fin = false) => `${d}T${fin ? '23:59:59.999' : '00:00:00.000'}-03:00`;
const digitos = (s) => str(s).replace(/\D/g, '');
const codigoComp = (c) => `${c.tipo} ${c.letra || ''} ${String(c.punto_venta || 0).padStart(4, '0')}-${String(c.numero || 0).padStart(8, '0')}`.replace(/\s+/g, ' ');

async function sel(q) { const { data, error } = await q; if (error) throw new HttpError(500, error.message); return data || []; }
// Supabase devuelve como mucho 1000 filas por consulta: se pagina hasta traer todo.
async function selTodo(armar, tam = 1000) {
  const out = [];
  for (let i = 0; ; i += tam) {
    const filas = await sel(armar().range(i, i + tam - 1));
    out.push(...filas);
    if (filas.length < tam) return out;
  }
}
// Distancia de edición entre dos números (dígitos de más, de menos o cambiados): detecta cupones mal tipeados.
function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---------- 1) Mercado Pago ----------
async function bajarPagosMP(desde, hasta, log) {
  const cred = await leerCred();
  if (!cred?.access_token) throw new HttpError(400, 'mp_sin_credenciales');
  const filas = [];
  // De a un día: la búsqueda de MP no pagina bien rangos largos (deja pagos afuera pasado cierto offset).
  for (let dia = sumarDias(desde, -1); dia <= sumarDias(hasta, 1); dia = sumarDias(dia, 1)) {
    for (let pag = 0, offset = 0; pag < MAX_PAGINAS; pag++) {
      const q = new URLSearchParams({ range: 'date_created', begin_date: isoAR(dia), end_date: isoAR(dia, true),
        sort: 'date_created', criteria: 'asc', limit: '100', offset: String(offset) });
      let r;
      for (let i = 0; i < 3; i++) {
        r = await mpGet(cred.access_token, `/v1/payments/search?${q}`);
        if (r.status !== 429 && r.status < 500) break;
        await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
      }
      if (r.status !== 200) throw new HttpError(502, `mp_search_${r.status}`);
      const res = Array.isArray(r.data?.results) ? r.data.results : [];
      res.forEach((p) => filas.push(filaMP(String(p.id), p)));
      offset += res.length;
      if (res.length < 100 || offset >= Number(r.data?.paging?.total || 0)) break;
    }
  }
  // La paginación de MP puede repetir pagos entre páginas: uno por id.
  const unicos = [...new Map(filas.map((f) => [f.id_pago, f])).values()];
  for (const c of chunks(unicos, 500)) {
    const { error } = await admin.from('im5_mp_pagos').upsert(c, { onConflict: 'id_pago' });
    if (error) throw new HttpError(500, error.message);
  }
  log.info?.(`[conc] MP ${unicos.length} pagos ${desde}..${hasta}`);
  return unicos;
}

// ---------- 2) IM5: qué está conciliado ----------
async function leerIm5Conciliados(desde, hasta) {
  const cred = await leerCredenciales();
  if (!cred) return { mapa: new Map(), error: 'im5_sin_credenciales' };
  const im5 = new Im5(cred);
  try {
    await im5.login();
    const q = new URLSearchParams({ fecha_desde: desde, fecha_hasta: hasta, tipo_fecha: 'E', estado: 'T', tag: '', cod_tarjeta: '0', cuenta_banco: '0', ver_dif_cotiz: '0', limite: '5000', empresas: '1,2' });
    const r = await im5.req(`/api/conciliacion-tarjetas?${q}`);
    const mapa = new Map((Array.isArray(r.tarjetas) ? r.tarjetas : []).map((t) => [String(t.id_pago), t]));
    return { mapa, truncado: Number(r.total_tarjetas || 0) > mapa.size };
  } catch (e) {
    return { mapa: new Map(), error: str(e?.message).slice(0, 200) };
  } finally { await im5.cerrar(); }
}

// ---------- 3) Cruce ----------
export async function cruzar({ desde, hasta, bajarMP = true, log = console } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) throw new HttpError(400, 'fechas_invalidas');
  if (bajarMP) await bajarPagosMP(desde, hasta, log);

  // Cobros con MP de IM5: comprobante del rango → recibos que lo cancelan → pagos con MP del recibo.
  const comps = new Map();
  (await selTodo(() => admin.from('im5_comprobantes').select('empresa,id,tipo,letra,punto_venta,numero,fecha,fecha_hora,anulada')
    .gte('fecha', desde).lte('fecha', hasta).order('empresa').order('id'))).forEach((x) => comps.set(`${x.empresa}:${x.id}`, x));
  const recibos = [];
  for (const emp of [1, 2]) {
    const ids = [...comps.values()].filter((c) => c.empresa === emp).map((c) => c.id);
    for (const c of chunks(ids, 300)) recibos.push(...await selTodo(() => admin.from('im5_comprobante_recibos').select('empresa,comprobante_id,recibo_id,recibo_tipo,recibo_punto_venta,recibo_numero').eq('empresa', emp).in('comprobante_id', c).order('recibo_id')));
  }
  // Un recibo puede cancelar varios comprobantes: se toma el primero (fecha y hora de la venta).
  const reciboDe = new Map();
  recibos.forEach((r) => {
    const c = comps.get(`${r.empresa}:${r.comprobante_id}`);
    if (!c) return;
    const k = `${r.empresa}:${r.recibo_id}`;
    const prev = reciboDe.get(k);
    if (!prev || str(c.fecha_hora) < str(prev.c.fecha_hora)) reciboDe.set(k, { c, r });
  });
  const pagosIm5 = [];
  for (const emp of [1, 2]) {
    const ids = [...reciboDe.keys()].filter((k) => k.startsWith(`${emp}:`)).map((k) => Number(k.split(':')[1]));
    for (const c of chunks(ids, 300)) {
      pagosIm5.push(...await selTodo(() => admin.from('im5_pagos').select('empresa,id,recibo_id,medio,importe,cupon,id_pago_externo,cod_tarjeta').eq('empresa', emp).in('recibo_id', c).in('cod_tarjeta', TARJETAS_MP).order('id')));
    }
  }
  const enRango = pagosIm5.map((p) => ({ p, ...reciboDe.get(`${p.empresa}:${p.recibo_id}`) }))
    .filter((x) => x.c && !x.c.anulada && x.c.fecha >= desde && x.c.fecha <= hasta);

  // Pagos de MP del rango (± 1 día por la hora) + los que IM5 nombra por id aunque sean de otra fecha.
  const mpRango = await selTodo(() => admin.from('im5_mp_pagos').select('id_pago,estado,monto,neto,comision,aprobado_at,acreditacion_at,origen,raw')
    .gte('aprobado_at', isoAR(sumarDias(desde, -1))).lte('aprobado_at', isoAR(sumarDias(hasta, 1), true)).order('id_pago'));
  const mpPorId = new Map(mpRango.map((m) => [m.id_pago, m]));
  const pedidos = [...new Set(enRango.map(({ p }) => str(p.id_pago_externo) || digitos(p.cupon)).filter((id) => /^\d{6,20}$/.test(id) && !mpPorId.has(id)))];
  for (const c of chunks(pedidos, 300)) (await sel(admin.from('im5_mp_pagos').select('id_pago,estado,monto,neto,comision,aprobado_at,acreditacion_at,origen,raw').in('id_pago', c))).forEach((m) => mpPorId.set(m.id_pago, m));
  // Los que IM5 nombra y MP todavía no devolvió en la búsqueda: se piden de a uno (pocos).
  // Los que IM5 nombra y la búsqueda no trajo (p. ej. cobros del Point): se piden por id, de a 4. Los que MP no
  // conoce (cupón mal tipeado) quedan guardados como «no_encontrado» para no preguntar en cada corrida.
  const faltan = pedidos.filter((id) => !mpPorId.has(id)).slice(0, 600);
  if (faltan.length) {
    const cred = await leerCred();
    const nuevas = [];
    for (const tanda of chunks(faltan, 4)) {
      const res = await Promise.allSettled(tanda.map(async (id) => {
        const { status, data } = await mpGet(cred.access_token, `/v1/payments/${id}`);
        if (status === 200) return filaMP(id, data);
        if (status === 404) return { id_pago: id, estado: 'no_encontrado', raw: null, consultado_at: new Date().toISOString() };
        return null;
      }));
      for (const r of res) {
        if (r.status === 'fulfilled' && r.value) { nuevas.push(r.value); mpPorId.set(r.value.id_pago, r.value); }
        else if (r.status === 'rejected' && r.reason?.message === 'mp_token_vencido') throw r.reason;
      }
    }
    for (const c of chunks(nuevas, 500)) await admin.from('im5_mp_pagos').upsert(c, { onConflict: 'id_pago' });
  }

  const { mapa: im5Conc, error: errIm5, truncado } = await leerIm5Conciliados(desde, hasta);
  const usados = new Set();
  const ahora = Date.now();
  const filas = [];
  const base = (x) => {
    const t = im5Conc.get(String(x.p.id));
    return {
      clave: `im5:${x.p.empresa}:${x.p.id}`, empresa: x.p.empresa, im5_pago_id: x.p.id, fecha: x.c.fecha, fecha_hora: x.c.fecha_hora,
      medio: x.p.medio, comprobante: codigoComp(x.c), recibo: x.r ? `${x.r.recibo_tipo || 'RC'} ${String(x.r.recibo_punto_venta || 0).padStart(4, '0')}-${String(x.r.recibo_numero || 0).padStart(8, '0')}` : null,
      importe: r2(x.p.importe), cupon: str(x.p.id_pago_externo) || str(x.p.cupon) || null,
      im5_conciliado: t ? t.conciliado === 'S' : null, im5_fec_conciliacion: t?.fec_conciliacion ? str(t.fec_conciliacion).slice(0, 10) : null,
      im5_acreditacion_est: t?.importe_acreditacion != null ? r2(t.importe_acreditacion) : null, actualizado_at: new Date().toISOString()
    };
  };
  const conMP = (f, m, motivo) => {
    usados.add(m.id_pago);
    const lib = m.acreditacion_at ? Date.parse(m.acreditacion_at) : 0;
    const dif = r2(Number(f.importe) - Number(m.monto || 0));
    let estado = 'conciliado';
    if (['refunded', 'cancelled', 'charged_back', 'rejected'].includes(m.estado)) estado = 'devuelto';
    else if (m.estado === 'no_encontrado') estado = 'falta_en_mp';
    else if (Math.abs(dif) > TOL_IMPORTE) estado = 'dif_importe';
    else if (m.estado !== 'approved') estado = 'revisar';
    else if (lib && lib > ahora) estado = 'pendiente_liberacion';
    if ((motivo === 'importe_hora' || motivo === 'cupon_mal') && (estado === 'conciliado' || estado === 'pendiente_liberacion')) estado = 'revisar';
    return { ...f, mp_pago_id: m.id_pago, mp_estado: m.estado, mp_monto: m.monto, mp_neto: m.neto, mp_comision: m.comision, mp_aprobado_at: m.aprobado_at,
      mp_liberacion_at: m.acreditacion_at, mp_origen: m.origen, estado, motivo_match: motivo, diferencia: estado === 'dif_importe' ? dif : 0 };
  };
  const sinMP = (f, estado) => ({ ...f, mp_pago_id: null, mp_estado: null, mp_monto: null, mp_neto: null, mp_comision: null, mp_aprobado_at: null, mp_liberacion_at: null, mp_origen: null,
    estado, motivo_match: null, diferencia: estado === 'falta_en_mp' ? r2(f.importe) : 0 });

  // Por id (Point/QR) o cupón primero. Los que no cruzan por número (sin cupón o cupón mal tipeado por la cajera)
  // se buscan después entre los pagos libres: mismo importe y hora (± 10 min), o mismo importe en el día con un
  // número parecido (hasta 2 dígitos distintos). Sólo con un candidato único, y siempre queda «Revisar».
  const sinId = [];
  for (const x of enRango) {
    const f = base(x);
    const idExt = str(x.p.id_pago_externo);
    const idCup = digitos(x.p.cupon);
    const m = (idExt && mpPorId.get(idExt)) || (idCup && mpPorId.get(idCup));
    if (m && Math.abs(Number(m.monto || 0) - Number(f.importe)) <= TOL_IMPORTE) { filas.push(conMP(f, m, idExt && mpPorId.get(idExt) ? 'id_externo' : 'cupon')); continue; }
    if (Number(f.importe) < 0) { filas.push(m ? conMP(f, m, 'cupon') : sinMP(f, 'devolucion')); continue; }
    sinId.push({ x, f, m, num: idExt || idCup });
  }
  const libres = () => [...mpPorId.values()].filter((m) => !usados.has(m.id_pago) && m.estado === 'approved' && m.aprobado_at);
  for (const { x, f, m: mNum, num } of sinId) {
    const t = x.c.fecha_hora ? Date.parse(x.c.fecha_hora) : 0;
    const mismoImporte = libres().filter((m) => Math.abs(Number(m.monto) - Number(f.importe)) <= TOL_IMPORTE);
    const porHora = t ? mismoImporte.filter((m) => Math.abs(Date.parse(m.aprobado_at) - t) <= TOL_MIN * 60e3) : [];
    const porNumero = num.length >= 6 && t ? mismoImporte.filter((m) => Math.abs(Date.parse(m.aprobado_at) - t) <= 18 * 3600e3 && distancia(num, m.id_pago) <= 2) : [];
    if (porNumero.length === 1) { const r = conMP(f, porNumero[0], 'cupon_mal'); filas.push({ ...r, estado: r.estado === 'conciliado' || r.estado === 'pendiente_liberacion' ? 'revisar' : r.estado }); continue; }
    if (porHora.length === 1) { filas.push(conMP(f, porHora[0], 'importe_hora')); continue; }
    // El número existe en MP pero con otro importe: diferencia real (no se busca otro pago).
    if (mNum) { filas.push(conMP(f, mNum, 'cupon')); continue; }
    filas.push(sinMP(f, porHora.length > 1 || porNumero.length > 1 ? 'revisar' : 'falta_en_mp'));
  }
  // Pagos aprobados de MP del rango que no aparecen en IM5.
  for (const m of mpRango) {
    if (usados.has(m.id_pago) || m.estado !== 'approved') continue;
    const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(m.aprobado_at));
    if (fecha < desde || fecha > hasta) continue;
    filas.push({ clave: `mp:${m.id_pago}`, empresa: null, im5_pago_id: null, fecha, fecha_hora: m.aprobado_at, medio: m.raw?.payment_method_id || null, comprobante: null, recibo: null,
      importe: null, cupon: null, mp_pago_id: m.id_pago, mp_estado: m.estado, mp_monto: m.monto, mp_neto: m.neto, mp_comision: m.comision, mp_aprobado_at: m.aprobado_at,
      mp_liberacion_at: m.acreditacion_at, mp_origen: m.origen, estado: 'falta_en_im5', motivo_match: null, diferencia: r2(m.monto),
      im5_conciliado: null, im5_fec_conciliacion: null, im5_acreditacion_est: null, actualizado_at: new Date().toISOString() });
  }

  // Guardado: reemplaza lo calculado del rango sin tocar lo grabado (grabado_im5_at / grabado_por / grabado_resumen).
  const unicas = [...new Map(filas.map((f) => [f.clave, f])).values()];
  const claves = new Set(unicas.map((f) => f.clave));
  for (const c of chunks(unicas, 500)) {
    const { error } = await admin.from('conciliacion_mp').upsert(c, { onConflict: 'clave' });
    if (error) throw new HttpError(500, error.message);
  }
  const viejas = await selTodo(() => admin.from('conciliacion_mp').select('clave').gte('fecha', desde).lte('fecha', hasta).is('grabado_im5_at', null).order('clave'));
  const borrar = viejas.map((v) => v.clave).filter((k) => !claves.has(k));
  for (const c of chunks(borrar, 300)) await admin.from('conciliacion_mp').delete().in('clave', c);

  const cuenta = {};
  filas.forEach((f) => { cuenta[f.estado] = (cuenta[f.estado] || 0) + 1; });
  return { ok: true, desde, hasta, filas: filas.length, porEstado: cuenta, im5: errIm5 ? { error: errIm5 } : { leidos: im5Conc.size, truncado: Boolean(truncado) } };
}

// ---------- 4) Grabar en IM5 ----------
// Arma lo que se mandaría (vista previa) o lo manda (confirmar). Sólo filas conciliadas, con liberación real
// pasada, sin grabar y que IM5 no tenga ya conciliadas. resumen = AAAAMMDD de la liberación (agrupa el día).
export async function grabarIm5({ claves = [], confirmar = false, quien = '', userId = null } = {}) {
  const lista = [...new Set((Array.isArray(claves) ? claves : []).map(str).filter((k) => /^im5:\d+:\d+$/.test(k)))].slice(0, 300);
  if (!lista.length) throw new HttpError(400, 'sin_filas');
  const filas = await sel(admin.from('conciliacion_mp').select('*').in('clave', lista));
  const hoy = hoyAR();
  const ok = []; const descartadas = [];
  for (const f of filas) {
    const lib = f.mp_liberacion_at ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(f.mp_liberacion_at)) : '';
    // «Revisar» (cruzó por importe/hora o cupón mal cargado) se graba si el admin lo eligió: mismo importe y pago aprobado.
    const revisable = f.estado === 'revisar' && f.mp_pago_id && f.mp_estado === 'approved' && Math.abs(Number(f.importe) - Number(f.mp_monto)) <= TOL_IMPORTE;
    const motivo = f.estado !== 'conciliado' && !revisable ? `estado ${f.estado}` : f.grabado_im5_at || f.im5_conciliado ? 'ya conciliado en IM5' : !lib || lib > hoy ? 'todavía no se liberó' : '';
    if (motivo) { descartadas.push({ clave: f.clave, comprobante: f.comprobante, motivo }); continue; }
    ok.push({ f, tarjeta: { id_pago: Number(f.im5_pago_id), conciliado: 'S', fec_conciliacion: hoy, lote: 0, liquidacion: 0, resumen: Number(lib.replace(/-/g, '')), fec_acreditacion: lib } });
  }
  const total = r2(ok.reduce((s, x) => s + Number(x.f.importe || 0), 0));
  const neto = r2(ok.reduce((s, x) => s + Number(x.f.mp_neto || 0), 0));
  const previa = { ok: true, confirmar, cantidad: ok.length, total, neto, tarjetas: ok.map((x) => ({ ...x.tarjeta, clave: x.f.clave, comprobante: x.f.comprobante, importe: x.f.importe, mp_pago_id: x.f.mp_pago_id })), descartadas };
  if (!confirmar || !ok.length) return previa;

  const cred = await leerCredenciales();
  if (!cred) throw new HttpError(400, 'im5_sin_credenciales');
  const im5 = new Im5(cred);
  const grabadas = []; const errores = [];
  try {
    await im5.login();
    for (const tanda of chunks(ok, 50)) {
      try {
        const r = await im5.req('/api/conciliacion-tarjetas/grabar', { method: 'POST', reintentos: 0, body: { tarjetas: tanda.map((x) => x.tarjeta), asientos: [] } });
        if (r && (r.success === false || r.ok === false)) throw new HttpError(502, `im5_grabar: ${str(r.error || r.message).slice(0, 150)}`);
        const ahora = new Date().toISOString();
        for (const x of tanda) {
          await admin.from('conciliacion_mp').update({ grabado_im5_at: ahora, grabado_por: quien || null, grabado_resumen: x.tarjeta.resumen, im5_conciliado: true, im5_fec_conciliacion: hoy }).eq('clave', x.f.clave);
          grabadas.push(x.f.clave);
        }
      } catch (e) { errores.push(str(e?.message).slice(0, 200)); break; }
    }
  } finally { await im5.cerrar(); }
  if (userId) await audit(userId, 'conciliacion_mp_grabar', 'im5', { cantidad: grabadas.length, total, errores });
  // Contador de grabados (la página avisa «primera vez: grabá uno solo» mientras sea 0).
  if (grabadas.length) await admin.rpc('conciliacion_contar_grabados', { p_n: grabadas.length });
  return { ...previa, grabadas: grabadas.length, errores };
}

// ---------- 5) Cron diario + avisos ----------
export async function cronConciliacion({ log = console } = {}) {
  const { data } = await admin.from('ventas_config').select('config').eq('id', 1).maybeSingle();
  const cfg = data?.config || {};
  const conc = cfg.conciliacion || {};
  if (conc.activa === false) return { ok: true, apagada: true };
  const hoy = hoyAR();
  const ayer = sumarDias(hoy, -1);
  const out = await cruzar({ desde: sumarDias(hoy, -DIAS_CRON), hasta: ayer, log });
  const dia = new Date(`${hoy}T12:00:00Z`);
  const destinos = destinosAviso(cfg);
  if (destinos.length && conc.avisos !== false) {
    const fmt = (n) => `$ ${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
    // Lunes: lo listo para grabar de la semana anterior + diferencias abiertas.
    if (dia.getUTCDay() === 1) {
      const r = (await admin.rpc('conciliacion_mp_resumen', { p_desde: sumarDias(hoy, -DIAS_CRON), p_hasta: ayer })).data || {};
      await mandar(destinos, 'Conciliación Mercado Pago: resumen semanal', plantillaMail({
        tono: r.diferencias ? 'error' : 'ok', etiqueta: 'Conciliación semanal', titulo: `${r.listos_grabar || 0} cobros listos para grabar en InfoManager`,
        intro: 'Entrá a Ventas del local → Conciliación, revisá y tocá «Grabar en IM5». Las diferencias necesitan que alguien las mire.',
        filas: [['Listos para grabar', String(r.listos_grabar || 0)], ['Diferencias abiertas', String(r.diferencias || 0)], ['Pendiente de liberar', fmt(r.pendiente_liberar)], ['Comisiones del período', fmt(r.comisiones)]]
      }));
    }
    // Día 1: cierre del mes anterior.
    if (dia.getUTCDate() === 1) {
      const d0 = `${sumarDias(hoy, -1).slice(0, 7)}-01`;
      const r = (await admin.rpc('conciliacion_mp_resumen', { p_desde: d0, p_hasta: ayer })).data || {};
      await mandar(destinos, `Conciliación Mercado Pago: cierre de ${d0.slice(0, 7)}`, plantillaMail({
        tono: r.diferencias || r.listos_grabar ? 'error' : 'ok', etiqueta: 'Cierre mensual', titulo: r.diferencias || r.listos_grabar ? 'Quedan cobros sin cerrar' : 'Mes conciliado',
        intro: 'Antes del cierre contable, todo lo del mes tiene que estar conciliado en InfoManager o con su motivo.',
        filas: [['Cobrado con MP (IM5)', fmt(r.cobrado_im5)], ['Acreditado (MP)', fmt(r.acreditado_mp)], ['Comisiones', fmt(r.comisiones)], ['Sin grabar en IM5', String(r.listos_grabar || 0)], ['Diferencias', String(r.diferencias || 0)]]
      }));
    }
  }
  return out;
}
