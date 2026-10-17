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
const TOL_IMPORTE = 0.10;                          // MP redondea a 10 centavos; IM5 guarda centavos
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
  // Vínculos hechos a mano desde la página (cobro IM5 → pago MP): mandan sobre cualquier otra regla.
  const manual = new Map((await selTodo(() => admin.from('conciliacion_mp_vinculos').select('clave,mp_pago_id').order('clave'))).map((v) => [v.clave, v.mp_pago_id]));
  const pedidos = [...new Set([...enRango.map(({ p }) => str(p.id_pago_externo) || digitos(p.cupon)), ...manual.values()].filter((id) => /^\d{6,20}$/.test(id) && !mpPorId.has(id)))];
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
  const usados = new Set([...manual.values()]);
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
    const vm = manual.get(f.clave);
    if (vm && mpPorId.get(vm)) { filas.push(conMP(f, mpPorId.get(vm), 'manual')); continue; }
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
  // Pagos aprobados de MP del rango que no aparecen en IM5 (sólo desde el primer día con cobros de IM5 bajados:
  // antes de eso no hay con qué cruzar).
  const desdeIm5 = [...reciboDe.values()].reduce((min, x) => (!min || x.c.fecha < min ? x.c.fecha : min), '');
  for (const m of mpRango) {
    if (usados.has(m.id_pago) || m.estado !== 'approved') continue;
    const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(m.aprobado_at));
    if (fecha < desde || fecha > hasta || !desdeIm5 || fecha < desdeIm5) continue;
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
  // Primera vez que el cruce ve cada fila (sirve para avisar sólo las diferencias nuevas).
  const nuevas = [];
  for (const c of chunks([...claves], 300)) {
    const { data } = await admin.from('conciliacion_mp').update({ visto_at: new Date().toISOString() }).in('clave', c).is('visto_at', null).select('clave,estado,resuelto_at');
    (data || []).forEach((r) => nuevas.push(r));
  }
  const viejas = await selTodo(() => admin.from('conciliacion_mp').select('clave').gte('fecha', desde).lte('fecha', hasta).is('grabado_im5_at', null).is('resuelto_at', null).order('clave'));
  const borrar = viejas.map((v) => v.clave).filter((k) => !claves.has(k));
  for (const c of chunks(borrar, 300)) await admin.from('conciliacion_mp').delete().in('clave', c);

  const cuenta = {};
  filas.forEach((f) => { cuenta[f.estado] = (cuenta[f.estado] || 0) + 1; });
  const DIFS = ['dif_importe', 'falta_en_mp', 'falta_en_im5', 'revisar'];
  return { ok: true, desde, hasta, filas: filas.length, porEstado: cuenta, nuevasDif: nuevas.filter((r) => DIFS.includes(r.estado) && !r.resuelto_at).map((r) => r.clave),
    im5: errIm5 ? { error: errIm5 } : { leidos: im5Conc.size, truncado: Boolean(truncado) } };
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
  // Primera vez: se graba uno solo, para revisarlo en la pantalla de IM5 antes de mandar el resto.
  const { data: vc } = await admin.from('ventas_config').select('config').eq('id', 1).maybeSingle();
  const primeraVez = !(Number(vc?.config?.conciliacion?.grabados) > 0);
  if (primeraVez && ok.length > 1) ok.splice(1);
  const total = r2(ok.reduce((s, x) => s + Number(x.f.importe || 0), 0));
  const neto = r2(ok.reduce((s, x) => s + Number(x.f.mp_neto || 0), 0));
  const previa = { ok: true, confirmar, primeraVez, cantidad: ok.length, total, neto, tarjetas: ok.map((x) => ({ ...x.tarjeta, clave: x.f.clave, comprobante: x.f.comprobante, importe: x.f.importe, mp_pago_id: x.f.mp_pago_id })), descartadas };
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
  // Verificación: se vuelve a leer IM5 y cada cupón grabado tiene que venir conciliado = S.
  let verificados = null;
  if (grabadas.length) {
    const fechas = ok.filter((x) => grabadas.includes(x.f.clave)).map((x) => x.f.fecha).sort();
    const { mapa, error } = await leerIm5Conciliados(fechas[0], fechas[fechas.length - 1]);
    verificados = error ? { error } : ok.filter((x) => grabadas.includes(x.f.clave)).map((x) => ({ id_pago: x.tarjeta.id_pago, comprobante: x.f.comprobante, conciliado: mapa.get(String(x.tarjeta.id_pago))?.conciliado || null, fec_conciliacion: mapa.get(String(x.tarjeta.id_pago))?.fec_conciliacion || null, fec_acreditacion_real: mapa.get(String(x.tarjeta.id_pago))?.fec_acreditacion_real || null }));
  }
  return { ...previa, grabadas: grabadas.length, errores, verificados };
}

