# Pruebas de la Edge Function `api`

Requieren `%USERPROFILE%\.la-jamonera-supabase-local.json` (url + anon key; fuera del repo) y, para
las que inician sesión, la clave del admin en la variable `LJ_ADMIN_PASS` (nunca en archivos).
`live.test.js` guarda el token del admin en `.adm-token` (en esta carpeta, ignorado por git) para las demás.

- `live.test.js` — auth (401 sin JWT / JWT anon), /me, /config/ai (+test, models), /config/email, /ia, /ia/image, /email, guardas de /bootstrap y /auto-egresos/cron.
- `users.test.js` — /admin-users completo, 403 del empleado, RLS (lectura, editar, pin_hash), plantilla; `--invite` envía a `delivered@resend.dev`. Crea personas `test_sb_*` que hay que insertar/borrar por SQL antes/después.
- `egresos-parity.test.js` — motor original sobre Firebase vs. filas de Supabase convertidas (azar sembrado por lote).
- `egresos-dataflow.test.ts` — `egresos.ts` real contra la base (dryRun, +1/+3/+8 días) vs. motor original sobre Firebase (`firebase-expected.json`).
- `bootstrap.js` — alta del admin inicial y secretos (ya usado; el token se borró y la ruta quedó inutilizable).
