-- 224 · Para Inventario (cualquier usuario activo): productos sincronizados con el POS y sus ventas, sin datos de clientes.
create or replace function public.inventario_pos_sync()
returns table (ingrediente_id text, activo boolean, desde text, hoy numeric, semana numeric, ultima timestamptz, sin_stock int, articulos text)
language sql stable security definer set search_path = public, private as $$
  with cfg as (select coalesce(config->'pos', '{}'::jsonb) p from ventas_config where id = 1),
  mp as (select private.ingredientes_materia_prima() id),
  vin as (
    select v.ref_id, string_agg(coalesce(v.descripcion, v.cod_articulo), ' · ' order by v.cod_articulo) arts
    from im5_articulo_vinculos v
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