// ---------- 5) Resolver a mano ----------
const RESOLUCIONES = ['aceptado', 'otro_canal', 'fuera_de_im5', 'error_cajera', 'ignorado'];
export async function resolver({ clave, accion, mp_pago_id = '', nota = '', quien = '' } = {}) {
  clave = str(clave);
  const fila = (await sel(admin.from('conciliacion_mp').select('*').eq('clave', clave)))[0];
  if (!fila) throw new HttpError(404, 'fila_no_encontrada');
  const ahora = new Date().toISOString();
  nota = str(nota).trim().slice(0, 300) || null;
  if (accion === 'vincular') {
    // Vincula un cobro de IM5 con un pago de MP (desde cualquiera de las dos filas).
    const mpId = digitos(mp_pago_id || fila.mp_pago_id);
    const im5Clave = clave.startsWith('im5:') ? clave : str(mp_pago_id);
    const pagoId = clave.startsWith('im5:') ? mpId : digitos(fila.mp_pago_id);
    if (!/^im5:\d+:\d+$/.test(im5Clave) || !/^\d{6,20}$/.test(pagoId)) throw new HttpError(400, 'vinculo_invalido');
    await admin.from('conciliacion_mp_vinculos').delete().eq('mp_pago_id', pagoId);
    const { error } = await admin.from('conciliacion_mp_vinculos').upsert({ clave: im5Clave, mp_pago_id: pagoId, nota, creado_por: quien || null, creado_at: ahora }, { onConflict: 'clave' });
    if (error) throw new HttpError(500, error.message);
    await admin.from('conciliacion_mp').update({ resolucion: null, resolucion_nota: null, resuelto_por: null, resuelto_at: null }).eq('clave', im5Clave);
    if (fila.clave.startsWith('mp:')) await admin.from('conciliacion_mp').delete().eq('clave', fila.clave).is('grabado_im5_at', null);
    else await admin.from('conciliacion_mp').delete().eq('clave', `mp:${pagoId}`).is('grabado_im5_at', null);
    const im5Fila = clave.startsWith('im5:') ? fila : (await sel(admin.from('conciliacion_mp').select('fecha').eq('clave', im5Clave)))[0];
    const d = im5Fila?.fecha || fila.fecha;
    await cruzar({ desde: d, hasta: d, bajarMP: false });
    return { ok: true, fila: (await sel(admin.from('conciliacion_mp').select('*').eq('clave', im5Clave)))[0] || null };
  }
  if (accion === 'deshacer') {
    await admin.from('conciliacion_mp_vinculos').delete().eq('clave', clave);
    await admin.from('conciliacion_mp').update({ resolucion: null, resolucion_nota: null, resuelto_por: null, resuelto_at: null }).eq('clave', clave);
    await cruzar({ desde: fila.fecha, hasta: fila.fecha, bajarMP: false });
    return { ok: true, fila: (await sel(admin.from('conciliacion_mp').select('*').eq('clave', clave)))[0] || null };
  }
  if (!RESOLUCIONES.includes(accion)) throw new HttpError(400, 'accion_invalida');
  const { error } = await admin.from('conciliacion_mp').update({ resolucion: accion, resolucion_nota: nota, resuelto_por: quien || null, resuelto_at: ahora }).eq('clave', clave);
  if (error) throw new HttpError(500, error.message);
  return { ok: true, fila: { ...fila, resolucion: accion, resolucion_nota: nota, resuelto_por: quien, resuelto_at: ahora } };
}

