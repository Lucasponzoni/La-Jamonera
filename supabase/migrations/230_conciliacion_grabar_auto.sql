-- 230 · Conciliación: opción «Grabar automáticamente en IM5» (config.conciliacion.grabarAuto, apagada por defecto).
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
    'grabarAuto', coalesce((p_conc->>'grabarAuto')::boolean, (v_old->>'grabarAuto')::boolean, false),
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
