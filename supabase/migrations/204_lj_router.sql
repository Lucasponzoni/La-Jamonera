-- 204 · Enrutador: lj_get / lj_set / lj_update (+ lj_keys / lj_get_many para colecciones grandes).

-- Colecciones de registros con columna raw (tabla, columna raw, si son operativas).
create or replace function private.lj_coleccion(s text[], out tabla text, out depth int, out operativa boolean)
language plpgsql immutable as $$
begin
  tabla := null; depth := 0; operativa := false;
  if s[1] = 'ingredientes' and s[2] = 'items' then tabla := 'ingredientes'; depth := 2;
  elsif s[1] = 'ingredientes' and s[2] = 'familias' then tabla := 'familias'; depth := 2;
  elsif s[1] = 'recetas' then tabla := 'recetas'; depth := 1;
  elsif s[1] = 'recetas_groups' then tabla := 'receta_grupos'; depth := 1;
  elsif s[1] = 'produccion' and s[2] = 'registros' then tabla := 'producciones'; depth := 2;
  elsif s[1] = 'produccion' and s[2] = 'auditoria' then tabla := 'produccion_auditoria'; depth := 2; operativa := true;
  elsif s[1] = 'produccion' and s[2] = 'reservas' then tabla := 'produccion_reservas'; depth := 2; operativa := true;
  elsif s[1] = 'produccion' and s[2] = 'drafts' then tabla := 'produccion_borradores'; depth := 2; operativa := true;
  elsif s[1] = 'Reparto' and s[2] = 'registros' then tabla := 'repartos'; depth := 2;
  elsif s[1] = 'Reparto' and s[2] = 'clients' then tabla := 'clientes'; depth := 2;
  elsif s[1] = 'Reparto' and s[2] = 'vehicles' then tabla := 'vehiculos'; depth := 2;
  elsif s[1] = 'public_traces' then tabla := 'public_traces'; depth := 1; operativa := true;
  elsif s[1] = 'informes' and s[2] = 'users' then tabla := 'personas'; depth := 2;
  end if;
end $$;

-- Singletons en app_config (ruta → clave).
create or replace function private.lj_config_key(s text[], out clave text, out depth int)
language plpgsql immutable as $$
begin
  clave := null; depth := 0;
  if s[1] = 'inventario' and s[2] = 'config' then clave := 'inventario'; depth := 2;
  elsif s[1] = 'ingredientes' and s[2] = 'config' then clave := 'ingredientes'; depth := 2;
  elsif s[1] = 'produccion' and s[2] = 'config' then clave := 'produccion'; depth := 2;
  elsif s[1] = 'recetas_config' then clave := 'recetas'; depth := 1;
  elsif s[1] = 'Reparto' and s[2] = 'xlsxConfig' then clave := 'reparto_xlsx'; depth := 2;
  elsif s[1] = 'Reparto' and s[2] = 'localities' then clave := 'reparto_localities'; depth := 2;
  elsif s[1] = 'Reparto' and s[2] = 'sequenceByDate' then clave := 'reparto_sequenceByDate'; depth := 2;
  elsif s[1] = 'informes' and s[2] = 'email_preferences' then clave := 'informes_email'; depth := 2;
  end if;
end $$;

create or replace function private.lj_rest(s text[], d int) returns text[] language sql immutable as $$
  select coalesce(s[d + 1:array_length(s, 1)], '{}'::text[])
$$;

create or replace function private.lj_nav(v jsonb, rest text[]) returns jsonb language sql immutable as $$
  select case when coalesce(array_length(rest, 1), 0) = 0 then v else v #> rest end
$$;

-- Lectura/escritura de un registro de colección.
create or replace function private.lj_reg_get(p_tabla text, p_id text) returns jsonb language plpgsql stable as $$
declare v jsonb;
begin
  if p_tabla = 'produccion_borradores' then
    select datos into v from produccion_borradores where id = p_id;
  elsif p_tabla = 'personas' then
    select case when pin_hash is not null then coalesce(raw, '{}'::jsonb) || jsonb_build_object('pin', '••••', 'hasPin', true) else raw end
      into v from personas where id = p_id;
  else
    execute format('select raw from public.%I where id = $1', p_tabla) into v using p_id;
  end if;
  return v;
end $$;