// Candidatos para vincular: pagos de MP libres ± 2 días con importe y número parecidos (o, desde un pago de MP,
// cobros de IM5 sin pago).
export async function candidatos({ clave } = {}) {
  const fila = (await sel(admin.from('conciliacion_mp').select('*').eq('clave', str(clave))))[0];
  if (!fila) throw new HttpError(404, 'fila_no_encontrada');
  const t = Date.parse(fila.fecha_hora || `${fila.fecha}T15:00:00-03:00`);
  const d0 = new Date(t - 2 * 86400e3).toISOString(); const d1 = new Date(t + 2 * 86400e3).toISOString();
  if (fila.clave.startsWith('im5:')) {
    const usados = new Set((await selTodo(() => admin.from('conciliacion_mp').select('mp_pago_id').not('mp_pago_id', 'is', null).like('clave', 'im5:%').gte('fecha', fila.fecha.slice(0, 8) + '01').order('clave'))).map((r) => r.mp_pago_id));
    const mps = await sel(admin.from('im5_mp_pagos').select('id_pago,estado,monto,neto,aprobado_at,acreditacion_at,origen').gte('aprobado_at', d0).lte('aprobado_at', d1).eq('estado', 'approved').limit(2000));
    const cup = digitos(fila.cupon);
    const lista = mps.filter((m) => m.id_pago !== fila.mp_pago_id || fila.estado !== 'conciliado').map((m) => ({
      tipo: 'mp', id: m.id_pago, monto: m.monto, neto: m.neto, fecha_hora: m.aprobado_at, liberacion: m.acreditacion_at, origen: m.origen, usado: usados.has(m.id_pago) && m.id_pago !== fila.mp_pago_id,
      dif: r2(Number(m.monto) - Number(fila.importe)), minutos: Math.round(Math.abs(Date.parse(m.aprobado_at) - t) / 60e3), parecido: cup ? distancia(cup, m.id_pago) : 9
    })).filter((c) => Math.abs(c.dif) <= Math.max(1, Math.abs(Number(fila.importe)) * 0.05) || c.parecido <= 3)
      .sort((a, b) => (a.usado - b.usado) || (Math.abs(a.dif) > 0.01) - (Math.abs(b.dif) > 0.01) || a.parecido - b.parecido || a.minutos - b.minutos).slice(0, 10);
    return { ok: true, fila, candidatos: lista };
  }
  const im5 = await sel(admin.from('conciliacion_mp').select('clave,comprobante,medio,importe,cupon,fecha_hora,estado').like('clave', 'im5:%').in('estado', ['falta_en_mp', 'revisar', 'dif_importe']).gte('fecha_hora', d0).lte('fecha_hora', d1).limit(500));
  const lista = im5.map((x) => ({ tipo: 'im5', id: x.clave, comprobante: x.comprobante, medio: x.medio, monto: x.importe, cupon: x.cupon, fecha_hora: x.fecha_hora, estado: x.estado,
    dif: r2(Number(fila.mp_monto) - Number(x.importe)), minutos: Math.round(Math.abs(Date.parse(x.fecha_hora) - t) / 60e3), parecido: x.cupon ? distancia(digitos(x.cupon), fila.mp_pago_id) : 9 }))
    .filter((c) => Math.abs(c.dif) <= Math.max(1, Math.abs(Number(fila.mp_monto)) * 0.05) || c.parecido <= 3)
    .sort((a, b) => (Math.abs(a.dif) > 0.01) - (Math.abs(b.dif) > 0.01) || a.parecido - b.parecido || a.minutos - b.minutos).slice(0, 10);
  return { ok: true, fila, candidatos: lista };
}

