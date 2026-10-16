// @ts-nocheck
// Ventas del POS (InfoManager) → Inventario y Producción.
// Cada renglón vendido de un artículo vinculado (Ventas del local → Productos) descuenta stock real:
//  · ingrediente de reventa → lotes de Inventario, el que vence primero (FEFO), con el mismo guardado atómico que el
//    autoegreso (auto_egreso_aplicar) y movimientos que la app ya muestra;
//  · receta → lotes producidos (FEFO sobre producido − repartos − egresos − ventas POS);
//  · ventas del usuario de reparto con observación (la dirección) → reparto en Producción (REP-POS-…).
// Reglas: sin stock se ignora (queda «sin_stock»), materia prima no se descuenta, cada renglón se aplica una vez
// (im5_aplicaciones), anuladas se revierten. Configuración en ventas_config.config.pos.
import { admin, HttpError, str } from './shared.ts';
import { getUnitMeta, recalcRecordStock, summarizeInventoryRecordForIndex, num } from './egresos-engine.ts';
import { refreshInventoryIndex } from './egresos.ts';

const TZ = 'America/Argentina/Buenos_Aires';
const EPS = 1e-6;
const SOURCE = 'pos_im5';
const MAX_COMPROBANTES = 400;

export const POS_DEFAULTS = {
  activo: false, desde: '', excluirMateriaPrima: true, iaSoloVencidos: true, avisarSinStock: true,
  repartos: { activo: true, usuario: 'BRENDA', exigeObs: true }
};
export function configPos(cfg) {
  const p = (cfg && typeof cfg.pos === 'object' && cfg.pos) || {};
  return { ...POS_DEFAULTS, ...p, repartos: { ...POS_DEFAULTS.repartos, ...(p.repartos || {}) } };
}
const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const r4 = (n) => Number(num(n).toFixed(4));
const r6 = (n) => Number(num(n).toFixed(6));
const roundQty = (q, meta) => (meta.category === 'unidad' || meta.category === 'paquete' ? Math.max(0, Math.round(q)) : Number(Math.max(0, q).toFixed(3)));
const ddmmyyyy = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const codigoComp = (c) => `${c.tipo} ${c.letra || ''} ${String(c.punto_venta || 0).padStart(4, '0')}-${String(c.numero || 0).padStart(8, '0')}`.replace(/\s+/g, ' ');
// Observación «útil»: IM5 pone «Factura IM5» por defecto.
const obsUtil = (o) => { const t = str(o).trim(); return t && !/^factura im5$/i.test(t) ? t : ''; };
// Se vende por unidad un artículo cuya descripción dice «x 12 u», «x 48», «promo…»: sin factor no se sabe cuántos kg son.
const pideFactorKg = (desc) => /\bx\s*\d+\s*(u\b|un\b|unid|und)|\bx\s*\d+\s*$|promo|caja/i.test(str(desc));

async function sel(q) { const { data, error } = await q; if (error) throw new HttpError(500, error.message); return data || []; }