create or replace function private.lj_reg_map(p_tabla text) returns jsonb language plpgsql stable as $$
declare v jsonb;
begin
  if p_tabla = 'produccion_borradores' then
    select jsonb_object_agg(id, datos) into v from produccion_borradores;
  elsif p_tabla = 'personas' then
    select jsonb_object_agg(id, private.lj_reg_get('personas', id)) into v from personas;
  else
    execute format('select jsonb_object_agg(id, raw) from public.%I where raw is not null', p_tabla) into v;
  end if;
  return v;
end $$;

create or replace function private.lj_reg_set(p_tabla text, p_id text, p_val jsonb, p_operativa boolean) returns void language plpgsql as $$
declare v_old jsonb;
begin
  v_old := private.lj_reg_get(p_tabla, p_id);
  if p_operativa then perform private.lj_exigir('activo');
  else perform private.lj_permiso_registro(v_old, case when p_val is null or jsonb_typeof(p_val) = 'null' then null else p_val end);
  end if;
  if p_val is null or jsonb_typeof(p_val) = 'null' then
    execute format('delete from public.%I where id = $1', p_tabla) using p_id;
    return;
  end if;
  execute format('select private.lj_up_%s($1, $2)', p_tabla) using p_id, p_val;
end $$;

-- Árbol por fecha (informes / análisis): /informes/aaaa/mm/dd/id.
create or replace function private.lj_arbol_get(p_tabla text, s text[]) returns jsonb language plpgsql stable as $$
declare v_pref text; v jsonb;
begin
  v_pref := array_to_string(s, '/');
  execute format($q$
    select jsonb_object_agg(y, mo) from (
      select y, jsonb_object_agg(m, dd) mo from (
        select y, m, jsonb_object_agg(d, items) dd from (
          select split_part(ruta, '/', 1) y, split_part(ruta, '/', 2) m, split_part(ruta, '/', 3) d, jsonb_object_agg(id, raw) items
          from public.%I where ruta is not null and raw is not null and ((ruta || '/' || id) like $1 || '%%' or $1 like (ruta || '/' || id) || '/%%')
          group by 1, 2, 3) a
        group by y, m) b
      group by y) c $q$, p_tabla) into v using v_pref;
  return private.lj_nav(v, s);
end $$;

