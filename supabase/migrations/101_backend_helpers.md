# 101_backend_helpers (aplicada en Supabase el 03/10/2026)

- `public.secret_set/secret_get/secret_delete` — Vault; EXECUTE sólo `service_role`.
- `public.job_try_lock/job_release` — lock de `job_state` (auto-egresos); sólo `service_role`.
- `movimientos.orden` → `bigint` (los movimientos nuevos usan orden negativo = más recientes).
- `public.auto_egreso_aplicar(p_lotes, p_movs)` — actualiza lotes con control optimista (prev_disponible/prev_disponible_base) e inserta movimientos sólo de los lotes aplicados; sólo `service_role`.
- `private.auto_egresos_cron()` — pg_net → `/functions/v1/api/auto-egresos/cron` con `x-cron-secret` (Vault `cron_secret`, generado dentro de la base) y la anon key (Vault `anon_key`).
- `cron.job 'auto-egresos'` ('5 * * * *') creado **inactivo**. Activar en el corte:
  `select cron.alter_job((select jobid from cron.job where jobname = 'auto-egresos'), active := true);`
- `job_state('auto_egresos')` inicializado.
