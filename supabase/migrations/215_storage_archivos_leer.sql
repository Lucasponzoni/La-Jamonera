-- 215 · Sin política SELECT, upsert y borrado de archivos fallan por RLS (necesitan ver la fila existente).
-- El bucket ya es público por URL: esto sólo deja ver metadatos a usuarios activos.
create policy archivos_leer on storage.objects for select to authenticated
  using (bucket_id = 'archivos' and (select private.es_usuario_activo()));
