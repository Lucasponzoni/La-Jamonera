-- 223 · Configuración de «Ventas del POS → Inventario/Producción» (ventas_config.config.pos), borrado de repartos
-- creados desde el POS (si el comprobante se anula) y factores iniciales de los vínculos.

create or replace function public.ventas_pos_config_guardar(p_pos jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_old jsonb; v_pos jsonb; v_desde text; v_usuario text;
begin
  if not (private.puede_ver_ventas() and private.puede_editar()) then raise exception 'sin_permiso' using errcode = '42501'; end if;
  select config into v_old from ventas_config where id = 1;
  v_desde := coalesce(p_pos->>'desde', v_old->'pos'->>'desde', '');
  if v_desde <> '' and v_desde !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'fecha_invalida'; end if;
  v_usuario := upper(trim(coalesce(p_pos->'repartos'->>'usuario', v_old->'pos'->'repartos'->>'usuario', 'BRENDA')));
  if v_usuario = '' or length(v_usuario) > 40 then raise exception 'usuario_invalido'; end if;
  v_pos := jsonb_build_object(
    'activo', coalesce((p_pos->>'activo')::boolean, (v_old->'pos'->>'activo')::boolean, false),
    'desde', v_desde,
    'excluirMateriaPrima', coalesce((p_pos->>'excluirMateriaPrima')::boolean, (v_old->'pos'->>'excluirMateriaPrima')::boolean, true),
    'iaSoloVencidos', coalesce((p_pos->>'iaSoloVencidos')::boolean, (v_old->'pos'->>'iaSoloVencidos')::boolean, true),
    'avisarSinStock', coalesce((p_pos->>'avisarSinStock')::boolean, (v_old->'pos'->>'avisarSinStock')::boolean, true),
    'repartos', jsonb_build_object(
      'activo', coalesce((p_pos->'repartos'->>'activo')::boolean, (v_old->'pos'->'repartos'->>'activo')::boolean, true),
      'usuario', v_usuario,
      'exigeObs', coalesce((p_pos->'repartos'->>'exigeObs')::boolean, (v_old->'pos'->'repartos'->>'exigeObs')::boolean, true)),
    'actualizado', to_jsonb(now()));
  update ventas_config set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('pos', v_pos), updated_at = now(), updated_by = auth.uid() where id = 1;
  return v_pos;
end $$;
revoke all on function public.ventas_pos_config_guardar(jsonb) from public, anon;
grant execute on function public.ventas_pos_config_guardar(jsonb) to authenticated;

-- Sólo repartos creados desde el POS (id reparto_pos_…).
create or replace function public.pos_borrar_reparto(p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_id not like 'reparto_pos_%' then raise exception 'solo_repartos_pos'; end if;
  delete from reparto_items where reparto_id = p_id;
  delete from repartos where id = p_id;
end $$;
revoke all on function public.pos_borrar_reparto(text) from public, anon, authenticated;
grant execute on function public.pos_borrar_reparto(text) to service_role;

-- Factor: cuánto del stock es 1 unidad vendida (carbón en bolsas; dulces y aceitunas vendidos por kg contra latas/baldes).
update public.im5_articulo_vinculos set factor = 5 where cod_articulo = '209';      -- CARBON X 5 KG → 5 kg
update public.im5_articulo_vinculos set factor = 3 where cod_articulo = '208';      -- CARBON X 3 KG → 3 kg
update public.im5_articulo_vinculos set factor = 0.2 where cod_articulo in ('271', '265', '275', '278'); -- 1 kg = 1/5 de lata de 5 kg
update public.im5_articulo_vinculos set factor = 0.25 where cod_articulo in ('184', '189');        -- aceitunas por kg: balde de 4 l ≈ 4 kg
update public.im5_articulo_vinculos set factor = 0.2222 where cod_articulo = '129';                -- mortadela x 4,5 kg vendida por kg
