-- 226 · Conciliación Mercado Pago ↔ InfoManager (Ventas del local → Conciliación).
-- Una fila por cobro con Mercado Pago de IM5 (clave 'im5:<empresa>:<id_pago>') y por pago de MP que no está en
-- IM5 ('mp:<id>'). La calcula la función `api` (conciliacion-mp.ts); el front sólo lee. Grabar en IM5 lo
-- confirma un admin desde la página (queda quién y cuándo).
create table if not exists public.conciliacion_mp (
  clave text primary key,
  empresa smallint,
  im5_pago_id bigint,
  fecha date not null,
  fecha_hora timestamptz,
  medio text,
  comprobante text,
  recibo text,
  importe numeric(14, 2),
  cupon text,
  mp_pago_id text,
  mp_estado text,
  mp_monto numeric(14, 2),
  mp_neto numeric(14, 2),
  mp_comision numeric(14, 2),
  mp_aprobado_at timestamptz,
  mp_liberacion_at timestamptz,
  mp_origen text,
  estado text not null check (estado in ('conciliado', 'pendiente_liberacion', 'dif_importe', 'falta_en_mp', 'falta_en_im5', 'devuelto', 'devolucion', 'revisar')),
  motivo_match text,           -- id_externo | cupon | importe_hora
  diferencia numeric(14, 2),
  im5_conciliado boolean,      -- lo que dice IM5 hoy (conciliacion-tarjetas)
  im5_fec_conciliacion date,
  im5_acreditacion_est numeric(14, 2),
  grabado_im5_at timestamptz,
  grabado_por text,
  grabado_resumen bigint,
  actualizado_at timestamptz not null default now()
);
create index if not exists conciliacion_mp_fecha_idx on public.conciliacion_mp (fecha);
create index if not exists conciliacion_mp_estado_idx on public.conciliacion_mp (estado, fecha);
create index if not exists conciliacion_mp_mp_idx on public.conciliacion_mp (mp_pago_id) where mp_pago_id is not null;

alter table public.conciliacion_mp enable row level security;
drop policy if exists conciliacion_mp_leer on public.conciliacion_mp;
create policy conciliacion_mp_leer on public.conciliacion_mp for select to authenticated using ((select private.puede_ver_ventas()));
revoke all on public.conciliacion_mp from anon;
grant select on public.conciliacion_mp to authenticated;

-- Resumen por rango (KPIs de la pestaña): totales por estado, comisiones y lo pendiente de liberar.
create or replace function public.conciliacion_mp_resumen(p_desde date, p_hasta date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'cobrado_im5', coalesce(sum(importe) filter (where clave like 'im5:%' and importe > 0), 0),
    'cobros', count(*) filter (where clave like 'im5:%' and importe > 0),
    'acreditado_mp', coalesce(sum(mp_neto) filter (where estado = 'conciliado'), 0),
    'comisiones', coalesce(sum(mp_comision) filter (where mp_pago_id is not null and clave like 'im5:%'), 0),
    'pendiente_liberar', coalesce(sum(mp_neto) filter (where estado = 'pendiente_liberacion'), 0),
    'diferencias', count(*) filter (where estado in ('dif_importe', 'falta_en_mp', 'falta_en_im5', 'revisar')),
    'listos_grabar', count(*) filter (where estado = 'conciliado' and grabado_im5_at is null and coalesce(im5_conciliado, false) = false),
    'grabados', count(*) filter (where grabado_im5_at is not null or im5_conciliado),
    'por_estado', coalesce((select jsonb_object_agg(estado, n) from (select estado, count(*) n from conciliacion_mp where fecha between p_desde and p_hasta group by estado) e), '{}'::jsonb),
    'actualizado', max(actualizado_at)
  )
  from conciliacion_mp where fecha between p_desde and p_hasta
$$;
revoke all on function public.conciliacion_mp_resumen(date, date) from public, anon;
grant execute on function public.conciliacion_mp_resumen(date, date) to authenticated;

-- Cruce automático diario (7:00 AR = 10:00 UTC). La función decide además los avisos semanal y mensual.
create or replace function private.conciliacion_mp_cron()
returns bigint
language sql security definer set search_path = public, extensions, vault as $$
  select net.http_post(
    url := 'https://bpbsqhdxbfhdticbnnnm.supabase.co/functions/v1/api/conciliacion/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'anon_key' limit 1), ''),
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1), '')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000)
$$;
select cron.unschedule('conciliacion-mp') where exists (select 1 from cron.job where jobname = 'conciliacion-mp');
select cron.schedule('conciliacion-mp', '0 10 * * *', 'select private.conciliacion_mp_cron()');