// ---------- 6) Programación ----------
const CONC_DEF = { activa: true, grabarAuto: false, modo: 'diario', cadaHoras: 6, cadaDias: 1, dias: [1, 2, 3, 4, 5, 6], hora: 7, desde: 8, hasta: 21, diasAtras: DIAS_CRON, mails: '', diaListos: 1,
  avisos: { diferencias: true, resumen: false, listos: true, cierre: true, falla: true } };
export const configConc = (cfg) => { const c = (cfg && cfg.conciliacion) || {}; return { ...CONC_DEF, ...c, avisos: { ...CONC_DEF.avisos, ...(c.avisos || {}) } }; };
const partesAR = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
};
export function tocaConciliar(c, ultimaAt, now = new Date()) {
  if (c.activa === false) return false;
  const a = partesAR(now);
  const u = ultimaAt ? partesAR(new Date(ultimaAt)) : null;
  const desdeUltima = ultimaAt ? (now.getTime() - Date.parse(ultimaAt)) / 3600e3 : Infinity;
  if (c.modo === 'horas') return a.hora >= c.desde && a.hora <= c.hasta && desdeUltima >= c.cadaHoras - 0.2;
  if (a.hora !== Number(c.hora)) return false;
  if (u && u.dia === a.dia) return false;
  if (c.modo === 'semanal') return (c.dias || []).includes(a.dow);
  if (c.modo === 'cada_dias') return desdeUltima >= c.cadaDias * 24 - 1.5;
  return true; // diario
}
export function proximaConciliacion(c, ultimaAt, now = new Date()) {
  if (c.activa === false) return null;
  let t = Math.ceil(now.getTime() / 3600e3) * 3600e3 + 20 * 60e3; // el job corre a los :20
  for (let i = 0; i < 24 * 40; i++, t += 3600e3) if (tocaConciliar(c, ultimaAt, new Date(t))) return new Date(t).toISOString();
  return null;
}
export function textoFrecuencia(c) {
  if (c.activa === false) return 'Apagada';
  const h = (n) => `${String(n).padStart(2, '0')}:00`;
  if (c.modo === 'horas') return `Cada ${c.cadaHoras} h, de ${h(c.desde)} a ${h(c.hasta)}`;
  if (c.modo === 'semanal') return `Los ${(c.dias || []).map((d) => ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d]).join(', ')} a las ${h(c.hora)}`;
  if (c.modo === 'cada_dias') return `Cada ${c.cadaDias} día${c.cadaDias === 1 ? '' : 's'} a las ${h(c.hora)}`;
  return `Todos los días a las ${h(c.hora)}`;
}

// ---------- 7) Avisos por mail ----------
const ESTADO_TXT = { conciliado: ['Conciliado', '#1f7a4c', '#e3f5ec'], pendiente_liberacion: ['A liberar', '#1f5fbf', '#e6efff'], revisar: ['Revisar', '#9a6200', '#fff3dd'],
  dif_importe: ['Diferencia', '#b42338', '#ffecef'], falta_en_mp: ['No está en MP', '#b42338', '#ffecef'], falta_en_im5: ['No está en IM5', '#9a6200', '#fff3dd'],
  devuelto: ['Devuelto en MP', '#9a6200', '#fff3dd'], devolucion: ['Devolución', '#4f638c', '#eef2fb'] };
