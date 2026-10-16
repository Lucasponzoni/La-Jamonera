-- 222 · Ventas del POS (InfoManager) → Inventario y Producción.
-- Cada renglón vendido de un artículo vinculado descuenta stock real: lotes de Inventario (ingredientes de reventa)
-- o lotes producidos (recetas). Lo aplicado queda en im5_aplicaciones (una fila por renglón y lote), que es también
-- lo que usan la app y la trazabilidad para ver «vendido en el local». La configuración vive en ventas_config.config.pos.

-- Factor: cuánto del stock de Inventario es 1 unidad vendida en el POS (ej. «CARBON X 5 KG» → 5 kg). Null = 1.
alter table public.im5_articulo_vinculos add column if not exists factor numeric(12, 4);

create table if not exists public.im5_aplicaciones (
  id bigserial primary key,
  empresa smallint not null,
  comprobante_id bigint not null,
  orden int not null,                       -- renglón (im5_items.orden)
  cod_articulo text,
  fecha date not null,                      -- fecha de la venta
  destino text not null check (destino in ('inventario', 'produccion')),
  ref_id text,                              -- ingrediente o receta
  lote_id text,                             -- inventario_lotes.id o producciones.id (null si no se aplicó)
  cantidad numeric(14, 4),                  -- en la unidad del stock (kg para producción)
  unidad text,
  estado text not null check (estado in ('aplicado', 'sin_stock', 'excluido', 'revertido')),
  motivo text,                              -- por qué no se aplicó / detalle
  reparto_id text,                          -- si vino de un reparto (BRENDA + dirección)
  run_id text,
  created_at timestamptz not null default now()
);
create index if not exists im5_aplic_comp_idx on public.im5_aplicaciones (empresa, comprobante_id, orden);
create index if not exists im5_aplic_ref_idx on public.im5_aplicaciones (destino, ref_id, fecha);
create index if not exists im5_aplic_lote_idx on public.im5_aplicaciones (lote_id) where lote_id is not null;

alter table public.im5_aplicaciones enable row level security;
drop policy if exists im5_aplic_leer on public.im5_aplicaciones;
-- La lee quien ve ventas y también Inventario/Producción (usuario activo): no tiene datos de clientes.
create policy im5_aplic_leer on public.im5_aplicaciones for select to authenticated using ((select private.es_usuario_activo()));
revoke all on public.im5_aplicaciones from anon;
grant select on public.im5_aplicaciones to authenticated;

-- Materia prima: ingredientes que aparecen en alguna receta (fila o sustituto). Esos no se descuentan por ventas.
create or replace function private.ingredientes_materia_prima()
returns setof text language sql stable set search_path = public as $$
  select distinct row->>'ingredientId' from recetas r, jsonb_array_elements(coalesce(r.raw->'rows', '[]'::jsonb)) row
  where row->>'type' = 'ingredient' and row->>'ingredientId' is not null
  union
  select distinct rel->>'ingredientId' from recetas r, jsonb_array_elements(coalesce(r.raw->'rows', '[]'::jsonb)) row,
    jsonb_array_elements(coalesce(row->'relatedIngredients', '[]'::jsonb)) rel
  where rel->>'ingredientId' is not null
$$;

-- Disponible de cada producción de una receta (igual que la app: producido − repartos − egresos del índice − ventas POS).
create or replace function private.produccion_disponible(p_receta text)
returns table (produccion_id text, fecha date, vence date, producido numeric, repartido numeric, otros numeric, vendido_pos numeric, disponible numeric)
language sql stable set search_path = public as $$
  with prod as (
    select id, fecha_produccion, vencimiento_producto, coalesce(kg, 0) kg from producciones
    where receta_id = p_receta and coalesce(estado, '') <> 'anulada'
  ), rep as (
    select a->>'productionId' pid, sum(coalesce((a->>'qtyKg')::numeric, 0)) kg
    from reparto_items ri, jsonb_array_elements(coalesce(ri.asignaciones, '[]'::jsonb)) a
    where ri.receta_id = p_receta and coalesce(a->>'productionId', '') <> '' group by 1
  ), mov as (
    select p.id pid, sum(coalesce((m->>'qtyKg')::numeric, 0)) kg
    from rtdb_raw r, jsonb_each(coalesce(r.value -> p_receta -> 'movements', '{}'::jsonb)) e(k, m), prod p
    where r.path = '/Reparto/productIndex' and m->>'type' = 'egreso'
      and p.id in (m->>'sourceId', m->>'sourceCode', m->>'lotNumber')
      and not exists (select 1 from repartos x where x.id = m->>'sourceId')   -- los repartos ya cuentan por asignaciones
    group by 1
  ), pos as (
    select lote_id pid, sum(cantidad) kg from im5_aplicaciones
    where destino = 'produccion' and estado = 'aplicado' and reparto_id is null and ref_id = p_receta group by 1
  )
  select p.id, p.fecha_produccion, p.vencimiento_producto, p.kg, coalesce(rep.kg, 0), coalesce(mov.kg, 0), coalesce(pos.kg, 0),
         greatest(0, p.kg - coalesce(rep.kg, 0) - coalesce(mov.kg, 0) - coalesce(pos.kg, 0))
  from prod p left join rep on rep.pid = p.id left join mov on mov.pid = p.id left join pos on pos.pid = p.id