// Ejecuta (o simula) la aplicación de ventas. Devuelve un resumen y, en simulación, el detalle por renglón.
// comprobante { empresa, id }: sólo ese (prueba o corrección manual); no mira el interruptor ni la fecha de inicio.
export async function aplicarVentasPos({ simular = false, desde = '', hasta = '', runId = `pos_${Date.now()}`, cfgVentas = null, log = console, comprobante = null } = {}) {
  if (!cfgVentas) {
    const { data } = await admin.from('ventas_config').select('config').eq('id', 1).maybeSingle();
    cfgVentas = data?.config || {};
  }
  const cfg = configPos(cfgVentas);
  const resumen = { runId, simular, comprobantes: 0, renglones: 0, aplicados: 0, sinStock: 0, excluidos: 0, repartos: 0, revertidos: 0, conflictos: 0, detalle: [] };
  const uno = comprobante?.id ? { empresa: Number(comprobante.empresa), id: Number(comprobante.id) } : null;
  if (!simular && !cfg.activo && !uno) return { ...resumen, apagado: true };
  const d0 = desde || cfg.desde || hoyAR();
  const d1 = hasta || hoyAR();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d0) || !/^\d{4}-\d{2}-\d{2}$/.test(d1)) throw new HttpError(400, 'fechas_invalidas');
  if (!simular && !uno && cfg.desde && d0 < cfg.desde) throw new HttpError(400, 'antes_de_inicio');

  // 1) Anuladas después de aplicadas: se revierten (devuelve stock a los mismos lotes).
  if (!simular && !uno) resumen.revertidos = await revertirAnuladas(runId, log);

  // 2) Vínculos confirmados, materia prima y comprobantes pendientes.
  const vinc = new Map((await sel(admin.from('im5_articulo_vinculos').select('cod_articulo,tipo,ref_id,factor').eq('estado', 'confirmado').neq('tipo', 'ninguno')))
    .map((v) => [v.cod_articulo, v]));
  const materiaPrima = new Set(cfg.excluirMateriaPrima ? (await sel(admin.rpc('pos_materia_prima'))).map((x) => (typeof x === 'string' ? x : Object.values(x)[0])) : []);
  let qc = admin.from('im5_comprobantes')
    .select('empresa,id,tipo,letra,punto_venta,numero,fecha,fecha_hora,usuario,cliente,cod_cliente,observaciones,anulada,items_ok')
    .eq('items_ok', true).eq('anulada', false).in('tipo', ['FA', 'NC']);
  qc = uno ? qc.eq('empresa', uno.empresa).eq('id', uno.id) : qc.gte('fecha', d0).lte('fecha', d1);
  const comps = await sel(qc.order('fecha').order('fecha_hora', { nullsFirst: true }).limit(5000));
  const hechos = new Set();
  for (let i = 0; i < comps.length; i += 300) {
    const ids = comps.slice(i, i + 300).map((c) => c.id);
    (await sel(admin.from('im5_aplicaciones').select('empresa,comprobante_id').in('comprobante_id', ids))).forEach((a) => hechos.add(`${a.empresa}:${a.comprobante_id}`));
  }
  const pendientes = comps.filter((c) => !hechos.has(`${c.empresa}:${c.id}`)).slice(0, MAX_COMPROBANTES);
  if (!pendientes.length) return resumen;

  const items = [];
  for (const emp of [...new Set(pendientes.map((c) => c.empresa))]) {
    const ids = pendientes.filter((c) => c.empresa === emp).map((c) => c.id);
    for (let i = 0; i < ids.length; i += 300) {
      items.push(...await sel(admin.from('im5_items').select('empresa,comprobante_id,orden,cod_articulo,descripcion,cantidad')
        .eq('empresa', emp).in('comprobante_id', ids.slice(i, i + 300)).order('comprobante_id').order('orden')));
    }
  }
  const itemsDe = new Map();
  items.forEach((it) => { const k = `${it.empresa}:${it.comprobante_id}`; if (!itemsDe.has(k)) itemsDe.set(k, []); itemsDe.get(k).push(it); });

  // 3) Datos de stock que hacen falta (cargados una vez, descontados en memoria a medida que se asigna).
  const ingIds = [...new Set(items.map((it) => vinc.get(it.cod_articulo)).filter((v) => v?.tipo === 'ingrediente').map((v) => v.ref_id))];
  const recIds = [...new Set(items.map((it) => vinc.get(it.cod_articulo)).filter((v) => v?.tipo === 'receta').map((v) => v.ref_id))];
  const registros = new Map((ingIds.length ? await sel(admin.from('inventario_registros').select('ingrediente_id,stock_unit,infinite_stock').in('ingrediente_id', ingIds)) : []).map((r) => [r.ingrediente_id, r]));
  const lotesDe = new Map();
  for (let i = 0; i < ingIds.length; i += 100) {
    (await sel(admin.from('inventario_lotes').select('id,ingrediente_id,fecha_ingreso,vencimiento,unidad,disponible,disponible_base,disponible_kg,estado,auto_egreso_state,no_perecedero,lote,factura,orden,created_at')
      .in('ingrediente_id', ingIds.slice(i, i + 100)).or('disponible.gt.0,disponible_base.gt.0')))
      .forEach((l) => {
        if (!lotesDe.has(l.ingrediente_id)) lotesDe.set(l.ingrediente_id, []);
        // Lotes viejos de unidades pueden traer disponible sin disponible_base: se toma el disponible.
        const meta = getUnitMeta(l.unidad);
        const b = num(l.disponible_base) > EPS ? num(l.disponible_base) : num(l.disponible) * meta.factor;
        lotesDe.get(l.ingrediente_id).push({ ...l, _base: b, _prev: l });
      });
  }
  for (const arr of lotesDe.values()) arr.sort((a, b) => (str(a.vencimiento) || '9999').localeCompare(str(b.vencimiento) || '9999') || str(a.fecha_ingreso).localeCompare(str(b.fecha_ingreso)) || str(a.created_at).localeCompare(str(b.created_at)));
  const prodDe = new Map();
  if (recIds.length) {
    (await sel(admin.rpc('pos_produccion_disponible', { p_recetas: recIds }))).forEach((p) => {
      if (!prodDe.has(p.receta_id)) prodDe.set(p.receta_id, []);
      prodDe.get(p.receta_id).push({ ...p, _kg: num(p.disponible) });
    });
    for (const arr of prodDe.values()) arr.sort((a, b) => str(a.vence).localeCompare(str(b.vence)) || str(a.fecha).localeCompare(str(b.fecha)));
  }
  const nombres = new Map();
  if (ingIds.length) (await sel(admin.from('ingredientes').select('id,nombre').in('id', ingIds))).forEach((i) => nombres.set(i.id, i.nombre));
  if (recIds.length) (await sel(admin.from('recetas').select('id,raw->>title,raw->>nombreComercial,raw->>imageUrl').in('id', recIds))).forEach((r) => nombres.set(r.id, { titulo: r.title, comercial: r.nombreComercial, img: r.imageUrl }));

  // 4) Asignación renglón por renglón (orden de venta).
  const filas = [];                 // im5_aplicaciones
  const movPorIng = new Map();      // ingrediente → { lotes: Map(loteId → lote), movs: [] }
  const repartos = [];
  for (const c of pendientes) {
    const its = itemsDe.get(`${c.empresa}:${c.id}`) || [];
    resumen.comprobantes += 1;
    const comp = codigoComp(c);
    const esReparto = cfg.repartos.activo && str(c.usuario).toUpperCase().startsWith(str(cfg.repartos.usuario).toUpperCase()) && (!cfg.repartos.exigeObs || obsUtil(c.observaciones));
    const reparto = esReparto ? { productos: [] } : null;
    const atTs = c.fecha_hora ? Date.parse(c.fecha_hora) : Date.parse(`${c.fecha}T15:00:00-03:00`);
    for (const it of its) {
      resumen.renglones += 1;
      const base = { empresa: c.empresa, comprobante_id: c.id, orden: it.orden, cod_articulo: it.cod_articulo, fecha: c.fecha, run_id: runId };
      const v = vinc.get(it.cod_articulo);
      const det = { comp, articulo: it.descripcion, cantidad: num(it.cantidad), reparto: Boolean(reparto) };
      const marca = (extra, estado, motivo) => {
        filas.push({ ...base, ...extra, estado, motivo });
        if (estado === 'aplicado') resumen.aplicados += 1; else if (estado === 'sin_stock') resumen.sinStock += 1; else resumen.excluidos += 1;
        if (simular) resumen.detalle.push({ ...det, estado, motivo, ...extra });
      };
      if (!v) { marca({ destino: 'inventario', ref_id: null }, 'excluido', 'sin vínculo'); continue; }
      if (c.tipo === 'NC') { marca({ destino: v.tipo === 'receta' ? 'produccion' : 'inventario', ref_id: v.ref_id }, 'excluido', 'nota de crédito: no se devuelve stock automáticamente'); continue; }
      const cant = num(it.cantidad) * (v.factor ? num(v.factor) : 1);
      if (cant <= EPS) { marca({ destino: v.tipo === 'receta' ? 'produccion' : 'inventario', ref_id: v.ref_id }, 'excluido', 'cantidad 0'); continue; }

      if (v.tipo === 'ingrediente') {
        const destino = { destino: 'inventario', ref_id: v.ref_id };
        if (materiaPrima.has(v.ref_id)) { marca(destino, 'excluido', 'materia prima (se descuenta con las producciones)'); continue; }
        const reg = registros.get(v.ref_id);
        if (!reg || reg.infinite_stock) { marca(destino, 'excluido', reg ? 'stock infinito' : 'sin registro de inventario'); continue; }
        const meta = getUnitMeta(reg.stock_unit);
        if ((meta.category === 'unidad' || meta.category === 'paquete' || meta.category === 'otro') && !v.factor && Math.abs(cant - Math.round(cant)) > EPS) {
          marca({ ...destino, cantidad: r4(cant), unidad: reg.stock_unit }, 'excluido', 'se vende por kilo y el stock es por unidad: falta el factor'); continue;
        }
        let pend = cant * meta.factor; // en base (g, ml o unidades)
        const lotes = (lotesDe.get(v.ref_id) || []).filter((l) => l._base > EPS && str(l.fecha_ingreso || '0000') <= c.fecha && (l.no_perecedero || !l.vencimiento || l.vencimiento >= c.fecha));
        for (const l of lotes) {
          if (pend <= EPS) break;
          const toma = Math.min(l._base, pend);
          l._base = r6(l._base - toma); pend = r6(pend - toma);
          const qty = toma / meta.factor;
          marca({ ...destino, lote_id: l.id, cantidad: r4(qty), unidad: reg.stock_unit, reparto_id: reparto ? 'pendiente' : null }, 'aplicado', `lote ${l.lote || l.factura || l.id}`);
          if (!movPorIng.has(v.ref_id)) movPorIng.set(v.ref_id, { meta, unidad: reg.stock_unit, lotes: new Map(), movs: [] });
          const g = movPorIng.get(v.ref_id);
          g.lotes.set(l.id, l);
          const k = `${c.empresa}_${c.id}_${it.orden}_${l.id}`;
          const kg = meta.category === 'peso' ? r4(toma / 1000) : 0;
          g.movs.push({ lote: l.id, origen: 'productionUsage', m: { id: `usage_pos_${k}`, createdAt: atTs, producedAt: atTs, productionDate: c.fecha, expiryDateAtProduction: reparto ? 'Reparto a domicilio (POS)' : 'Venta en mostrador (POS)',
            kilosUsed: kg, usedQty: roundQty(qty, meta), usedUnit: reg.stock_unit, usedBaseQty: r6(toma), lotNumber: l.lote || l.factura || '', ingredientLot: l.lote || '', productionId: `POS ${comp}`,
            internalUse: true, generatedAutomatically: true, source: SOURCE, note: `${reparto ? 'Reparto' : 'Venta POS'} · ${comp}` } });
          g.movs.push({ lote: l.id, origen: 'movementHistory', m: { id: `mh_pos_${k}`, createdAt: atTs, type: reparto ? 'egreso_reparto_pos' : 'egreso_venta_pos', reason: reparto ? 'Reparto a domicilio (POS)' : 'Venta en mostrador (POS)',
            qty: roundQty(qty, meta), qtyBase: r6(toma), qtyKg: kg, qtyUnit: reg.stock_unit, generatedAutomatically: true, source: SOURCE, reference: comp } });
          if (reparto) reparto.productos.push({ tipo: 'ingrediente', id: v.ref_id, nombre: nombres.get(v.ref_id) || '', qty: roundQty(qty, meta), unidad: reg.stock_unit, qtyKg: kg,
            alloc: { ingredientId: v.ref_id, entryId: l.id, lotNumber: l.lote || l.factura || '', qty: roundQty(qty, meta), unit: reg.stock_unit, qtyKg: kg, expiryDate: str(l.vencimiento) } });
        }
        if (pend > EPS) marca({ ...destino, cantidad: r4(pend / meta.factor), unidad: reg.stock_unit }, 'sin_stock', lotes.length ? 'no alcanzó el stock' : 'sin stock disponible');
      } else {
        const destino = { destino: 'produccion', ref_id: v.ref_id };
        if (!v.factor && pideFactorKg(it.descripcion) && Math.abs(num(it.cantidad) - Math.round(num(it.cantidad))) <= EPS) {
          marca({ ...destino, cantidad: r4(num(it.cantidad)), unidad: 'unidades' }, 'excluido', 'se vende por unidad: falta el factor (kg por unidad)'); continue;
        }
        let pend = cant;
        const prods = (prodDe.get(v.ref_id) || []).filter((p) => p._kg > EPS && str(p.fecha) <= c.fecha && (!p.vence || p.vence >= c.fecha));
        const allocs = [];
        for (const p of prods) {
          if (pend <= EPS) break;
          const toma = Math.min(p._kg, pend);
          p._kg = r4(p._kg - toma); pend = r4(pend - toma);
          marca({ ...destino, lote_id: p.produccion_id, cantidad: r4(toma), unidad: 'kilos', reparto_id: reparto ? 'pendiente' : null }, 'aplicado', `producción ${p.produccion_id}`);
          allocs.push({ productionId: p.produccion_id, lotNumber: p.produccion_id, productionDate: str(p.fecha), expiryDate: str(p.vence), availableKg: r4(p._kg + toma), qtyKg: r4(toma) });
        }
        if (pend > EPS) marca({ ...destino, cantidad: r4(pend), unidad: 'kilos' }, 'sin_stock', prods.length ? 'no alcanzó lo producido' : 'sin producción disponible (o vencida)');
        if (reparto && allocs.length) {
          const n = nombres.get(v.ref_id) || {};
          reparto.productos.push({ tipo: 'receta', id: v.ref_id, nombre: n.comercial || n.titulo || '', titulo: n.titulo || '', img: n.img || '', qtyKg: r4(allocs.reduce((s, a) => s + a.qtyKg, 0)), allocs });
        }
      }
    }
    if (reparto && reparto.productos.length) {
      const id = `reparto_pos_${c.empresa}_${c.id}`;
      repartos.push({ id, c, comp, productos: reparto.productos });
      filas.filter((f) => f.empresa === c.empresa && f.comprobante_id === c.id && f.reparto_id === 'pendiente').forEach((f) => { f.reparto_id = id; });
      resumen.repartos += 1;
      if (simular) resumen.detalle.push({ comp, reparto: true, estado: 'reparto', motivo: `Reparto a ${obsUtil(c.observaciones)} · ${reparto.productos.length} productos` });
    }
    filas.filter((f) => f.reparto_id === 'pendiente').forEach((f) => { f.reparto_id = null; });
  }
  if (simular) return resumen;

  // 5) Escritura. Inventario: un guardado atómico por ingrediente; si un lote cambió entretanto (conflicto),
  //    los renglones de ese ingrediente no se marcan y se reintentan en la próxima corrida.
  const fallidos = new Set();
  for (const [ingId, g] of movPorIng) {
    const lotRows = [...g.lotes.values()].map((l) => {
      const base = Math.max(0, l._base);
      return { id: l.id, prev_disponible: num(l._prev.disponible), prev_disponible_base: num(l._prev.disponible_base),
        disponible: roundQty(base / g.meta.factor, g.meta), disponible_base: r6(base), disponible_kg: g.meta.category === 'peso' ? r4(base / 1000) : num(l._prev.disponible_kg),
        estado: base <= EPS ? 'consumido_en_produccion' : (l._prev.estado || 'disponible'), auto_egreso_state: l._prev.auto_egreso_state || null };
    });
    const ordenBase = -(Date.now() * 1000);
    const movRows = g.movs.map((x, i) => ({ id: x.m.id, lote_id: x.lote, ingrediente_id: ingId, origen: x.origen, orden: ordenBase + i,
      tipo: x.m.type || null, fecha: new Date(x.m.createdAt).toISOString(), fecha_produccion: x.m.productionDate || null, produccion_id: x.m.productionId || x.m.reference || null,
      cantidad: x.m.usedQty ?? x.m.qty, unidad: x.m.usedUnit || x.m.qtyUnit || null, cantidad_base: x.m.usedBaseQty ?? x.m.qtyBase, cantidad_kg: x.m.kilosUsed ?? x.m.qtyKg,
      motivo: x.m.reason || null, nota: x.m.note || null, usuario: null, automatico: true, source: SOURCE, run_id: runId, datos: x.m }));
    const { data: res, error } = await admin.rpc('auto_egreso_aplicar', { p_lotes: lotRows, p_movs: movRows });
    if (error || res?.conflicts?.length) {
      fallidos.add(ingId); resumen.conflictos += 1;
      log.warn?.(`[pos] ${ingId}: ${error?.message || `conflictos ${res.conflicts.join(',')}`}`);
      if (res?.applied?.length) log.error?.(`[pos] ${ingId}: aplicado parcial ${res.applied.join(',')}`);
      continue;
    }
    try { await refreshInventoryIndex(ingId, hoyAR(), 4); } catch (e) { log.error?.(`[pos] índice ${ingId}: ${e.message}`); }
  }

  // Repartos (BRENDA + dirección) → Producción, igual que los guarda la app.
  for (const r of repartos) {
    const { c } = r;
    const registro = {
      id: r.id, code: `REP-POS-${ddmmyyyy(c.fecha)}-${String(c.numero || c.id).padStart(5, '0')}`, dispatchDate: c.fecha,
      clientId: '', vehicleId: '', managers: [], managerProfiles: [],
      comments: [`Reparto desde el POS · ${r.comp} · caja ${str(c.usuario)}`],
      proofs: [],
      clientSnapshot: { id: '', name: str(c.cliente) || 'Cliente', doc: str(c.cod_cliente), address: obsUtil(c.observaciones), city: '', province: '', country: 'Argentina' },
      products: r.productos.map((p) => (p.tipo === 'receta'
        ? { recipeId: p.id, recipeTitle: p.nombre || p.titulo, recipeImageUrl: p.img || '', qtyKg: p.qtyKg, sourceType: 'production', allocations: p.allocs }
        : { recipeId: p.id, recipeTitle: p.nombre, recipeImageUrl: '', qty: p.qty, qtyUnit: p.unidad, qtyKg: p.qtyKg, sourceType: 'ingredient', allocations: [p.alloc] })),
      importedFromPos: true, importedInvoice: { code: r.comp, empresa: c.empresa, id: c.id },
      createdAt: Date.now(), createdBy: 'POS (InfoManager)'
    };
    const { error } = await admin.rpc('pos_guardar_reparto', { p_id: r.id, r: registro });
    if (error) { log.error?.(`[pos] reparto ${r.id}: ${error.message}`); filas.filter((f) => f.reparto_id === r.id && f.destino === 'produccion').forEach((f) => { f._omitir = true; }); }
  }

  const aGuardar = filas.filter((f) => !f._omitir && !(f.destino === 'inventario' && fallidos.has(f.ref_id)));
  // Un comprobante con algún renglón no guardado se reintenta entero la próxima vez: se guardan sus filas sólo si están todas.
  const incompletos = new Set(filas.filter((f) => !aGuardar.includes(f)).map((f) => `${f.empresa}:${f.comprobante_id}`));
  const finales = aGuardar.filter((f) => !incompletos.has(`${f.empresa}:${f.comprobante_id}`));
  for (let i = 0; i < finales.length; i += 500) {
    const { error } = await admin.from('im5_aplicaciones').insert(finales.slice(i, i + 500).map(({ _omitir, ...f }) => f));
    if (error) throw new HttpError(500, error.message);
  }
  return resumen;
}

