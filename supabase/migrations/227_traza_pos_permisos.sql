-- 227 · Trazabilidad POS de Inventario: la hora y la caja de la venta sólo para quien tiene «Ver ventas».
create or replace function public.inventario_traza_pos(p_mov text)
returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare
  m text[];
  emp smallint; cid bigint; ord int;
  r jsonb;
begin
  if not private.es_usuario_activo() then return null; end if;
  m := regexp_match(coalesce(p_mov, ''), '^(?:usage|mh)_pos_(\d+)_(\d+)_(\d+)_(.+)$');
  if m is null then return null; end if;
  emp := m[1]::smallint; cid := m[2]::bigint; ord := m[3]::int;
  select jsonb_build_object(
    'lote_id', m[4],
    'comprobante', trim(regexp_replace(concat_ws(' ', c.tipo, c.letra, lpad(coalesce(c.punto_venta, 0)::text, 4, '0') || '-' || lpad(coalesce(c.numero, 0)::text, 8, '0')), '\s+', ' ', 'g')),
    'fecha', c.fecha,
    -- Hora y caja sólo para quien ve ventas; el resto ve el lote, el comprobante y el desglose.
    'fecha_hora', case when private.puede_ver_ventas() then c.fecha_hora end,
    'caja', case when private.puede_ver_ventas() then c.usuario end,
    'articulo', i.descripcion, 'cod_articulo', i.cod_articulo, 'cantidad', i.cantidad, 'unidad', i.unidad,
    'reparto', exists (select 1 from im5_aplicaciones a where a.empresa = emp and a.comprobante_id = cid and a.orden = ord and a.reparto_id is not null),
    'componentes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'destino', a.destino, 'ref_id', a.ref_id, 'estado', a.estado, 'cantidad', a.cantidad, 'unidad', a.unidad, 'lote_id', a.lote_id,
        'nombre', case when a.destino = 'produccion' then coalesce(rc.raw->>'nombreComercial', rc.raw->>'title') else ing.nombre end,
        'lote', l.lote, 'factura', l.factura, 'remito', l.remito, 'proveedor', l.proveedor,
        'fecha_ingreso', l.fecha_ingreso, 'vencimiento', l.vencimiento, 'factura_urls', to_jsonb(l.factura_urls)
      ) order by a.id)
      from im5_aplicaciones a
      left join inventario_lotes l on a.destino = 'inventario' and l.id = a.lote_id
      left join ingredientes ing on a.destino = 'inventario' and ing.id = a.ref_id
      left join recetas rc on a.destino = 'produccion' and rc.id = a.ref_id
      where a.empresa = emp and a.comprobante_id = cid and a.orden = ord and a.estado in ('aplicado', 'sin_stock')
    ), '[]'::jsonb)
  ) into r
  from im5_comprobantes c
  left join im5_items i on i.empresa = c.empresa and i.comprobante_id = c.id and i.orden = ord
  where c.empresa = emp and c.id = cid;
  return r;
end $$;
revoke all on function public.inventario_traza_pos(text) from public, anon;
grant execute on function public.inventario_traza_pos(text) to authenticated;
