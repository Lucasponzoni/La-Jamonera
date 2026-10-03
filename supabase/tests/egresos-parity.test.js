// Paridad auto-egresos: motor original (functions/auto-egresos.js) sobre los registros de Firebase
// vs el mismo motor sobre las filas de Supabase convertidas con lotToEntry (copia de egresos.ts).
// Azar sembrado por lote → el orden de los lotes no influye. Sin IA. Sólo lectura en ambos lados.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const lj = require('C:/Users/Lucas/Documents/GitHub/La-Jamonera/tools/facturas/lj.js');
const ae = require('C:/Users/Lucas/Documents/GitHub/La-Jamonera/functions/auto-egresos.js');
const cfgL = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, '.la-jamonera-supabase-local.json'), 'utf8'));
const token = fs.readFileSync(path.join(__dirname, '.adm-token'), 'utf8').trim();
const rest = async (p) => { const r = await fetch(`${cfgL.url}/rest/v1/${p}`, { headers: { apikey: cfgL.anonKey, Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json(); };

const str = (v) => (v === undefined || v === null ? '' : String(v));
function lotToEntry(l) { // idéntico a supabase/functions/api/egresos.ts
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
const seeded = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const { createEngine, makeTz } = ae._internals;
const quiet = { info() {}, warn() {}, error() {} };

(async () => {
  const cfg = { ...ae.DEFAULTS };
  const todayIso = makeTz('America/Argentina/Buenos_Aires').dateToIso(new Date());
  const lots = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(`inventario_lotes?select=*&or=(disponible.gt.0,disponible_base.gt.0)&order=id&offset=${from}&limit=1000`);
    lots.push(...page); if (page.length < 1000) break;
  }
  const regs = await rest('inventario_registros?select=ingrediente_id,weekly_sheet_config,infinite_stock');
  const regBy = Object.fromEntries(regs.map((r) => [r.ingrediente_id, r]));
  const ingIds = [...new Set(lots.map((l) => l.ingrediente_id))];
  const fb = {};
  for (const id of ingIds) fb[id] = await lj.get(`/inventario/items/${id}`);
  const holidaySet = await createEngine({ cfg, log: quiet }).fetchHolidaySet([2025, 2026, 2027], fetch);

  let compared = 0; let withMoves = 0; let totalMoves = 0; const diffs = [];
  for (const l of lots) {
    const rec = fb[l.ingrediente_id];
    const fEntry = (rec && rec.entries || []).find((e) => e.id === l.id);
    if (!fEntry) { diffs.push({ lot: l.id, err: 'no está en Firebase' }); continue; }
    const weeklyF = ae._internals ? Object.assign({ configured: false, counterOnly: false, egresoEnabled: true, perishable: true, rotationDays: 7, updatedAt: 0 }, rec.weeklySheetConfig || {}) : null;
    const weeklyS = Object.assign({ configured: false, counterOnly: false, egresoEnabled: true, perishable: true, rotationDays: 7, updatedAt: 0 }, (regBy[l.ingrediente_id] || {}).weekly_sheet_config || {});
    assert.deepStrictEqual(weeklyS, weeklyF, `weekly ${l.ingrediente_id}`);
    const run = (entry) => {
      const eng = createEngine({ cfg, random: seeded(l.id), log: quiet });
      const out = eng.processEntryAutoEgreso({ ingredientId: l.ingrediente_id, ingredient: {}, entry: JSON.parse(JSON.stringify(entry)), weeklyCfg: weeklyF, todayIso, holidaySet, runId: 'run_test', aiPlanByDay: {} });
      return { moves: out.movements.map((m) => [m.dayIso, m.qty, m.qtyBase, m.kind]), availableQty: out.entry.availableQty, lotStatus: out.entry.lotStatus, last: out.entry.autoEgresoState && out.entry.autoEgresoState.lastProcessedDate };
    };
    const a = run(fEntry); const b = run(lotToEntry(l));
    compared += 1; if (a.moves.length) { withMoves += 1; totalMoves += a.moves.length; }
    try { assert.deepStrictEqual(b, a); } catch (e) { diffs.push({ lot: l.id, firebase: a, supabase: b }); }
  }
  console.log(`hoy ${todayIso} · lotes con stock comparados ${compared} · con egresos hoy ${withMoves} · movimientos ${totalMoves} · diferencias ${diffs.length}`);
  if (diffs.length) { console.log(JSON.stringify(diffs.slice(0, 5), null, 1)); process.exitCode = 1; }
})().catch((e) => { console.error('FALLA', e.message); process.exit(1); });