$$;

-- Para la Edge Function (service_role): disponible por producción de varias recetas.
create or replace function public.pos_produccion_disponible(p_recetas text[])
returns table (receta_id text, produccion_id text, fecha date, vence date, disponible numeric)
language sql stable security definer set search_path = public as $$
  select r, d.produccion_id, d.fecha, d.vence, d.disponible from unnest(p_recetas) r, private.produccion_disponible(r) d
$$;
revoke all on function public.pos_produccion_disponible(text[]) from public, anon, authenticated;
grant execute on function public.pos_produccion_disponible(text[]) to service_role;

create or replace function public.pos_materia_prima()
returns setof text language sql stable security definer set search_path = public as $$ select * from private.ingredientes_materia_prima() $$;
revoke all on function public.pos_materia_prima() from public, anon;
grant execute on function public.pos_materia_prima() to service_role, authenticated;

-- Guarda un reparto creado desde el POS con el mismo camino que la app (repartos + reparto_items).
create or replace function public.pos_guardar_reparto(p_id text, r jsonb)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  perform private.lj_up_repartos(p_id, r);
end $$;
revoke all on function public.pos_guardar_reparto(text, jsonb) from public, anon, authenticated;
grant execute on function public.pos_guardar_reparto(text, jsonb) to service_role;

-- Ventas y repartos de cada producción (para la trazabilidad de la app): totales por producción.
create or replace function public.produccion_salidas(p_ids text[])
returns table (produccion_id text, vendido_kg numeric, ventas int, repartido_kg numeric, repartos int, ultima date)
language sql stable security invoker set search_path = public as $$
  with v as (
    select lote_id pid, sum(cantidad) kg, count(distinct (empresa, comprobante_id)) n, max(fecha) f from im5_aplicaciones
    where destino = 'produccion' and estado = 'aplicado' and reparto_id is null and lote_id = any(p_ids) group by 1
  ), r as (
    select a->>'productionId' pid, sum(coalesce((a->>'qtyKg')::numeric, 0)) kg, count(distinct ri.reparto_id) n, max(rp.fecha) f
    from reparto_items ri join repartos rp on rp.id = ri.reparto_id, jsonb_array_elements(coalesce(ri.asignaciones, '[]'::jsonb)) a
    where a->>'productionId' = any(p_ids) group by 1
  )
  select x.id, coalesce(v.kg, 0), coalesce(v.n, 0)::int, coalesce(r.kg, 0), coalesce(r.n, 0)::int, greatest(v.f, r.f)
  from unnest(p_ids) x(id) left join v on v.pid = x.id left join r on r.pid = x.id
  where private.es_usuario_activo()
$$;
revoke all on function public.produccion_salidas(text[]) from public, anon;
grant execute on function public.produccion_salidas(text[]) to authenticated;

-- Vista pública (QR): sólo totales de una producción, sin clientes ni direcciones.
create or replace function public.traza_publica_salidas(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'vendidoKg', coalesce((select sum(cantidad) from im5_aplicaciones where destino = 'produccion' and estado = 'aplicado' and reparto_id is null and lote_id = p_id), 0),
    'repartidoKg', coalesce((select sum(coalesce((a->>'qtyKg')::numeric, 0)) from reparto_items ri, jsonb_array_elements(coalesce(ri.asignaciones, '[]'::jsonb)) a where a->>'productionId' = p_id), 0),
    'repartos', coalesce((select count(distinct ri.reparto_id) from reparto_items ri, jsonb_array_elements(coalesce(ri.asignaciones, '[]'::jsonb)) a where a->>'productionId' = p_id), 0))
$$;
revoke all on function public.traza_publica_salidas(text) from public;
grant execute on function public.traza_publica_salidas(text) to anon, authenticated;

-- Resumen de ventas POS por ingrediente (para la tabla de Inventario).
create or replace function public.inventario_ventas_pos()
returns table (ingrediente_id text, hoy numeric, semana numeric, ultima timestamptz, sin_stock int)
language sql stable security invoker set search_path = public as $$
  select ref_id,
    sum(cantidad) filter (where estado = 'aplicado' and fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date),
    sum(cantidad) filter (where estado = 'aplicado' and fecha > (now() at time zone 'America/Argentina/Buenos_Aires')::date - 7),
    max(created_at) filter (where estado = 'aplicado'),
    count(*) filter (where estado = 'sin_stock' and fecha > (now() at time zone 'America/Argentina/Buenos_Aires')::date - 7)::int
  from im5_aplicaciones where destino = 'inventario' and private.es_usuario_activo()
  group by ref_id
$$;
revoke all on function public.inventario_ventas_pos() from public, anon;
grant execute on function public.inventario_ventas_pos() to authenticated;
