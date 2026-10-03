// @ts-nocheck
// Auto-egresos sobre Supabase: mismo motor que la Cloud Function (egresos-engine.ts, copia literal),
// con lectura de inventario_registros / inventario_lotes y escritura atómica por ingrediente.
import { admin, secretGet, str } from './shared.ts';
import * as gemini from './gemini.ts';
import {
  DEFAULTS, EPS, createEngine, collectYearsToFetch, withDefaultWeeklyConfig, safeObj, normalizeText, num,
  summarizeInventoryRecordForIndex, recalcRecordStock
} from './egresos-engine.ts';

// Como RTDB: sin null, sin arrays/objetos vacíos (así queda igual que el índice que escribía Firebase).
export const rtdbClean = (v) => {
  if (Array.isArray(v)) { const a = v.map(rtdbClean).filter((x) => x !== undefined); return a.length ? a : undefined; }
  if (v && typeof v === 'object') { const o = {}; Object.entries(v).forEach(([k, x]) => { const c = rtdbClean(x); if (c !== undefined) o[k] = c; }); return Object.keys(o).length ? o : undefined; }
  return v === null || (typeof v === 'number' && !Number.isFinite(v)) ? undefined : v;
};

// Tras escribir lotes/movimientos: recalcula /inventario_index/items/{id} como la Cloud Function
// (recalcRecordStock + summarizeInventoryRecordForIndex sobre el registro con forma de Firebase)
// y toca /_index_meta/inventario_index.
export async function refreshInventoryIndex(ingredientId, todayIso, version) {
  const { data: record, error } = await admin.rpc('auto_egreso_record', { p_ing: ingredientId });
  if (error) throw new Error(error.message);
  if (!record) return null;
  recalcRecordStock(record);
  const summary = rtdbClean(summarizeInventoryRecordForIndex(record, ingredientId, todayIso)) || {};
  const { error: e2 } = await admin.rpc('auto_egreso_index_set', { p_ing: ingredientId, p_summary: summary, p_version: version });
  if (e2) throw new Error(e2.message);
  return summary;
}

const JOB = 'auto_egresos';
const LOCK_SECONDS = 9 * 60;
const EDGE_DEFAULTS = { MAX_RUN_MILLIS: 110000, MAX_PRODUCTS_PER_RUN: 60 };

const ts = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? new Date(Number(ms)).toISOString() : null);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : null);
const numOrNull = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// El lote se toma de inventario_lotes.raw (la entrada original de Firebase, sin historiales):
// así el motor ve exactamente lo mismo que veía la Cloud Function. Sin raw, se arma desde columnas.
function lotToEntry(l) {
  if (l.raw && typeof l.raw === 'object') {
    const e = JSON.parse(JSON.stringify(l.raw));
    e.productionUsage = []; e.expiryResolutions = []; e.movementHistory = [];
    return e;
  }
  return lotToEntryFromColumns(l);
}
function lotToEntryFromColumns(l) {
  const entry = {
    id: l.id, entryDate: str(l.fecha_ingreso), expiryDate: str(l.vencimiento), unit: l.unidad,
    qty: Number(l.cantidad), availableQty: Number(l.disponible), availableKg: Number(l.disponible_kg),
    noPerecedero: Boolean(l.no_perecedero), packageQty: l.package_qty == null ? undefined : Number(l.package_qty),
    provider: l.proveedor || '', lotNumber: l.lote || '', invoiceNumber: l.factura || '',
    autoEgresoState: l.auto_egreso_state || undefined, lotStatus: l.estado || undefined,
    status: l.status || undefined, expiryResolutionStatus: l.resolucion_estado || undefined,
    productionUsage: [], expiryResolutions: [], movementHistory: []
  };
  const base = Number(l.disponible_base);
  if (!(base === 0 && Number(l.disponible) > 0)) entry.availableBase = base;
  return entry;
}

function movRow(m, origen, lote, ingredienteId, orden, runId) {
  const id = m.id || `mh_${lote}_${runId}_${Math.abs(orden) % 1e9}`;
  return {
    id, lote_id: lote, ingrediente_id: ingredienteId, origen, orden,
    tipo: m.type || null, fecha: ts(m.createdAt || m.producedAt), fecha_produccion: isoDate(m.productionDate),
    produccion_id: m.productionId || m.reference || null,
    cantidad: numOrNull(m.usedQty ?? m.qty), unidad: m.usedUnit || m.unit || m.qtyUnit || null,
    cantidad_base: numOrNull(m.usedBaseQty ?? m.qtyBase), cantidad_kg: numOrNull(m.kilosUsed ?? m.qtyKg),
    motivo: m.reason || null, nota: m.note || m.observation || null, usuario: m.user || null,
    automatico: Boolean(m.generatedAutomatically), source: m.source || null, run_id: m.runId || null,
    datos: JSON.parse(JSON.stringify(m)) // objeto completo, como lo guarda el front (lj_mov_ins)
  };
}