const esc = (v) => str(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pesosM = (n) => (n == null ? '—' : `$ ${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const diaHoraM = (ts) => (ts ? new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts)) : '—');
// Plantilla de los mails de conciliación: tarjeta blanca sobre celeste, chip de estado, KPIs en fila, tabla de
// detalle con estados en color y botón a la página. Estilos en línea (los clientes de correo ignoran <style>).
export function plantillaConc({ tono = 'info', etiqueta, titulo, intro, kpis = [], filas = [], masFilas = 0, pie = '', prueba = false }) {
  const C = { ok: ['#1f7a4c', '#e3f5ec', '#bfe5cf'], error: ['#b42338', '#ffecef', '#f5c2cb'], aviso: ['#9a6200', '#fff3dd', '#f3d9a4'], info: ['#1f5fbf', '#e6efff', '#c5d8fb'] }[tono] || ['#1f5fbf', '#e6efff', '#c5d8fb'];
  const url = 'https://www.lajamonera.online/ventaslocal.html#conciliacion';
  const kpiHtml = kpis.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin:4px -8px 14px;"><tr>${kpis.map(([k, v, color]) => `
      <td style="background:#f6f9ff;border:1px solid #e2e8fb;border-radius:12px;padding:10px 12px;vertical-align:top;">
        <div style="font-size:11px;color:#6b7da3;text-transform:uppercase;letter-spacing:.04em;font-weight:700;">${esc(k)}</div>
        <div style="font-size:18px;font-weight:800;color:${color || '#1f2a44'};margin-top:3px;white-space:nowrap;">${esc(v)}</div></td>`).join('')}</tr></table>` : '';
  const tabla = filas.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8fb;border-radius:12px;overflow:hidden;font-size:12px;">
      <tr style="background:#f1f5fe;">${['Fecha', 'Cobro en IM5', 'IM5', 'Mercado Pago', 'Estado'].map((h, i) => `<th align="${i === 2 ? 'right' : 'left'}" style="padding:8px 10px;color:#4f638c;font-size:11px;text-transform:uppercase;letter-spacing:.04em;">${h}</th>`).join('')}</tr>
      ${filas.map((f, i) => { const [t, c, b] = ESTADO_TXT[f.estado] || [f.estado, '#4f638c', '#eef2fb']; return `<tr style="background:${i % 2 ? '#fbfcff' : '#ffffff'};">
        <td style="padding:8px 10px;border-top:1px solid #eef2fb;color:#1f2a44;white-space:nowrap;">${esc(diaHoraM(f.fecha_hora))}</td>
        <td style="padding:8px 10px;border-top:1px solid #eef2fb;color:#1f2a44;"><b>${esc(f.comprobante || 'Sin cobro en IM5')}</b><br><span style="color:#6b7da3;">${esc(f.medio || '')}${f.cupon ? ` · ${esc(f.cupon)}` : ''}</span></td>
        <td align="right" style="padding:8px 10px;border-top:1px solid #eef2fb;color:#1f2a44;white-space:nowrap;font-weight:700;">${esc(pesosM(f.importe))}</td>
        <td style="padding:8px 10px;border-top:1px solid #eef2fb;color:#1f2a44;">${f.mp_pago_id ? `#${esc(f.mp_pago_id)}<br><span style="color:#6b7da3;">${esc(pesosM(f.mp_monto))}</span>` : '<span style="color:#6b7da3;">—</span>'}</td>
        <td style="padding:8px 10px;border-top:1px solid #eef2fb;"><span style="display:inline-block;background:${b};color:${c};border-radius:999px;padding:3px 9px;font-weight:700;white-space:nowrap;">${esc(t)}</span></td></tr>`; }).join('')}
    </table>${masFilas ? `<p style="margin:6px 0 0;color:#6b7da3;font-size:12px;">y ${masFilas} más en la página.</p>` : ''}` : '';
  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#f4f7ff;padding:18px;">
      <div style="max-width:760px;margin:0 auto;background:#fff;border:1px solid #dbe4fb;border-radius:18px;padding:20px;">
        ${prueba ? '<p style="margin:0 0 14px;padding:8px 12px;border-radius:12px;background:#fff3dd;color:#9a6200;font-size:12px;font-weight:700;">Mail de prueba · así llegan los avisos de conciliación (datos reales de los últimos días)</p>' : ''}
        <p style="margin:0 0 12px;">
          <img src="https://www.lajamonera.online/IMG/La%20Jamonera%20App%20180.png" alt="La Jamonera" width="36" height="36" style="vertical-align:middle;border-radius:10px;">
          <span style="vertical-align:middle;margin-left:8px;font-size:16px;color:#2351a0;"><span style="font-weight:400">La</span> <strong>Jamonera</strong> · Conciliación Mercado Pago</span>
        </p>
        <span style="display:inline-block;background:${C[1]};color:${C[0]};border:1px solid ${C[2]};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700;">${esc(etiqueta)}</span>
        <h2 style="margin:12px 0 6px;color:#2351a0;font-size:22px;">${esc(titulo)}</h2>
        <p style="margin:0 0 14px;color:#4f638c;line-height:1.55;">${esc(intro)}</p>
        ${kpiHtml}${tabla}
        <p style="margin:18px 0 12px;"><a href="${url}" style="display:inline-block;background:#1f7ae8;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:12px;font-weight:700;">Abrir Conciliación</a></p>
        ${pie ? `<p style="margin:0 0 10px;color:#5f729b;font-size:13px;line-height:1.5;">${esc(pie)}</p>` : ''}
        <p style="margin:14px 0 0;padding-top:12px;border-top:1px solid #e2e8fb;color:#7d8db0;font-size:12px;line-height:1.5;">Aviso automático del Back Office de La Jamonera · powered by ABR. Los avisos y destinatarios se cambian en Ventas del local → Configuración → Conciliación.</p>
      </div>
    </div>`;
}
const destinosConc = (cfg, c) => (str(c.mails).trim() ? str(c.mails).split(',').map((x) => x.trim()).filter(Boolean) : destinosAviso(cfg));
const fmt0 = (n) => `$ ${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
async function datosAviso(tipo, { claves = null, desde, hasta, error = '' } = {}) {
  const r = (await admin.rpc('conciliacion_mp_resumen', { p_desde: desde, p_hasta: hasta })).data || {};
  const DIFS = ['dif_importe', 'falta_en_mp', 'falta_en_im5', 'revisar'];
  let q = admin.from('conciliacion_mp').select('fecha_hora,comprobante,medio,cupon,importe,mp_pago_id,mp_monto,estado').gte('fecha', desde).lte('fecha', hasta).order('fecha_hora', { ascending: false }).limit(25);
  if (claves) q = q.in('clave', claves.slice(0, 300));
  else if (tipo === 'listos') q = q.eq('estado', 'conciliado').is('grabado_im5_at', null);
  else q = q.in('estado', DIFS).is('resuelto_at', null);
  const filas = (tipo === 'falla') ? [] : await sel(q);
  const kpisBase = [['Cobrado con MP', fmt0(r.cobrado_im5)], ['Comisiones', fmt0(r.comisiones)], ['Diferencias', String(r.diferencias || 0), r.diferencias ? '#b42338' : '#1f7a4c'], ['Listos para grabar', String(r.listos_grabar || 0), '#1f5fbf']];
  const total = claves ? claves.length : tipo === 'listos' ? Number(r.listos_grabar || 0) : Number(r.diferencias || 0);
  const mas = Math.max(0, total - filas.length);
  const T = {
    diferencias: { tono: 'error', etiqueta: 'Diferencias nuevas', titulo: `${total} cobro${total === 1 ? '' : 's'} con diferencias`, intro: 'El último cruce encontró cobros que no coinciden entre InfoManager y Mercado Pago. Revisalos y resolvelos desde la página (vincular, aceptar o marcar el motivo).' },
    resumen: { tono: r.diferencias ? 'aviso' : 'ok', etiqueta: 'Cruce terminado', titulo: r.diferencias ? `Conciliación al día con ${r.diferencias} diferencias` : 'Conciliación al día', intro: `Se cruzaron los cobros del ${desde.split('-').reverse().join('/')} al ${hasta.split('-').reverse().join('/')}.` },
    listos: { tono: 'info', etiqueta: 'Listos para grabar', titulo: `${r.listos_grabar || 0} cupones listos para grabar en InfoManager`, intro: 'Están conciliados y Mercado Pago ya liberó la plata. Entrá, revisá la vista previa y tocá «Grabar en IM5».' },
    cierre: { tono: r.diferencias || r.listos_grabar ? 'aviso' : 'ok', etiqueta: 'Cierre del mes', titulo: r.diferencias || r.listos_grabar ? 'Quedan cobros sin cerrar' : 'Mes conciliado', intro: 'Antes del cierre contable, todo lo del mes tiene que estar grabado en InfoManager o resuelto con su motivo.' },
    falla: { tono: 'error', etiqueta: 'Falló el cruce', titulo: 'No se pudo conciliar', intro: `El cruce automático falló: ${error || 'sin detalle'}. Se vuelve a intentar en la próxima corrida programada.` }
  }[tipo];
  return { ...T, kpis: tipo === 'falla' ? [] : kpisBase, filas, masFilas: mas, pie: tipo === 'listos' ? 'Al grabar se marca cada cupón como conciliado en IM5 (Conciliación de Tarjetas) con la fecha de acreditación real de Mercado Pago.' : '' };
}
async function enviarAviso(cfg, c, tipo, opts) {
  const destinos = destinosConc(cfg, c);
  if (!destinos.length) return false;
  const d = await datosAviso(tipo, opts);
  const asunto = { diferencias: 'Conciliación MP: diferencias nuevas', resumen: 'Conciliación MP: cruce terminado', listos: 'Conciliación MP: cupones listos para grabar', cierre: `Conciliación MP: cierre de ${opts.hasta.slice(0, 7)}`, falla: 'Conciliación MP: falló el cruce' }[tipo];
  await mandar(destinos, asunto, plantillaConc(d));
  return true;
}
// Vista previa o prueba de un aviso desde Configuración (datos reales de los últimos 7 días).
export async function avisoPrueba({ tipo = 'diferencias', enviar = false } = {}) {
  if (!['diferencias', 'resumen', 'listos', 'cierre', 'falla'].includes(tipo)) throw new HttpError(400, 'tipo_invalido');
  const { data } = await admin.from('ventas_config').select('config').eq('id', 1).maybeSingle();
  const cfg = data?.config || {}; const c = configConc(cfg);
  const hasta = sumarDias(hoyAR(), -1); const desde = sumarDias(hasta, -6);
  const d = await datosAviso(tipo, { desde, hasta, error: 'mp_sin_respuesta: ejemplo de prueba' });
  const html = plantillaConc({ ...d, prueba: true });
  if (!enviar) return { ok: true, html };
  const destinos = destinosConc(cfg, c);
  if (!destinos.length) throw new HttpError(400, 'sin_mail_avisos');
  await mandar(destinos, `[Prueba] Conciliación MP: ${d.etiqueta.toLowerCase()}`, html);
  return { ok: true, destinos };
}

// ---------- 8) Cron (cada hora; decide según la config) ----------
export async function cronConciliacion({ forzar = false, log = console } = {}) {
  const { data } = await admin.from('ventas_config').select('config').eq('id', 1).maybeSingle();
  const cfg = data?.config || {};
  const c = configConc(cfg);
  const est = (await sel(admin.from('conciliacion_mp_estado').select('*').eq('id', 1)))[0] || {};
  const now = new Date();
  if (!forzar && !tocaConciliar(c, est.ultima_at, now)) {
    const proxima = proximaConciliacion(c, est.ultima_at, now);
    if (proxima !== est.proxima_at) await admin.from('conciliacion_mp_estado').update({ proxima_at: proxima, updated_at: now.toISOString() }).eq('id', 1);
    return { ok: true, toca: false, proxima };
  }
  const hoy = hoyAR(); const hasta = sumarDias(hoy, -1); const desde = sumarDias(hoy, -c.diasAtras);
  const avisos = { ...(est.ultimo_aviso || {}) };
  let out; let error = '';
  try { out = await cruzar({ desde, hasta: c.modo === 'horas' ? hoy : hasta, log }); }
  catch (e) { error = str(e?.message).slice(0, 300); }
  const a = partesAR(now);
  try {
    if (error) {
      const ult = avisos.falla ? Date.parse(avisos.falla) : 0;
      if (c.avisos.falla && Date.now() - ult > 24 * 3600e3 && await enviarAviso(cfg, c, 'falla', { desde, hasta, error })) avisos.falla = now.toISOString();
    } else {
      if (c.avisos.diferencias && out.nuevasDif?.length) await enviarAviso(cfg, c, 'diferencias', { claves: out.nuevasDif, desde, hasta: hoy });
      if (c.avisos.resumen) await enviarAviso(cfg, c, 'resumen', { desde, hasta });
      if (c.avisos.listos && a.dow === Number(c.diaListos) && avisos.listos !== a.dia && await enviarAviso(cfg, c, 'listos', { desde, hasta })) avisos.listos = a.dia;
      if (c.avisos.cierre && a.dia.endsWith('-01') && avisos.cierre !== a.dia.slice(0, 7)) {
        const d0 = `${sumarDias(a.dia, -1).slice(0, 7)}-01`;
        if (await enviarAviso(cfg, c, 'cierre', { desde: d0, hasta: sumarDias(a.dia, -1) })) avisos.cierre = a.dia.slice(0, 7);
      }
    }
  } catch (e) { log.error?.(`[conc] avisos: ${e?.message}`); }
  // Grabado automático en IM5 (si está prendido): sólo lo conciliado por número exacto (id del Point, cupón o
  // vínculo manual) y ya liberado. Nunca lo que está en «Revisar». Respeta la regla de «primera vez: uno solo».
  let grabado = null;
  if (!error && c.grabarAuto) {
    try {
      const listos = (await selTodo(() => admin.from('conciliacion_mp').select('clave,mp_liberacion_at').eq('estado', 'conciliado').in('motivo_match', ['id_externo', 'cupon', 'manual'])
        .is('grabado_im5_at', null).not('im5_conciliado', 'is', true).like('clave', 'im5:%').lte('mp_liberacion_at', now.toISOString()).order('clave')))
        .map((r) => r.clave);
      if (listos.length) {
        const g = await grabarIm5({ claves: listos.slice(0, 300), confirmar: true, quien: 'automático' });
        const ok = (g.verificados || []).filter?.((v) => v.conciliado === 'S').length ?? 0;
        grabado = { grabadas: g.grabadas, verificadas: ok, errores: g.errores || [], total: g.total };
        if (g.errores?.length && c.avisos.falla) await enviarAviso(cfg, c, 'falla', { desde, hasta, error: `grabado automático en IM5: ${g.errores[0]}` });
      } else grabado = { grabadas: 0 };
    } catch (e) { grabado = { error: str(e?.message).slice(0, 200) }; log.error?.(`[conc] grabado auto: ${e?.message}`); }
  }
  const resultado = error ? { error } : { filas: out.filas, porEstado: out.porEstado, nuevasDif: out.nuevasDif?.length || 0, im5: out.im5, grabado };
  const historial = [{ at: now.toISOString(), ok: !error, ...resultado }, ...(Array.isArray(est.historial) ? est.historial : [])].slice(0, 20);
  await admin.from('conciliacion_mp_estado').update({ ultima_at: now.toISOString(), ultima_ok: !error, ultimo_error: error || null, ultimo_resultado: resultado,
    proxima_at: proximaConciliacion(c, now.toISOString(), new Date(now.getTime() + 60e3)), ultimo_aviso: avisos, historial, updated_at: now.toISOString() }).eq('id', 1);
  if (error) throw new HttpError(502, error);
  return { ...out, toca: true, grabado };
}
