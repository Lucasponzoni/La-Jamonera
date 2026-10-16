-- 220 · Vínculo de cada artículo de IM5 (cod_articulo) con lo que es en la fábrica: un ingrediente de Inventario
-- o una receta de Producción (para mostrar su imagen y nombre en Ventas del local). Las sugerencias automáticas
-- (por similitud de nombre) quedan como 'sugerido' hasta que alguien las confirma o las cambia.

create table if not exists public.im5_articulo_vinculos (
  cod_articulo text primary key,
  descripcion text,                                   -- descripción de IM5 al vincular (referencia)
  tipo text not null check (tipo in ('ingrediente', 'receta', 'ninguno')),
  ref_id text,                                        -- id de ingredientes / recetas (null si 'ninguno')
  estado text not null default 'confirmado' check (estado in ('sugerido', 'confirmado')),
  similitud numeric(4, 3),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check ((tipo = 'ninguno') = (ref_id is null))
);

alter table public.im5_articulo_vinculos enable row level security;
drop policy if exists im5_vinculos_leer on public.im5_articulo_vinculos;
create policy im5_vinculos_leer on public.im5_articulo_vinculos for select to authenticated using ((select private.puede_ver_ventas()));
drop policy if exists im5_vinculos_escribir on public.im5_articulo_vinculos;
create policy im5_vinculos_escribir on public.im5_articulo_vinculos for all to authenticated
  using ((select private.puede_ver_ventas()) and (select private.puede_editar()))
  with check ((select private.puede_ver_ventas()) and (select private.puede_editar()));
revoke all on public.im5_articulo_vinculos from anon;
grant select, insert, update, delete on public.im5_articulo_vinculos to authenticated;

-- Catálogo para vincular: artículos vendidos con totales y su vínculo actual.
create or replace function public.ventas_articulos()
returns table (cod_articulo text, descripcion text, unidad text, cantidad numeric, importe numeric, comprobantes bigint,
               ultima_venta date, tipo text, ref_id text, estado text, similitud numeric)
language sql stable security invoker set search_path = public as $$
  select i.cod_articulo, max(i.descripcion), max(i.unidad), sum(i.cantidad * c.signo), sum(i.importe * c.signo),
         count(distinct (i.empresa, i.comprobante_id)), max(c.fecha), v.tipo, v.ref_id, v.estado, v.similitud
  from im5_items i
  join (select empresa, id, fecha, case when tipo = 'NC' then -1 else 1 end signo from im5_comprobantes where not anulada) c
    on c.empresa = i.empresa and c.id = i.comprobante_id
  left join im5_articulo_vinculos v on v.cod_articulo = i.cod_articulo
  where i.cod_articulo is not null and private.puede_ver_ventas()
  group by i.cod_articulo, v.tipo, v.ref_id, v.estado, v.similitud
$$;
revoke all on function public.ventas_articulos() from public, anon;
grant execute on function public.ventas_articulos() to authenticated;

-- Sugiere vínculo para los artículos que todavía no tienen ninguno (no toca lo confirmado ni lo ya sugerido).
-- Compara la descripción de IM5 con recetas (nombre comercial y título) e ingredientes, sin acentos.
create or replace function public.ventas_articulos_sugerir(p_umbral numeric default 0.5)
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare n integer;
begin
  if not (private.puede_ver_ventas() and private.puede_editar()) then raise exception 'sin_permiso' using errcode = '42501'; end if;
  with art as (
    select i.cod_articulo cod, max(i.descripcion) descr from im5_items i
    where i.cod_articulo is not null and not exists (select 1 from im5_articulo_vinculos v where v.cod_articulo = i.cod_articulo)
    group by 1
  ), cand as (
    select 'receta' tipo, id, coalesce(nullif(raw->>'nombreComercial', ''), raw->>'title') nombre from recetas
    union all select 'receta', id, raw->>'title' from recetas where coalesce(raw->>'nombreComercial', '') <> ''
    union all select 'ingrediente', id, coalesce(nombre, raw->>'name') from ingredientes
  ), mejor as (
    select distinct on (a.cod) a.cod, a.descr, c.tipo, c.id,
           similarity(lower(unaccent(a.descr)), lower(unaccent(c.nombre))) s
    from art a join cand c on c.nombre is not null and c.nombre not ilike '(ingrediente eliminado)%'
    order by a.cod, similarity(lower(unaccent(a.descr)), lower(unaccent(c.nombre))) desc, c.tipo desc
  )
  insert into im5_articulo_vinculos (cod_articulo, descripcion, tipo, ref_id, estado, similitud, updated_by)
  select cod, descr, tipo, id, 'sugerido', round(s::numeric, 3), auth.uid() from mejor where s >= p_umbral
  on conflict (cod_articulo) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ventas_articulos_sugerir(numeric) from public, anon;
grant execute on function public.ventas_articulos_sugerir(numeric) to authenticated;
