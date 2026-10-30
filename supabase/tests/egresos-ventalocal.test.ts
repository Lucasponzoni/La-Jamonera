// @ts-nocheck — el motor es JS sin tipos (ver egresos-engine.ts)
// «Sólo venta en local»: un lote marcado se reparte día a día como venta en mostrador aunque el ingrediente
// no tenga egreso diario (apagado o «sólo vencidos»); los demás lotes de ese ingrediente siguen como siempre.
//   deno test supabase/tests/egresos-ventalocal.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
const { createEngine, DEFAULTS, makeTz, addDays } = await import('../functions/api/egresos-engine.ts');

const quiet = { info() {}, warn() {}, error() {} };
const todayIso = makeTz('America/Argentina/Buenos_Aires').dateToIso(new Date());
const entry = (id, extra = {}) => ({
  id, unit: 'kilos', qty: 20, availableQty: 20, availableBase: 20000, availableKg: 20, provider: 'LA BROSA',
  entryDate: addDays(todayIso, -2), expiryDate: addDays(todayIso, 5), productionUsage: [], expiryResolutions: [], movementHistory: [], ...extra
});
const weeklyOff = { configured: true, counterOnly: false, egresoEnabled: false, perishable: true, rotationDays: 7, updatedAt: 0 };

Deno.test('la IA sólo planifica el lote venta local de un ingrediente sin egreso diario', async () => {
  const engine = createEngine({ cfg: { ...DEFAULTS }, random: () => 0.5, log: quiet });
  const seen = [];
  const aiChat = async (body) => {
    const ctx = JSON.parse(String(body.messages[1].content).split('Contexto: ')[1]);
    ctx.forEach((c) => seen.push(c.entryId));
    return { choices: [{ message: { content: JSON.stringify({ plans: ctx.map((c) => ({ entryId: c.entryId, movements: [{ dayIso: c.processDays[0], qty: 1 }] })) }) } }] };
  };
  const items = {
    ing_x: { weeklySheetConfig: weeklyOff, entries: [entry('lote_local', { ventaLocal: true }), entry('lote_normal')], __soloVencidos: true }
  };
  const plans = await engine.buildAiBatchPlans({ items, ingredientes: { ing_x: { name: 'carne chica de cerdo' } }, todayIso, holidaySet: new Set(), aiChat });
  assertEquals(seen, ['lote_local']);
  assert(plans.lote_local, 'el lote venta local tiene plan');
  assertEquals(plans.lote_normal, undefined);
});

Deno.test('el lote venta local se descuenta aunque no esté vencido; el normal en «sólo vencidos» no', () => {
  const engine = createEngine({ cfg: { ...DEFAULTS }, random: () => 0.5, log: quiet });
  const base = { ingredientId: 'ing_x', ingredient: { name: 'carne chica de cerdo' }, weeklyCfg: weeklyOff, todayIso, holidaySet: new Set(), runId: 'run_test', aiPlanByDay: {} };
  const local = engine.processEntryAutoEgreso({ ...base, entry: entry('lote_local', { ventaLocal: true }), soloVencidos: false });
  assert(local.movementsCreated > 0, 'genera ventas de mostrador');
  assert(local.entry.availableQty < 20, 'baja el stock');
  assert(local.movements.every((m) => m.kind === 'venta'));
  const normal = engine.processEntryAutoEgreso({ ...base, entry: entry('lote_normal'), soloVencidos: true });
  assertEquals(normal.movementsCreated, 0);
  assertEquals(normal.entry.availableQty, 20);
});