// Comprobantes anulados en IM5 después de aplicados: devuelve lo descontado a cada lote de Inventario y marca
// las filas como «revertido» (producción: al dejar de contar como «aplicado», el stock vuelve solo).
async function revertirAnuladas(runId, log) {
  const filas = await sel(admin.from('im5_aplicaciones').select('id,empresa,comprobante_id,orden,destino,ref_id,lote_id,cantidad,unidad,reparto_id')
    .eq('estado', 'aplicado').limit(2000));
  if (!filas.length) return 0;
  const comps = new Set();
  for (let i = 0; i < filas.length; i += 300) {
    const ids = [...new Set(filas.slice(i, i + 300).map((f) => f.comprobante_id))];
    (await sel(admin.from('im5_comprobantes').select('empresa,id').in('id', ids).eq('anulada', true))).forEach((c) => comps.add(`${c.empresa}:${c.id}`));
  }
  const revertir = filas.filter((f) => comps.has(`${f.empresa}:${f.comprobante_id}`));
  return revertir.length ? revertirFilas(revertir, runId, log) : 0;
}

// Deshace a mano lo aplicado de un comprobante (devuelve stock, borra movimientos y reparto). borrar: además
// quita sus filas para que pueda volver a aplicarse.
export async function revertirComprobantePos({ empresa, id, borrar = false, runId = `pos_rev_${Date.now()}`, log = console }) {
  const filas = await sel(admin.from('im5_aplicaciones').select('id,empresa,comprobante_id,orden,destino,ref_id,lote_id,cantidad,unidad,reparto_id')
    .eq('empresa', Number(empresa)).eq('comprobante_id', Number(id)).eq('estado', 'aplicado'));
  const revertidos = filas.length ? await revertirFilas(filas, runId, log, 'revertido a mano') : 0;
  if (borrar) {
    const { error } = await admin.from('im5_aplicaciones').delete().eq('empresa', Number(empresa)).eq('comprobante_id', Number(id)).neq('estado', 'aplicado');
    if (error) throw new HttpError(500, error.message);
  }
  return { revertidos, filas: filas.length };
}

