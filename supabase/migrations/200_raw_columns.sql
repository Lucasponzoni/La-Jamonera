-- 200 · Columna raw (JSON original de Firebase) en todas las colecciones que la app lee y escribe enteras.
alter table familias add column if not exists raw jsonb;
alter table ingredientes add column if not exists raw jsonb;
alter table proveedores add column if not exists raw jsonb;
alter table inventario_registros add column if not exists raw jsonb;
alter table inventario_lotes add column if not exists raw jsonb;
alter table receta_grupos add column if not exists raw jsonb;
alter table produccion_auditoria add column if not exists raw jsonb;
alter table produccion_reservas add column if not exists raw jsonb;
alter table clientes add column if not exists raw jsonb;
alter table vehiculos add column if not exists raw jsonb;
alter table personas add column if not exists raw jsonb;
alter table public_traces add column if not exists raw jsonb;
grant select (raw) on personas to authenticated;
grant insert (raw) on personas to authenticated;
grant update (raw) on personas to authenticated;
alter role authenticated set statement_timeout = '60s';
