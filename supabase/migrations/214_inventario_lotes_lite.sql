-- 214 · Lotes de inventario "livianos" para la tabla Ingresos por período.
-- Sin los historiales completos (141 mil movimientos, ~49 MB): sólo la última resolución de vencimiento,
-- las resoluciones de vencido por reparto y la cantidad de consumos. El detalle completo de un ingrediente
-- se pide aparte (/inventario/items/{id}) cuando se despliega una fila. Sólo lectura.
create index if not exists movimientos_reparto_vencido_idx on public.movimientos (lote_id, orden)
  where origen = 'movementHistory' and tipo = 'resolucion_vencido_reparto_xlsx';

-- Búsquedas puntuales por lote (la instancia es chica: recorrer los 140 mil movimientos tarda segundos).
create or replace function public.lj_inventario_lotes_lite() returns jsonb
language plpgsql stable security definer set search_path = public, private, extensions as $$
begin
  perform private.lj_exigir('activo');
  return coalesce((
    select jsonb_object_agg(t.ingrediente_id, t.lotes) from (
      select l.ingrediente_id,
             jsonb_agg(
               (coalesce(l.raw, jsonb_strip_nulls(jsonb_build_object(
                  'id', l.id, 'entryDate', l.fecha_ingreso, 'expiryDate', l.vencimiento, 'unit', l.unidad, 'qty', l.cantidad,
                  'qtyBase', l.cantidad_base, 'qtyKg', l.cantidad_kg, 'availableQty', l.disponible, 'availableBase', l.disponible_base,
                  'availableKg', l.disponible_kg, 'provider', l.proveedor, 'invoiceNumber', l.factura, 'lotNumber', l.lote)))
                 - 'productionUsage' - 'expiryResolutions' - 'movementHistory')
               || jsonb_build_object(
                    '__lite', true,
                    '__usageCount', case when exists (select 1 from movimientos m where m.lote_id = l.id and m.origen = 'productionUsage') then 1 else 0 end,
                    'expiryResolutions', coalesce((select jsonb_build_array(m.datos) from movimientos m
                        where m.lote_id = l.id and m.origen = 'expiryResolutions' order by m.orden limit 1), '[]'::jsonb),
                    'movementHistory', coalesce((select jsonb_agg(m.datos order by m.orden) from movimientos m
                        where m.lote_id = l.id and m.origen = 'movementHistory' and m.tipo = 'resolucion_vencido_reparto_xlsx'), '[]'::jsonb))
               order by l.orden nulls last, l.fecha_ingreso, l.id) as lotes
      from inventario_lotes l
      group by l.ingrediente_id) t), '{}'::jsonb);
end $$;
revoke execute on function public.lj_inventario_lotes_lite() from public, anon;
grant execute on function public.lj_inventario_lotes_lite() to authenticated;