export async function revertirFilas(revertir, runId, log = console, motivo = 'comprobante anulado en IM5') {
  let n = 0;
  const porIng = new Map();
  revertir.filter((f) => f.destino === 'inventario' && f.lote_id).forEach((f) => { if (!porIng.has(f.ref_id)) porIng.set(f.ref_id, []); porIng.get(f.ref_id).push(f); });
  for (const [ingId, fs] of porIng) {
    const lotes = await sel(admin.from('inventario_lotes').select('id,unidad,disponible,disponible_base,disponible_kg,estado,auto_egreso_state').in('id', [...new Set(fs.map((f) => f.lote_id))]));
    const reg = (await sel(admin.from('inventario_registros').select('stock_unit').eq('ingrediente_id', ingId)))[0] || {};
    const meta = getUnitMeta(reg.stock_unit);
    const lotRows = lotes.map((l) => {
      const suma = fs.filter((f) => f.lote_id === l.id).reduce((s, f) => s + num(f.cantidad) * meta.factor, 0);
      const base = r6(num(l.disponible_base) + suma);
      return { id: l.id, prev_disponible: num(l.disponible), prev_disponible_base: num(l.disponible_base), disponible: roundQty(base / meta.factor, meta), disponible_base: base,
        disponible_kg: meta.category === 'peso' ? r4(base / 1000) : num(l.disponible_kg), estado: 'disponible', auto_egreso_state: l.auto_egreso_state || null };
    });
    const { data: res, error } = await admin.rpc('auto_egreso_aplicar', { p_lotes: lotRows, p_movs: [] });
    if (error || res?.conflicts?.length) { log.warn?.(`[pos] revertir ${ingId}: ${error?.message || 'conflicto'}`); continue; }
    // Los movimientos «Venta POS» de esos renglones se borran para que el historial quede como antes.
    const movIds = fs.flatMap((f) => { const k = `${f.empresa}_${f.comprobante_id}_${f.orden}_${f.lote_id}`; return [`usage_pos_${k}`, `mh_pos_${k}`]; });
    for (let i = 0; i < movIds.length; i += 200) await admin.from('movimientos').delete().in('id', movIds.slice(i, i + 200)).eq('source', SOURCE);
    try { await refreshInventoryIndex(ingId, hoyAR(), 4); } catch { /* el índice se rehace en la próxima */ }
    const ids = fs.map((f) => f.id);
    await admin.from('im5_aplicaciones').update({ estado: 'revertido', motivo, run_id: runId }).in('id', ids);
    n += ids.length;
  }
  const prodIds = revertir.filter((f) => f.destino !== 'inventario').map((f) => f.id);
  if (prodIds.length) { await admin.from('im5_aplicaciones').update({ estado: 'revertido', motivo, run_id: runId }).in('id', prodIds); n += prodIds.length; }
  // El reparto creado desde ese comprobante se borra (sus asignaciones dejan de descontar lo producido).
  for (const id of [...new Set(revertir.map((f) => f.reparto_id).filter(Boolean))]) {
    const { error } = await admin.rpc('pos_borrar_reparto', { p_id: id });
    if (error) log.warn?.(`[pos] borrar reparto ${id}: ${error.message}`);
  }
  return n;
}