async function aiChatFromVault() {
  const apiKey = await secretGet('gemini_api_key').catch(() => '');
  if (!apiKey) return null;
  const { data } = await admin.from('app_config').select('value').eq('key', '_ai').maybeSingle();
  const model = str(data?.value?.textModel) || gemini.DEFAULT_TEXT_MODEL;
  return (body) => gemini.chat({ apiKey, model, body });
}

export async function runAutoEgresos({ dryRun = true, now = new Date(), aiChat, random = Math.random, config, log = console, onlyIngredients } = {}) {
  const runStartedAt = Date.now();
  const L = { info: (m) => log.info(`[auto-egresos] ${m}`), warn: (m) => log.warn(`[auto-egresos] ${m}`), error: (m) => log.error(`[auto-egresos] ${m}`) };
  const { data: job } = await admin.from('job_state').select('config, estado').eq('job', JOB).maybeSingle();
  const cfg = { ...DEFAULTS, ...EDGE_DEFAULTS, ...safeObj(job?.config), ...safeObj(config) };
  if (cfg.expiredLotAction !== 'baja') cfg.expiredLotAction = 'venta';
  const engine = createEngine({ cfg, random, log: L });
  const runId = `run_${Date.now()}`;
  const summary = { runId, dryRun, products: 0, movements: 0, cursor: '', aiPlans: 0, conflicts: [], lots: [] };

  if (!cfg.enabled) return { ...summary, skipped: 'disabled' };
  if (cfg.STRICT_RUN_WINDOW && !engine.isWithinOpenWindows(now)) return { ...summary, skipped: 'outside_hours' };
  if (!dryRun) {
    const { data: got, error } = await admin.rpc('job_try_lock', { p_job: JOB, p_run: runId, p_seconds: LOCK_SECONDS });
    if (error) throw new Error(error.message);
    if (!got) { L.warn('Otra corrida en curso: se saltea.'); return { ...summary, skipped: 'locked' }; }
  }
  const setCursor = async (id) => {
    summary.cursor = id || '';
    if (dryRun) return;
    const estado = { ...safeObj(job?.estado), cursor: id || null, lastRunId: runId, lastRunAt: new Date().toISOString() };
    await admin.from('job_state').update({ estado: { ...estado, lockRun: runId }, updated_at: new Date().toISOString() }).eq('job', JOB);
  };

  try {
    let regQuery = admin.from('inventario_registros').select('ingrediente_id, stock_unit, infinite_stock, package_qty, weekly_sheet_config').order('ingrediente_id');
    if (onlyIngredients) regQuery = regQuery.in('ingrediente_id', onlyIngredients);
    const { data: regs, error: rErr } = await regQuery;
    if (rErr) throw new Error(rErr.message);
    const lots = [];
    for (let from = 0; ; from += 1000) {
      let q = admin.from('inventario_lotes').select('*').or('disponible.gt.0,disponible_base.gt.0').order('ingrediente_id').order('orden', { nullsFirst: false }).range(from, from + 999);
      if (onlyIngredients) q = q.in('ingrediente_id', onlyIngredients);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      lots.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const lotsBy = {};
    lots.forEach((l) => { (lotsBy[l.ingrediente_id] = lotsBy[l.ingrediente_id] || []).push(l); });
    const todayIso = engine.T.dateToIso(now);

    const allIds = (regs || [])
      .filter((r) => withDefaultWeeklyConfig(r.weekly_sheet_config).egresoEnabled && !r.infinite_stock && (lotsBy[r.ingrediente_id] || []).length)
      .map((r) => r.ingrediente_id);
    if (!allIds.length) { await setCursor(''); return summary; }

    const cursor = str(safeObj(job?.estado).cursor);
    const cursorIdx = cursor ? allIds.indexOf(cursor) : -1;
    const startIndex = cursorIdx >= 0 ? cursorIdx : 0;
    const selectedIds = allIds.slice(startIndex, startIndex + Math.max(1, Number(cfg.MAX_PRODUCTS_PER_RUN || 60)));
    const hasMoreByCap = (startIndex + selectedIds.length) < allIds.length;
    const afterCap = allIds[startIndex + selectedIds.length] || '';

    const regBy = Object.fromEntries((regs || []).map((r) => [r.ingrediente_id, r]));
    const { data: ingRows } = await admin.from('ingredientes').select('id, nombre, descripcion').in('id', selectedIds);
    const ingredientes = Object.fromEntries((ingRows || []).map((i) => [i.id, { name: i.nombre, description: i.descripcion }]));

    const scopedItems = {};
    selectedIds.forEach((id) => {
      const r = regBy[id];
      scopedItems[id] = {
        stockUnit: r.stock_unit, infiniteStock: r.infinite_stock, packageQty: r.package_qty == null ? undefined : Number(r.package_qty),
        weeklySheetConfig: r.weekly_sheet_config || undefined, entries: (lotsBy[id] || []).map(lotToEntry), __lots: lotsBy[id] || []
      };
    });

    const holidaySet = await engine.fetchHolidaySet(collectYearsToFetch(scopedItems, todayIso), fetch);
    const chat = cfg.aiEnabled ? (aiChat === undefined ? await aiChatFromVault() : aiChat) : null;
    const aiPlans = await engine.buildAiBatchPlans({ items: scopedItems, ingredientes, todayIso, holidaySet, aiChat: chat });
    summary.aiPlans = Object.keys(aiPlans).length;

    let timedOut = false;
    for (let i = 0; i < selectedIds.length; i += 1) {
      const ingredientId = selectedIds[i];
      if (Date.now() - runStartedAt >= cfg.MAX_RUN_MILLIS) {
        timedOut = true; await setCursor(ingredientId);
        L.warn(`Corte por tiempo. Sigue en la próxima corrida desde ${ingredientId}.`);
        break;
      }
      const record = scopedItems[ingredientId];
      const weeklyCfg = withDefaultWeeklyConfig(record.weeklySheetConfig);
      const ingredient = safeObj(ingredientes[ingredientId]);
      const lotRows = [];
      const movRows = [];
      record.entries.forEach((entry, j) => {
        const prev = record.__lots[j];
        try {
          const result = engine.processEntryAutoEgreso({
            ingredientId, ingredient, entry, weeklyCfg, todayIso, holidaySet, runId,
            aiPlanByDay: safeObj(aiPlans[normalizeText(entry.id)])
          });
          if (!result.changed) return;
          summary.movements += result.movementsCreated;
          summary.lots.push({ ingredientId, name: str(ingredient.name || ingredientId), entryId: str(entry.id), overdueFlush: result.overdueFlush, availableQty: entry.availableQty, movements: result.movements });
          const unitBase = Number.isFinite(Number(entry.availableBase)) ? Number(entry.availableBase) : 0;
          lotRows.push({
            id: entry.id, prev_disponible: Number(prev.disponible), prev_disponible_base: Number(prev.disponible_base),
            disponible: num(entry.availableQty), disponible_base: unitBase, disponible_kg: num(entry.availableKg),
            estado: entry.lotStatus || null, auto_egreso_state: entry.autoEgresoState || null
          });
          const base = -(Date.now() * 1000);
          ['productionUsage', 'expiryResolutions', 'movementHistory'].forEach((origen) => {
            (entry[origen] || []).forEach((m, idx) => movRows.push(movRow(m, origen, entry.id, ingredientId, base + idx, runId)));
          });
        } catch (error) {
          L.error(`Error en lote ${entry?.id || '-'} de ${ingredientId}: ${error.message}`);
        }
      });
      if (!lotRows.length) continue;
      summary.products += 1;
      if (!dryRun) {
        const { data: res, error } = await admin.rpc('auto_egreso_aplicar', { p_lotes: lotRows, p_movs: movRows });
        if (error) { L.error(`${ingredientId}: ${error.message}`); continue; }
        if (res?.conflicts?.length) summary.conflicts.push(...res.conflicts);
        if (res?.applied?.length) {
          try { await refreshInventoryIndex(ingredientId, todayIso, Number(cfg.INDEX_VERSION || 4)); }
          catch (e) { L.error(`índice ${ingredientId}: ${e.message}`); }
        }
      }
    }
    if (!timedOut) await setCursor(hasMoreByCap ? afterCap : '');
    L.info(`OK · productos=${summary.products} · movimientos=${summary.movements} · runId=${runId}${dryRun ? ' · simulación' : ''}`);
    return summary;
  } finally {
    if (!dryRun) await admin.rpc('job_release', { p_job: JOB, p_run: runId });
  }
}
