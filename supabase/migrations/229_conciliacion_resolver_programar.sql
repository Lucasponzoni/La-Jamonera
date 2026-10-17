-- 229 · Conciliación MP ↔ IM5: resolver diferencias a mano, programar el cruce y estado de las corridas.
-- · Resolución en la fila (aceptar, otro canal, error de la cajera, ignorar): el cruce no la pisa ni la borra.
-- · Vínculos manuales cobro IM5 → pago MP: el cruce los usa antes que cualquier otra regla.
-- · El job corre cada hora y la función decide según config.conciliacion (cada X horas / X días / días y hora).

alter table public.conciliacion_mp add column if not exists resolucion text
  check (resolucion is null or resolucion in ('aceptado', 'otro_canal', 'fuera_de_im5', 'error_cajera', 'ignorado'));
alter table public.conciliacion_mp add column if not exists resolucion_nota text;
alter table public.conciliacion_mp add column if not exists resuelto_por text;
alter table public.conciliacion_mp add column if not exists resuelto_at timestamptz;
alter table public.conciliacion_mp add column if not exists visto_at timestamptz;   -- primer cruce que la vio (para «diferencias nuevas»)

create table if not exists public.conciliacion_mp_vinculos (
  clave text primary key,          -- im5:<empresa>:<id_pago>
  mp_pago_id text not null unique,
  nota text,
  creado_por text,
  creado_at timestamptz not null default now()
);
alter table public.conciliacion_mp_vinculos enable row level security;
drop policy if exists conciliacion_mp_vinculos_leer on public.conciliacion_mp_vinculos;
create policy conciliacion_mp_vinculos_leer on public.conciliacion_mp_vinculos for select to authenticated using ((select private.puede_ver_ventas()));
revoke all on public.conciliacion_mp_vinculos from anon;
grant select on public.conciliacion_mp_vinculos to authenticated;

create table if not exists public.conciliacion_mp_estado (
  id int primary key default 1 check (id = 1),
  ultima_at timestamptz,
  ultima_ok boolean,
  ultimo_error text,
  ultimo_resultado jsonb,
  proxima_at timestamptz,
  ultimo_aviso jsonb not null default '{}'::jsonb,   -- { listos: 'AAAA-MM-DD', cierre: 'AAAA-MM', falla: ts }
  historial jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.conciliacion_mp_estado (id) values (1) on conflict do nothing;
alter table public.conciliacion_mp_estado enable row level security;
drop policy if exists conciliacion_mp_estado_leer on public.conciliacion_mp_estado;
create policy conciliacion_mp_estado_leer on public.conciliacion_mp_estado for select to authenticated using ((select private.puede_ver_ventas()));
revoke all on public.conciliacion_mp_estado from anon;
grant select on public.conciliacion_mp_estado to authenticated;

-- Resumen: lo resuelto a mano ya no cuenta como diferencia.
create or replace function public.conciliacion_mp_resumen(p_desde date, p_hasta date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'cobrado_im5', coalesce(sum(importe) filter (where clave like 'im5:%' and importe > 0), 0),
    'cobros', count(*) filter (where clave like 'im5:%' and importe > 0),
    'acreditado_mp', coalesce(sum(mp_neto) filter (where estado = 'conciliado'), 0),
    'comisiones', coalesce(sum(mp_comision) filter (where mp_pago_id is not null and clave like 'im5:%'), 0),
    'pendiente_liberar', coalesce(sum(mp_neto) filter (where estado = 'pendiente_liberacion'), 0),
    'diferencias', count(*) filter (where estado in ('dif_importe', 'falta_en_mp', 'falta_en_im5', 'revisar') and resuelto_at is null),
    'resueltos', count(*) filter (where resuelto_at is not null),
    'listos_grabar', count(*) filter (where estado = 'conciliado' and grabado_im5_at is null and coalesce(im5_conciliado, false) = false),
    'grabados', count(*) filter (where grabado_im5_at is not null or im5_conciliado),
    'por_estado', coalesce((select jsonb_object_agg(estado, n) from (select estado, count(*) n from conciliacion_mp where fecha between p_desde and p_hasta group by estado) e), '{}'::jsonb),
    'actualizado', max(actualizado_at)
  )
  from conciliacion_mp where fecha between p_desde and p_hasta
$$;

-- Config: frecuencia, días hacia atrás y avisos (admin).
create or replace function public.conciliacion_config_guardar(p_conc jsonb)
returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_old jsonb; v_new jsonb; v_modo text; v_mail text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and activo and role = 'admin') then raise exception 'sin_permiso' using errcode = '42501'; end if;
  select coalesce(config->'conciliacion', '{}'::jsonb) into v_old from ventas_config where id = 1;
  v_modo := coalesce(p_conc->>'modo', v_old->>'modo', 'diario');
  if v_modo not in ('horas', 'diario', 'semanal', 'cada_dias') then raise exception 'modo_invalido'; end if;
  if coalesce((p_conc->>'cadaHoras')::int, 6) not between 1 and 24 then raise exception 'cada_horas_invalido'; end if;
  if coalesce((p_conc->>'cadaDias')::int, 1) not between 1 and 31 then raise exception 'cada_dias_invalido'; end if;
  if coalesce((p_conc->>'hora')::int, 7) not between 0 and 23 then raise exception 'hora_invalida'; end if;
  if coalesce((p_conc->>'diasAtras')::int, 35) not between 3 and 90 then raise exception 'dias_atras_invalido'; end if;
  v_mail := coalesce(p_conc->>'mails', v_old->>'mails', '');
  if v_mail <> '' and v_mail !~ '^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+(\s*,\s*[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+)*$' then raise exception 'mail_invalido'; end if;
  v_new := v_old || jsonb_strip_nulls(jsonb_build_object(
    'activa', coalesce((p_conc->>'activa')::boolean, (v_old->>'activa')::boolean, true),
    'modo', v_modo,
    'cadaHoras', coalesce((p_conc->>'cadaHoras')::int, (v_old->>'cadaHoras')::int, 6),
    'cadaDias', coalesce((p_conc->>'cadaDias')::int, (v_old->>'cadaDias')::int, 1),
    'dias', coalesce(p_conc->'dias', v_old->'dias', '[1,2,3,4,5,6]'::jsonb),
    'hora', coalesce((p_conc->>'hora')::int, (v_old->>'hora')::int, 7),
    'desde', coalesce((p_conc->>'desde')::int, (v_old->>'desde')::int, 8),
    'hasta', coalesce((p_conc->>'hasta')::int, (v_old->>'hasta')::int, 21),
    'diasAtras', coalesce((p_conc->>'diasAtras')::int, (v_old->>'diasAtras')::int, 35),
    'mails', v_mail,
    'avisos', coalesce(p_conc->'avisos', v_old->'avisos', '{"diferencias":true,"resumen":false,"listos":true,"cierre":true,"falla":true}'::jsonb),
    'diaListos', coalesce((p_conc->>'diaListos')::int, (v_old->>'diaListos')::int, 1)));
  update ventas_config set config = jsonb_set(config, '{conciliacion}', v_new), updated_at = now(), updated_by = auth.uid() where id = 1;
  return v_new;
end $$;

-- El job pasa a correr cada hora (a los :20); la función decide si toca según la config.
select cron.unschedule('conciliacion-mp') where exists (select 1 from cron.job where jobname = 'conciliacion-mp');
select cron.schedule('conciliacion-mp', '20 * * * *', 'select private.conciliacion_mp_cron()');
