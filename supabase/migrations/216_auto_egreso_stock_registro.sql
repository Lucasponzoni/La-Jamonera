-- 216 · El auto-egreso actualizaba lotes e índice pero no el stock guardado en el registro del ingrediente
-- (raw.stockBase/stockKg), que quedaba viejo (p.ej. carré 91,8 kg con lotes en 0). Ahora lo actualiza y vacía la
-- caché del registro (se rearma sola). Más una corrección única de los registros ya desfasados (aplicada 10/10/2026).
create or replace function public.auto_egreso_index_set(p_ing text, p_summary jsonb, p_version integer)
returns void language plpgsql security definer set search_path = public, private, extensions as $$
begin
  perform private.lj_raw_set('/inventario_index/items/' || p_ing, p_summary);
  perform private.lj_raw_set('/_index_meta/inventario_index',
    jsonb_build_object('updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint, 'version', p_version));
  if p_summary ? 'stockBase' then
    update inventario_registros
       set raw = coalesce(raw, '{}'::jsonb)
                 || jsonb_build_object('stockBase', (p_summary->>'stockBase')::numeric,
                                       'stockKg', coalesce((p_summary->>'stockKg')::numeric, 0)),
           cache_json = null,
           updated_at = now()
     where ingrediente_id = p_ing;
  end if;
end $$;

with lotes as (
  select ingrediente_id, round(sum(disponible_base), 6) base, round(sum(disponible_kg), 4) kg
  from inventario_lotes group by ingrediente_id)
update inventario_registros r
   set raw = r.raw || jsonb_build_object('stockBase', coalesce(l.base, 0),
                                         'stockKg', case when r.raw->>'stockUnit' in ('kilos') then round(coalesce(l.base, 0) / 1000, 4) else coalesce(l.kg, 0) end),
       cache_json = null,
       updated_at = now()
  from inventario_registros r2 left join lotes l on l.ingrediente_id = r2.ingrediente_id
 where r.ingrediente_id = r2.ingrediente_id
   and abs(coalesce((r.raw->>'stockBase')::numeric, 0) - coalesce(l.base, 0)) > 0.01;
