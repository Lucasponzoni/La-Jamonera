// @ts-nocheck
// Ejecuta supabase/functions/api/egresos.ts (capa de datos real) contra la base, en dryRun, con fechas
// simuladas (+1, +3, +8 días), y compara con el motor original sobre Firebase (vía JSON exportado por Node).
// Lecturas con el JWT del admin (RLS); sin service_role: las RPC de escritura/lock no se llaman en dryRun.
const cfg = JSON.parse(await Deno.readTextFile(`${Deno.env.get('USERPROFILE')}\\.la-jamonera-supabase-local.json`));
const token = (await Deno.readTextFile(new URL('./.adm-token', import.meta.url))).trim();
Deno.env.set('SUPABASE_URL', cfg.url);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', cfg.anonKey);
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(`${cfg.url}/rest/v1/`)) {
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('Authorization', `Bearer ${token}`);
    return realFetch(input, { ...init, headers });
  }
  return realFetch(input, init);
};
const { runAutoEgresos } = await import('file:///C:/Users/Lucas/Documents/GitHub/La-Jamonera/supabase/functions/api/egresos.ts');
const quiet = { info() {}, warn() {}, error() {} };
const expected = JSON.parse(await Deno.readTextFile(new URL('./firebase-expected.json', import.meta.url)));
let fails = 0;
for (const offset of Object.keys(expected)) {
  const now = new Date(Date.now() + Number(offset) * 86400000);
  const s = await runAutoEgresos({ dryRun: true, now, aiChat: null, log: quiet, config: { MAX_PRODUCTS_PER_RUN: 500 } });
  const got = s.lots.map((l) => `${l.entryId}|${l.availableQty === 0 ? 'vaciado' : 'parcial'}`).sort();
  const exp = expected[offset].lots;
  const same = JSON.stringify(got) === JSON.stringify(exp);
  if (!same) fails += 1;
  console.log(`${same ? 'OK ' : 'FALLA'} +${offset}d · productos ${s.products}/${expected[offset].products} · lotes ${got.length}/${exp.length} · movimientos ${s.movements} (Firebase ${expected[offset].movements})`);
  if (!same) console.log(JSON.stringify({ got, exp }));
}
Deno.exit(fails ? 1 : 0);
