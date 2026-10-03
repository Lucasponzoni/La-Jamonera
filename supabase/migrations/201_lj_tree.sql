-- 201 · Árbol virtual "estilo Firebase" sobre las tablas.
-- La app lee y escribe registros enteros por ruta (/recetas/{id}, /inventario/items/{id}, …).
-- lj_get / lj_set / lj_update reconstruyen y guardan exactamente el JSON original
-- (columna raw; inventario: raw del registro + lotes + movimientos) y aplican los permisos:
--   crear → usuario activo · modificar un registro guardado → puede_editar · borrar → puede_borrar.
-- Excepciones operativas (producir, ingresar, reservas, borradores, índices, secuencias, QR):
-- alcanza con usuario activo. Un registro creado hace menos de 10 minutos se puede seguir
-- modificando sin "editar" (el mismo flujo que lo creó lo completa).

-- ---------- Conversión de valores ----------
create or replace function private.lj_num(v jsonb) returns numeric
language plpgsql immutable as $$
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric; end if;
  if jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$' then return trim(v #>> '{}')::numeric; end if;
  return null;
end $$;

create or replace function private.lj_ts(v jsonb) returns timestamptz
language plpgsql immutable as $$
declare s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'number' then return to_timestamp((v #>> '{}')::numeric / 1000.0); end if;
  s := v #>> '{}';
  if s ~ '^\d{11,14}$' then return to_timestamp(s::numeric / 1000.0); end if;
  begin return s::timestamptz; exception when others then return null; end;
end $$;

create or replace function private.lj_date(v jsonb) returns date
language plpgsql immutable as $$
declare s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'number' then return (to_timestamp((v #>> '{}')::numeric / 1000.0) at time zone 'America/Argentina/Buenos_Aires')::date; end if;
  s := v #>> '{}';
  if s ~ '^\d{4}-\d{2}-\d{2}' then begin return substr(s, 1, 10)::date; exception when others then return null; end; end if;
  if s ~ '^\d{11,14}$' then return (to_timestamp(s::numeric / 1000.0) at time zone 'America/Argentina/Buenos_Aires')::date; end if;
  return null;
end $$;

create or replace function private.lj_bool(v jsonb) returns boolean
language sql immutable as $$
  select case when v is null or jsonb_typeof(v) = 'null' then null
              when jsonb_typeof(v) = 'boolean' then (v #>> '{}')::boolean
              when jsonb_typeof(v) = 'string' then lower(v #>> '{}') in ('true', '1', 'si', 'sí')
              when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric <> 0
              else true end
$$;

create or replace function private.lj_txt(v jsonb) returns text
language sql immutable as $$
  select case when v is null or jsonb_typeof(v) = 'null' then null
              when jsonb_typeof(v) = 'string' then nullif(v #>> '{}', '')
              else v #>> '{}' end
$$;

-- Fecha tipo dato a partir del momento "creado" de un raw (para la gracia de 10 minutos).
create or replace function private.lj_recien_creado(v jsonb) returns boolean
language sql stable as $$
  select coalesce(private.lj_ts(v -> 'createdAt') > now() - interval '10 minutes', false)
$$;

-- jsonb_set que crea objetos intermedios.
create or replace function private.lj_jset(doc jsonb, path text[], val jsonb) returns jsonb
language plpgsql immutable as $$
declare
  head text; rest text[]; child jsonb; base jsonb := coalesce(doc, '{}'::jsonb);
begin
  if path is null or array_length(path, 1) is null then return val; end if;
  if jsonb_typeof(base) <> 'object' and jsonb_typeof(base) <> 'array' then base := '{}'::jsonb; end if;
  head := path[1];
  rest := path[2:array_length(path, 1)];
  if jsonb_typeof(base) = 'array' then
    -- RTDB permite tratar arrays como mapas por índice.
    if head ~ '^\d+$' then
      child := base -> head::int;
      if val is null and coalesce(array_length(rest, 1), 0) = 0 then
        return base - head::int;
      end if;
      return jsonb_set(base, array[head], private.lj_jset(child, rest, val), true);
    end if;
    base := '{}'::jsonb;
  end if;
  child := base -> head;
  if coalesce(array_length(rest, 1), 0) = 0 then
    if val is null or jsonb_typeof(val) = 'null' then return base - head; end if;
    return base || jsonb_build_object(head, val);
  end if;
  child := private.lj_jset(child, rest, val);
  if child is null or child = '{}'::jsonb then return base - head; end if;
  return base || jsonb_build_object(head, child);
end $$;

create or replace function private.lj_segs(p text) returns text[]
language sql immutable as $$
  select coalesce(array_remove(string_to_array(trim(both '/' from coalesce(p, '')), '/'), ''), '{}'::text[])
$$;

-- ---------- Permisos ----------
create or replace function private.lj_exigir(p_accion text) returns void
language plpgsql stable as $$
begin
  if not private.es_usuario_activo() then raise exception 'sin_sesion' using errcode = '42501'; end if;
  if p_accion = 'editar' and not private.puede_editar() then raise exception 'sin_permiso_editar' using errcode = '42501'; end if;
  if p_accion = 'borrar' and not private.puede_borrar() then raise exception 'sin_permiso_borrar' using errcode = '42501'; end if;
end $$;

-- Para colecciones de registros: decide qué permiso hace falta al guardar/borrar.
create or replace function private.lj_permiso_registro(p_viejo jsonb, p_nuevo jsonb) returns void
language plpgsql stable as $$
begin
  if p_nuevo is null then
    if p_viejo is not null then perform private.lj_exigir('borrar'); end if;
    return;
  end if;
  if p_viejo is null then perform private.lj_exigir('activo'); return; end if;
  if p_viejo = p_nuevo then perform private.lj_exigir('activo'); return; end if;
  if private.lj_recien_creado(p_viejo) then perform private.lj_exigir('activo'); return; end if;
  perform private.lj_exigir('editar');
end $$;
