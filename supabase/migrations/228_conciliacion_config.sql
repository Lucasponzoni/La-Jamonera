-- 228 · Configuración de la conciliación MP ↔ IM5 (Ventas del local → Configuración → Conciliación), sólo admin,
-- y contador de cupones grabados en IM5 (la página sugiere probar con uno solo mientras sea 0).
create or replace function public.conciliacion_config_guardar(p_conc jsonb)
returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_old jsonb; v_new jsonb;
begin
  if not exists (select 1 from profiles where id = auth.uid() and activo and role = 'admin') then raise exception 'sin_permiso' using errcode = '42501'; end if;
  select coalesce(config->'conciliacion', '{}'::jsonb) into v_old from ventas_config where id = 1;
  v_new := v_old || jsonb_build_object(
    'activa', coalesce((p_conc->>'activa')::boolean, (v_old->>'activa')::boolean, true),
    'avisos', coalesce((p_conc->>'avisos')::boolean, (v_old->>'avisos')::boolean, true));
  update ventas_config set config = jsonb_set(config, '{conciliacion}', v_new), updated_at = now(), updated_by = auth.uid() where id = 1;
  return v_new;
end $$;
revoke all on function public.conciliacion_config_guardar(jsonb) from public, anon;
grant execute on function public.conciliacion_config_guardar(jsonb) to authenticated;

create or replace function public.conciliacion_contar_grabados(p_n int)
returns void
language sql security definer set search_path = public as $$
  update ventas_config set config = jsonb_set(config, '{conciliacion}',
    coalesce(config->'conciliacion', '{}'::jsonb) || jsonb_build_object('grabados', coalesce((config->'conciliacion'->>'grabados')::int, 0) + greatest(p_n, 0)))
  where id = 1
$$;
revoke all on function public.conciliacion_contar_grabados(int) from public, anon, authenticated;
