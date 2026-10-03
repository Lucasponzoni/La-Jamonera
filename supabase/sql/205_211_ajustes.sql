-- 205–211 · Ajustes aplicados después del enrutador (ya ejecutados en el proyecto).

-- 205 · search_path explícito en todas las funciones private.lj_* (aviso de Supabase).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname like 'lj\_%' loop
    execute format('alter function %s set search_path = public, private, extensions', f.sig);
  end loop;
end $$;

-- 206 · traza_publica con las formas exactas de Firebase (trace = nodo completo de /public_traces/{id}).
drop function if exists public.traza_publica(text);
create or replace function public.traza_publica(p_id text, p_recipe text default null) returns jsonb
language sql stable security definer set search_path = public, private as $$
  with t as (select coalesce(raw, jsonb_build_object('registro', registro, 'config', config, 'version', version)) v, registro from public_traces where id = p_id),
       p as (select raw from producciones where id = p_id),
       r as (select rc.* from recetas rc
             where rc.id = coalesce(nullif(p_recipe, ''), (select raw->>'recipeId' from p), (select registro->>'recipeId' from t),
                                    (select registro#>>'{traceability,product,id}' from t)))
  select jsonb_build_object(
    'trace',    (select v from t),
    'registro', (select raw from p),
    'rne',      (select value -> 'rne' from app_config where key = 'produccion'),
    'recipe',   (select jsonb_build_object(
                   'rnpa', coalesce(r.raw -> 'rnpa', r.rnpa),
                   'rnpaNotRequired', r.raw -> 'rnpaNotRequired',
                   'rnpaExempt', r.raw -> 'rnpaExempt',
                   'subproductNoRnpa', r.raw -> 'subproductNoRnpa',
                   'rnpaExemptReason', r.raw -> 'rnpaExemptReason') from r)
  )
$$;
revoke execute on function public.traza_publica(text, text) from public;
grant execute on function public.traza_publica(text, text) to anon, authenticated;

-- 207 · Índice para armar el inventario por ingrediente.
create index if not exists movimientos_ing_lote_origen_orden_idx on movimientos (ingrediente_id, lote_id, origen, orden);

-- 208 · Caché del JSON completo de cada registro de inventario (se invalida con triggers).
alter table inventario_registros add column if not exists cache_json jsonb;

create or replace function private.lj_inv_build(p_ing text) returns jsonb
language plpgsql stable set search_path = public, private, extensions as $$
declare v_reg jsonb; v_entries jsonb; v_exists boolean;
begin
  select raw, true into v_reg, v_exists from inventario_registros where ingrediente_id = p_ing;
  with mov as (
    select lote_id, origen, jsonb_agg(datos order by orden) arr
    from movimientos where ingrediente_id = p_ing group by lote_id, origen
  ), movl as (
    select lote_id, jsonb_object_agg(origen::text, arr) j from mov group by lote_id
  )
  select jsonb_agg(
           coalesce(l.raw, jsonb_strip_nulls(jsonb_build_object('id', l.id, 'entryDate', l.fecha_ingreso, 'expiryDate', l.vencimiento,
             'unit', l.unidad, 'qty', l.cantidad, 'qtyBase', l.cantidad_base, 'qtyKg', l.cantidad_kg, 'availableQty', l.disponible,
             'availableBase', l.disponible_base, 'availableKg', l.disponible_kg, 'provider', l.proveedor, 'invoiceNumber', l.factura,
             'lotNumber', l.lote))) || coalesce(movl.j, '{}'::jsonb)
           order by l.orden nulls last, l.fecha_ingreso, l.id)
    into v_entries
  from inventario_lotes l left join movl on movl.lote_id = l.id
  where l.ingrediente_id = p_ing;
  if not coalesce(v_exists, false) and v_entries is null then return null; end if;
  v_reg := coalesce(v_reg, jsonb_build_object('ingredientId', p_ing));
  if v_entries is not null then v_reg := v_reg || jsonb_build_object('entries', v_entries); end if;
  return v_reg;
end $$;

create or replace function private.lj_inv_get(p_ing text) returns jsonb
language sql stable set search_path = public, private, extensions as $$
  select coalesce((select cache_json from inventario_registros where ingrediente_id = p_ing), private.lj_inv_build(p_ing))
$$;

create or replace function private.lj_inv_cache_fill(p_ing text) returns void
language sql set search_path = public, private, extensions as $$
  update inventario_registros set cache_json = private.lj_inv_build(p_ing) where ingrediente_id = p_ing
$$;

create or replace function private.lj_inv_cache_invalidate() returns trigger
language plpgsql set search_path = public, private as $$
begin
  if tg_table_name = 'inventario_registros' then
    if tg_op = 'UPDATE' and new.cache_json is not null and old.cache_json is distinct from new.cache_json
       and old.raw is not distinct from new.raw then
      return new;
    end if;
    if tg_op <> 'DELETE' then new.cache_json := null; return new; end if;
    return old;
  end if;
  update inventario_registros set cache_json = null
   where ingrediente_id in (
     select coalesce((case when tg_op = 'DELETE' then null else new.ingrediente_id end), null)
     union select (case when tg_op = 'INSERT' then null else old.ingrediente_id end))
     and cache_json is not null;
  return null;
end $$;

drop trigger if exists inv_cache_reg on inventario_registros;
create trigger inv_cache_reg before insert or update on inventario_registros
  for each row execute function private.lj_inv_cache_invalidate();
drop trigger if exists inv_cache_lotes on inventario_lotes;
create trigger inv_cache_lotes after insert or update or delete on inventario_lotes
  for each row execute function private.lj_inv_cache_invalidate();
drop trigger if exists inv_cache_mov on movimientos;
create trigger inv_cache_mov after insert or update or delete on movimientos
  for each row execute function private.lj_inv_cache_invalidate();

-- 209 · lj_inv_set guarda y vuelve a llenar la caché.
alter function private.lj_inv_set(text, jsonb) rename to lj_inv_set_core;
create or replace function private.lj_inv_set(p_ing text, p_val jsonb) returns void
language plpgsql set search_path = public, private, extensions as $$
begin
  perform private.lj_inv_set_core(p_ing, p_val);
  if p_val is not null and jsonb_typeof(p_val) <> 'null' then
    perform private.lj_inv_cache_fill(p_ing);
  end if;
end $$;

-- 210 · Tamaños comprimidos por registro (la app arma lotes de lectura por tamaño).
create or replace function public.lj_sizes(p_path text) returns jsonb
language plpgsql stable security definer set search_path = public, private, extensions as $$
begin
  perform private.lj_exigir('activo');
  if p_path in ('/inventario/items', 'inventario/items') then
    return (select jsonb_object_agg(ingrediente_id, coalesce(pg_column_size(cache_json), 50000)) from inventario_registros);
  end if;
  return null;
end $$;
revoke execute on function public.lj_sizes(text) from public, anon;
grant execute on function public.lj_sizes(text) to authenticated;

-- 211 · Cada 5 minutos se rearma la caché invalidada por otros escritores (carga, auto-egresos).
create or replace function private.lj_inv_cache_fill_pending() returns int
language plpgsql set search_path = public, private, extensions as $$
declare k text; n int := 0;
begin
  for k in select ingrediente_id from inventario_registros where cache_json is null loop
    perform private.lj_inv_cache_fill(k); n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function private.lj_inv_cache_fill_pending() from public, anon, authenticated;
select cron.schedule('lj-inventario-cache', '*/5 * * * *', $$select private.lj_inv_cache_fill_pending()$$);
-- También: timeout de sentencias para usuarios autenticados (lecturas grandes) + recargar PostgREST.
alter role authenticated set statement_timeout = '60s';
notify pgrst, 'reload config';
