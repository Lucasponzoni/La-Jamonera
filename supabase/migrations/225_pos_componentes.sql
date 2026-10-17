-- 225 · Un artículo del POS puede descontar varios productos (promos y combos), con la misma lógica que
-- «Sacar a reparto» en Producción: cada componente es un ingrediente (en su unidad de stock) o una receta (en kg),
-- con la cantidad que baja por cada 1 vendido. Cantidad vacía = lo mismo que se vende (productos por kilo).
--   componentes = [{ "tipo": "ingrediente"|"receta", "ref_id": "...", "cantidad": 3 | null }, ...]
-- Sin componentes sigue valiendo el vínculo simple (tipo, ref_id, factor). tipo/ref_id guardan el primer componente
-- (imagen y nombre en las listas).

alter table public.im5_articulo_vinculos add column if not exists componentes jsonb;
alter table public.im5_articulo_vinculos drop constraint if exists im5_vinculos_componentes_chk;
alter table public.im5_articulo_vinculos add constraint im5_vinculos_componentes_chk
  check (componentes is null or jsonb_typeof(componentes) = 'array');

-- Vínculos expandidos: una fila por componente (o el vínculo simple). Respeta el RLS de la tabla.
create or replace view public.im5_vinculo_componentes with (security_invoker = true) as
  select v.cod_articulo, v.descripcion, v.estado, c->>'tipo' as tipo, c->>'ref_id' as ref_id,
         nullif(c->>'cantidad', '')::numeric as cantidad, (o - 1)::int as idx
  from public.im5_articulo_vinculos v
  cross join lateral jsonb_array_elements(v.componentes) with ordinality as x(c, o)
  where v.tipo <> 'ninguno' and jsonb_typeof(v.componentes) = 'array' and jsonb_array_length(v.componentes) > 0
  union all
  select v.cod_articulo, v.descripcion, v.estado, v.tipo, v.ref_id, v.factor, 0
  from public.im5_articulo_vinculos v
  where v.tipo <> 'ninguno' and (v.componentes is null or jsonb_array_length(v.componentes) = 0);
revoke all on public.im5_vinculo_componentes from anon;
grant select on public.im5_vinculo_componentes to authenticated;

-- Inventario: un ingrediente que es parte de un combo también está sincronizado con el POS.
create or replace function public.inventario_pos_sync()
returns table (ingrediente_id text, activo boolean, desde text, hoy numeric, semana numeric, ultima timestamptz, sin_stock int, articulos text)
language sql stable security definer set search_path = public, private as $$
  with cfg as (select coalesce(config->'pos', '{}'::jsonb) p from ventas_config where id = 1),
  mp as (select private.ingredientes_materia_prima() id),
  vin as (
    select v.ref_id, string_agg(distinct coalesce(v.descripcion, v.cod_articulo), ' · ') arts
    from im5_vinculo_componentes v
    where v.tipo = 'ingrediente' and v.estado = 'confirmado'
      and (coalesce(((select p from cfg)->>'excluirMateriaPrima')::boolean, true) = false or v.ref_id not in (select id from mp where id is not null))
    group by v.ref_id
  ),
  ven as (
    select ref_id,
      sum(cantidad) filter (where estado = 'aplicado' and fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date) hoy,
      sum(cantidad) filter (where estado = 'aplicado' and fecha > (now() at time zone 'America/Argentina/Buenos_Aires')::date - 7) semana,
      max(created_at) filter (where estado = 'aplicado') ultima,
      count(*) filter (where estado = 'sin_stock' and fecha > (now() at time zone 'America/Argentina/Buenos_Aires')::date - 7)::int sin_stock
    from im5_aplicaciones where destino = 'inventario' group by ref_id
  )
  select vin.ref_id, coalesce(((select p from cfg)->>'activo')::boolean, false), coalesce((select p from cfg)->>'desde', ''),
         coalesce(ven.hoy, 0), coalesce(ven.semana, 0), ven.ultima, coalesce(ven.sin_stock, 0), vin.arts
  from vin left join ven on ven.ref_id = vin.ref_id
  where private.es_usuario_activo()
$$;
revoke all on function public.inventario_pos_sync() from public, anon;
grant execute on function public.inventario_pos_sync() to authenticated;

-- Trazabilidad de una salida POS de un lote (Inventario → «Trazabilidad»), sin datos de clientes:
-- factura de ingreso del lote → venta (comprobante, artículo, cantidad) → en qué se desglosó (los otros
-- productos del combo con su lote y factura, o la producción).
-- p_mov: id del movimiento usage_pos_<empresa>_<comprobante>_<orden>_<lote>.
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
    'fecha', c.fecha, 'fecha_hora', c.fecha_hora, 'caja', c.usuario,
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