-- Escritura en el árbol por fecha. s = [aaaa, mm, dd, id, ...campo]. Nivel registro o más profundo
-- (campo dentro del registro). Niveles parciales (aaaa / mm / dd) se recorren hoja por hoja.
create or replace function private.lj_arbol_set(p_tabla text, s text[], p_val jsonb) returns void language plpgsql as $$
declare n int := coalesce(array_length(s, 1), 0); v_ruta text; v_old jsonb; v_new jsonb; k text; v jsonb;
begin
  if n >= 4 then
    v_ruta := s[1] || '/' || s[2] || '/' || s[3];
    execute format('select raw from public.%I where id = $1', p_tabla) into v_old using s[4];
    v_new := case when n = 4 then p_val else private.lj_jset(v_old, s[5:n], p_val) end;
    perform private.lj_permiso_registro(v_old, v_new);
    if v_new is null then execute format('delete from public.%I where id = $1', p_tabla) using s[4]; return; end if;
    execute format('select private.lj_up_%s($1, $2, $3)', p_tabla) using v_ruta, s[4], v_new;
    return;
  end if;
  -- Nivel parcial: borrar lo que había bajo ese prefijo y no viene; guardar lo que viene.
  for k, v_ruta in execute format('select id, ruta from public.%I where ruta like $1 || ''%%''', p_tabla) using array_to_string(s, '/') loop
    if p_val is null or (p_val #> (private.lj_segs(substr(v_ruta || '/' || k, length(array_to_string(s, '/')) + 1)))) is null then
      perform private.lj_arbol_set(p_tabla, string_to_array(v_ruta, '/') || k, null);
    end if;
  end loop;
  if p_val is not null and jsonb_typeof(p_val) = 'object' then
    for k, v in select key, value from jsonb_each(p_val) loop
      perform private.lj_arbol_set(p_tabla, s || k, v);
    end loop;
  end if;
end $$;

-- Respaldo genérico rtdb_raw: documentos por ruta; la lectura navega dentro del documento más cercano
-- o compone los documentos hijos.
create or replace function private.lj_raw_get(p text) returns jsonb language plpgsql stable as $$
declare v_doc record; v jsonb; r record;
begin
  select path, value into v_doc from rtdb_raw where p = path or p like path || '/%' order by length(path) desc limit 1;
  if found then
    return private.lj_nav(v_doc.value, private.lj_segs(substr(p, length(v_doc.path) + 1)));
  end if;
  v := null;
  for r in select path, value from rtdb_raw where path like p || '/%' loop
    v := private.lj_jset(v, private.lj_segs(substr(r.path, length(p) + 1)), r.value);
  end loop;
  return v;
end $$;

create or replace function private.lj_raw_set(p text, val jsonb) returns void language plpgsql as $$
declare v_doc record;
begin
  select path, value into v_doc from rtdb_raw where p = path or p like path || '/%' order by length(path) desc limit 1;
  if found then
    if v_doc.path = p then
      if val is null or jsonb_typeof(val) = 'null' then delete from rtdb_raw where path = p;
      else update rtdb_raw set value = val, updated_at = now() where path = p; end if;
    else
      update rtdb_raw set value = private.lj_jset(value, private.lj_segs(substr(p, length(v_doc.path) + 1)), val), updated_at = now()
        where path = v_doc.path;
    end if;
    return;
  end if;
  delete from rtdb_raw where path like p || '/%';
  if val is not null and jsonb_typeof(val) <> 'null' then
    insert into rtdb_raw (path, value) values (p, val);
  end if;
end $$;

-- Nodos que NO se migran (credenciales viejas): lectura vacía, escritura rechazada.
create or replace function private.lj_bloqueada(s text[]) returns boolean language sql immutable as $$
  select s[1] in ('passGeneral', 'user', 'email_sender', 'deepseek', '_secure')
$$;

-- ===================== lj_get =====================
create or replace function public.lj_get(p_path text) returns jsonb
language plpgsql stable security definer set search_path = public, private, extensions as $$
declare
  s text[] := private.lj_segs(p_path); n int := coalesce(array_length(s, 1), 0);
  c record; k record; v jsonb;
begin
  perform private.lj_exigir('activo');
  if n = 0 then raise exception 'ruta_raiz_no_permitida'; end if;
  if private.lj_bloqueada(s) then return null; end if;

  -- Inventario
  if s[1] = 'inventario' then
    if n = 1 then
      return jsonb_strip_nulls(jsonb_build_object('config', (select value from app_config where key = 'inventario'),
        'items', (select jsonb_object_agg(ingrediente_id, private.lj_inv_get(ingrediente_id)) from inventario_registros),
        'indexes', private.lj_raw_get('/inventario/indexes')));
    elsif s[2] = 'items' then
      if n = 2 then return (select jsonb_object_agg(ingrediente_id, private.lj_inv_get(ingrediente_id)) from inventario_registros); end if;
      return private.lj_nav(private.lj_inv_get(s[3]), private.lj_rest(s, 3));
    end if;
  end if;

  select * into c from private.lj_coleccion(s);
  if c.tabla is not null then
    if n = c.depth then return private.lj_reg_map(c.tabla); end if;
    return private.lj_nav(private.lj_reg_get(c.tabla, s[c.depth + 1]), private.lj_rest(s, c.depth + 1));
  end if;

  select * into k from private.lj_config_key(s);
  if k.clave is not null then
    return private.lj_nav((select value from app_config where key = k.clave), private.lj_rest(s, k.depth));
  end if;

  if s[1] = 'produccion' and s[2] = 'sequence' then
    return (select to_jsonb(valor) from secuencias where nombre = 'produccion');
  end if;

  if s[1] = 'informes' and n >= 2 and s[2] ~ '^\d{4}$' then return private.lj_arbol_get('informes', s[2:n]); end if;
  if s[1] = 'analisis_quimicos' and n >= 2 then return private.lj_arbol_get('analisis', s[2:n]); end if;
  if s[1] = 'analisis_quimicos' then return private.lj_arbol_get('analisis', '{}'); end if;

  -- Raíces compuestas
  if n = 1 and s[1] = 'ingredientes' then
    return jsonb_strip_nulls(jsonb_build_object('config', (select value from app_config where key = 'ingredientes'),
      'familias', private.lj_reg_map('familias'), 'items', private.lj_reg_map('ingredientes')));
  end if;
  if n = 1 and s[1] = 'produccion' then
    return jsonb_strip_nulls(jsonb_build_object('config', (select value from app_config where key = 'produccion'),
      'registros', private.lj_reg_map('producciones'), 'auditoria', private.lj_reg_map('produccion_auditoria'),
      'reservas', private.lj_reg_map('produccion_reservas'), 'drafts', private.lj_reg_map('produccion_borradores'),
      'sequence', (select to_jsonb(valor) from secuencias where nombre = 'produccion')));
  end if;
  if n = 1 and s[1] = 'Reparto' then
    return jsonb_strip_nulls(jsonb_build_object('registros', private.lj_reg_map('repartos'), 'clients', private.lj_reg_map('clientes'),
      'vehicles', private.lj_reg_map('vehiculos'), 'xlsxConfig', (select value from app_config where key = 'reparto_xlsx'),
      'localities', (select value from app_config where key = 'reparto_localities'),
      'sequenceByDate', (select value from app_config where key = 'reparto_sequenceByDate'),
      'productIndex', private.lj_raw_get('/Reparto/productIndex')));
  end if;
  if n = 1 and s[1] = 'informes' then
    v := coalesce(private.lj_arbol_get('informes', '{}'), '{}'::jsonb);
    return jsonb_strip_nulls(v || jsonb_build_object('users', private.lj_reg_map('personas'),
      'email_preferences', (select value from app_config where key = 'informes_email')));
  end if;

  -- Preferencias de usuario (tema): /userPreferences/{uid}/theme
  if s[1] = 'userPreferences' then
    if n >= 2 then
      return private.lj_nav((select jsonb_strip_nulls(jsonb_build_object('theme', theme)) from profiles where id::text = s[2]), private.lj_rest(s, 2));
    end if;
    return (select jsonb_object_agg(id::text, jsonb_build_object('theme', theme)) from profiles where theme is not null);
  end if;

  return private.lj_raw_get('/' || array_to_string(s, '/'));
end $$;

-- ===================== lj_set =====================
create or replace function public.lj_set(p_path text, p_value jsonb) returns void
language plpgsql volatile security definer set search_path = public, private, extensions as $$
declare
  s text[] := private.lj_segs(p_path); n int := coalesce(array_length(s, 1), 0);
  c record; k record; v_old jsonb; v_new jsonb; v_key text; v_child jsonb; v_ruta text;
  -- Como Firebase: los null no se guardan.
  v_val jsonb := case when p_value is null or jsonb_typeof(p_value) = 'null' then null else jsonb_strip_nulls(p_value) end;
begin
  perform private.lj_exigir('activo');
  if n = 0 then raise exception 'ruta_raiz_no_permitida'; end if;
  if private.lj_bloqueada(s) then raise exception 'ruta_no_migrada %', p_path; end if;

  if s[1] = 'inventario' and s[2] = 'items' then
    if n = 2 then
      for v_key, v_child in select key, value from jsonb_each(coalesce(v_val, '{}'::jsonb)) loop
        perform private.lj_inv_set(v_key, v_child);
      end loop;
      return;
    end if;
    if n = 3 then perform private.lj_inv_set(s[3], v_val); return; end if;
    perform private.lj_inv_set(s[3], private.lj_jset(private.lj_inv_get(s[3]), private.lj_rest(s, 3), v_val));
    return;
  end if;

  select * into c from private.lj_coleccion(s);
  if c.tabla is not null then
    if n = c.depth then
      -- Reemplazo de la colección entera: borra los que no vienen y guarda los que vienen.
      for v_key in execute format('select id from public.%I', c.tabla) loop
        if v_val is null or not (v_val ? v_key) then perform private.lj_reg_set(c.tabla, v_key, null, c.operativa); end if;
      end loop;
      for v_key, v_child in select key, value from jsonb_each(coalesce(v_val, '{}'::jsonb)) loop
        perform private.lj_reg_set(c.tabla, v_key, v_child, c.operativa);
      end loop;
      return;
    end if;
    if n = c.depth + 1 then perform private.lj_reg_set(c.tabla, s[n], v_val, c.operativa); return; end if;
    v_old := private.lj_reg_get(c.tabla, s[c.depth + 1]);
    perform private.lj_reg_set(c.tabla, s[c.depth + 1], private.lj_jset(v_old, private.lj_rest(s, c.depth + 1), v_val), c.operativa);
    return;
  end if;

  select * into k from private.lj_config_key(s);
  if k.clave is not null then
    v_old := (select value from app_config where key = k.clave);
    v_new := private.lj_jset(v_old, private.lj_rest(s, k.depth), v_val);
    if v_new is null then delete from app_config where key = k.clave;
    else
      insert into app_config (key, value, updated_at, updated_by) values (k.clave, v_new, now(), auth.uid())
      on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
    end if;
    return;
  end if;

  if s[1] = 'produccion' and s[2] = 'sequence' and n = 2 then
    insert into secuencias (nombre, valor) values ('produccion', coalesce(private.lj_num(v_val)::bigint, 0))
    on conflict (nombre) do update set valor = excluded.valor;
    return;
  end if;

  if s[1] in ('informes', 'analisis_quimicos') and n >= 2 and s[2] ~ '^\d{4}$' then
    perform private.lj_arbol_set(case when s[1] = 'informes' then 'informes' else 'analisis' end, s[2:n], v_val);
    return;
  end if;

  if s[1] = 'userPreferences' and n >= 2 then
    if s[2] = auth.uid()::text then
      update profiles set theme = case when v_val is null then null else coalesce(private.lj_txt(private.lj_nav(private.lj_jset(jsonb_build_object('theme', theme), private.lj_rest(s, 2), v_val), '{theme}')), theme) end,
        updated_at = now() where id = auth.uid();
    end if;
    return;
  end if;

  perform private.lj_raw_set('/' || array_to_string(s, '/'), v_val);
end $$;

revoke execute on function public.lj_get(text) from public, anon;
revoke execute on function public.lj_set(text, jsonb) from public, anon;
grant execute on function public.lj_get(text) to authenticated;
grant execute on function public.lj_set(text, jsonb) to authenticated;

-- ===================== lj_update (update() de Firebase: claves pueden ser rutas "a/b") =====================
create or replace function public.lj_update(p_path text, p_patch jsonb) returns void
language plpgsql volatile security definer set search_path = public, private, extensions as $$
declare k text; v jsonb; base text := '/' || array_to_string(private.lj_segs(p_path), '/');
begin
  perform private.lj_exigir('activo');
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return; end if;
  for k, v in select key, value from jsonb_each(p_patch) loop
    perform public.lj_set(case when base = '/' then '/' || k else base || '/' || k end, v);
  end loop;
end $$;

-- Claves de una colección / mapa (para leer colecciones grandes de a partes).
create or replace function public.lj_keys(p_path text) returns text[]
language plpgsql stable security definer set search_path = public, private, extensions as $$
declare s text[] := private.lj_segs(p_path); c record; v jsonb; v_keys text[];
begin
  perform private.lj_exigir('activo');
  if s[1] = 'inventario' and s[2] = 'items' and array_length(s, 1) = 2 then
    return (select coalesce(array_agg(ingrediente_id order by ingrediente_id), '{}') from inventario_registros);
  end if;
  select * into c from private.lj_coleccion(s);
  if c.tabla is not null and array_length(s, 1) = c.depth then
    execute format('select coalesce(array_agg(id order by id), ''{}'') from public.%I', c.tabla) into v_keys;
    return v_keys;
  end if;
  v := public.lj_get(p_path);
  if v is null or jsonb_typeof(v) <> 'object' then return '{}'; end if;
  return (select coalesce(array_agg(key order by key), '{}') from jsonb_object_keys(v) key);
end $$;

create or replace function public.lj_get_many(p_path text, p_keys text[]) returns jsonb
language plpgsql stable security definer set search_path = public, private, extensions as $$
declare k text; out jsonb := '{}'::jsonb; base text := '/' || array_to_string(private.lj_segs(p_path), '/'); v jsonb;
begin
  perform private.lj_exigir('activo');
  foreach k in array coalesce(p_keys, '{}') loop
    v := public.lj_get(base || '/' || k);
    if v is not null then out := out || jsonb_build_object(k, v); end if;
  end loop;
  return out;
end $$;

revoke execute on function public.lj_update(text, jsonb) from public, anon;
revoke execute on function public.lj_keys(text) from public, anon;
revoke execute on function public.lj_get_many(text, text[]) from public, anon;
grant execute on function public.lj_update(text, jsonb), public.lj_keys(text), public.lj_get_many(text, text[]) to authenticated;
