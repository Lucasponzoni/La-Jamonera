-- 203 · Inventario: /inventario/items/{id} = registro (raw) + entries[] (lotes, raw) con sus tres
-- historiales (productionUsage, expiryResolutions, movementHistory) desde la tabla movimientos.
-- movimientos.orden = posición en el arreglo original (0 = primero, que en la app es el más reciente).

create or replace function private.lj_lote_json(p_lote text) returns jsonb language sql stable as $$
  select coalesce(l.raw, jsonb_strip_nulls(jsonb_build_object(
           'id', l.id, 'entryDate', l.fecha_ingreso, 'expiryDate', l.vencimiento, 'unit', l.unidad, 'qty', l.cantidad,
           'qtyBase', l.cantidad_base, 'qtyKg', l.cantidad_kg, 'availableQty', l.disponible, 'availableBase', l.disponible_base,
           'availableKg', l.disponible_kg, 'provider', l.proveedor, 'invoiceNumber', l.factura, 'lotNumber', l.lote)))
         || coalesce((select jsonb_object_agg(m.origen::text, m.arr) from (
              select origen, jsonb_agg(datos order by orden) as arr from movimientos where lote_id = l.id group by origen) m), '{}'::jsonb)
  from inventario_lotes l where l.id = p_lote
$$;

create or replace function private.lj_inv_get(p_ing text) returns jsonb language plpgsql stable as $$
declare v_reg jsonb; v_entries jsonb;
begin
  select raw into v_reg from inventario_registros where ingrediente_id = p_ing;
  select jsonb_agg(private.lj_lote_json(l.id) order by l.orden nulls last, l.fecha_ingreso, l.id) into v_entries
    from inventario_lotes l where l.ingrediente_id = p_ing;
  if v_reg is null and v_entries is null then
    if not exists (select 1 from inventario_registros where ingrediente_id = p_ing) then return null; end if;
  end if;
  v_reg := coalesce(v_reg, jsonb_build_object('ingredientId', p_ing));
  if v_entries is not null then v_reg := v_reg || jsonb_build_object('entries', v_entries); end if;
  return v_reg;
end $$;

-- Columnas derivadas de un movimiento (misma regla que el script de carga).
create or replace function private.lj_mov_ins(p_lote text, p_ing text, p_origen mov_origen, p_orden int, m jsonb) returns void language plpgsql as $$
begin
  insert into movimientos (id, lote_id, ingrediente_id, origen, orden, tipo, fecha, fecha_produccion, produccion_id, cantidad, unidad,
    cantidad_base, cantidad_kg, motivo, nota, usuario, automatico, source, run_id, datos)
  values (
    coalesce(private.lj_txt(m->'id'), left(p_origen::text, 2) || '_' || p_lote || '_' || md5(m::text || clock_timestamp()::text || p_orden::text)),
    p_lote, p_ing, p_origen, p_orden, private.lj_txt(m->'type'), private.lj_ts(coalesce(m->'createdAt', m->'producedAt')),
    private.lj_date(m->'productionDate'), coalesce(private.lj_txt(m->'productionId'), private.lj_txt(m->'reference')),
    private.lj_num(coalesce(m->'usedQty', m->'qty')), coalesce(private.lj_txt(m->'usedUnit'), private.lj_txt(m->'unit'), private.lj_txt(m->'qtyUnit')),
    private.lj_num(coalesce(m->'usedBaseQty', m->'qtyBase')), private.lj_num(coalesce(m->'kilosUsed', m->'qtyKg')),
    private.lj_txt(m->'reason'), coalesce(private.lj_txt(m->'note'), private.lj_txt(m->'observation')), private.lj_txt(m->'user'),
    coalesce(private.lj_bool(m->'generatedAutomatically'), false), private.lj_txt(m->'source'), private.lj_txt(m->'runId'), m)
  on conflict (id) do update set lote_id = excluded.lote_id, ingrediente_id = excluded.ingrediente_id, origen = excluded.origen,
    orden = excluded.orden, tipo = excluded.tipo, fecha = excluded.fecha, fecha_produccion = excluded.fecha_produccion,
    produccion_id = excluded.produccion_id, cantidad = excluded.cantidad, unidad = excluded.unidad, cantidad_base = excluded.cantidad_base,
    cantidad_kg = excluded.cantidad_kg, motivo = excluded.motivo, nota = excluded.nota, usuario = excluded.usuario,
    automatico = excluded.automatico, source = excluded.source, run_id = excluded.run_id, datos = excluded.datos;
end $$;

-- Sincroniza un historial de un lote con el arreglo nuevo. Casos rápidos: igual (nada), elementos
-- agregados al principio (unshift: corre el orden e inserta), agregados al final (push). Si no, reemplaza.
create or replace function private.lj_mov_sync(p_lote text, p_ing text, p_origen mov_origen, p_arr jsonb) returns void language plpgsql as $$
declare
  n int := case when jsonb_typeof(p_arr) = 'array' then jsonb_array_length(p_arr) else 0 end;
  m int; v_exist jsonb; v_tail jsonb; v_head jsonb; k int; e jsonb; i int;
begin
  select count(*), coalesce(jsonb_agg(datos order by orden), '[]'::jsonb) into m, v_exist
    from movimientos where lote_id = p_lote and origen = p_origen;
  if n = m and (n = 0 or v_exist = p_arr) then return; end if;
  if n > m then
    k := n - m;
    select coalesce(jsonb_agg(x.v order by x.o), '[]'::jsonb) into v_tail from jsonb_array_elements(p_arr) with ordinality x(v, o) where x.o > k;
    if v_tail = v_exist then
      update movimientos set orden = orden + k where lote_id = p_lote and origen = p_origen;
      i := 0;
      for e in select x.v from jsonb_array_elements(p_arr) with ordinality x(v, o) where x.o <= k order by x.o loop
        perform private.lj_mov_ins(p_lote, p_ing, p_origen, i, e); i := i + 1;
      end loop;
      return;
    end if;
    select coalesce(jsonb_agg(x.v order by x.o), '[]'::jsonb) into v_head from jsonb_array_elements(p_arr) with ordinality x(v, o) where x.o <= m;
    if v_head = v_exist then
      i := m;
      for e in select x.v from jsonb_array_elements(p_arr) with ordinality x(v, o) where x.o > m order by x.o loop
        perform private.lj_mov_ins(p_lote, p_ing, p_origen, i, e); i := i + 1;
      end loop;
      return;
    end if;
  end if;
  delete from movimientos where lote_id = p_lote and origen = p_origen;
  i := 0;
  if n > 0 then
    for e in select x.v from jsonb_array_elements(p_arr) with ordinality x(v, o) order by x.o loop
      perform private.lj_mov_ins(p_lote, p_ing, p_origen, i, e); i := i + 1;
    end loop;
  end if;
end $$;

-- Campos de un lote que cambian por la operación diaria (producir, egresos, resolver vencidos):
-- modificarlos no requiere "editar".
create or replace function private.lj_lote_operativo(r jsonb) returns jsonb language sql immutable as $$
  select coalesce(r, '{}'::jsonb) - array['availableQty', 'availableBase', 'availableKg', 'lotStatus', 'status',
    'expiryResolutionStatus', 'autoEgresoState', 'productionUsage', 'expiryResolutions', 'movementHistory']
$$;

-- Campos derivados del registro (los recalcula la app en cada guardado).
create or replace function private.lj_reg_config(r jsonb) returns jsonb language sql immutable as $$
  select coalesce(r, '{}'::jsonb) - array['entries', 'stockBase', 'stockKg', 'hasEntries', 'entriesCount', 'hasFrozenEntries',
    '__indexLite', 'expiredEntries', 'expiringEntries', 'updatedAt']
$$;

create or replace function private.lj_inv_set(p_ing text, p_val jsonb) returns void language plpgsql as $$
declare
  v_old_reg jsonb; v_exists boolean; e jsonb; i int := 0; v_id text; v_old jsonb; v_new jsonb; v_ids text[] := '{}';
begin
  select raw, true into v_old_reg, v_exists from inventario_registros where ingrediente_id = p_ing;
  if p_val is null or jsonb_typeof(p_val) = 'null' then
    if coalesce(v_exists, false) or exists (select 1 from inventario_lotes where ingrediente_id = p_ing) then
      perform private.lj_exigir('borrar');
      delete from inventario_lotes where ingrediente_id = p_ing;
      delete from inventario_registros where ingrediente_id = p_ing;
    end if;
    return;
  end if;
  perform private.lj_exigir('activo');
  if coalesce(v_exists, false) and private.lj_reg_config(v_old_reg) is distinct from private.lj_reg_config(p_val) then
    perform private.lj_exigir('editar');
  end if;
  -- El ingrediente tiene que existir (FK); si no, se crea mínimo para no perder el registro.
  if not exists (select 1 from ingredientes where id = p_ing) then
    insert into ingredientes (id, nombre, raw) values (p_ing, '(ingrediente sin ficha)', jsonb_build_object('id', p_ing, 'name', '(ingrediente sin ficha)'));
  end if;
  insert into inventario_registros (ingrediente_id, stock_unit, infinite_stock, low_threshold_mode, low_threshold_kg, low_threshold_base,
    package_qty, suggested_expiry_days, expiring_soon_days, default_expiry_date, lot_config, weekly_sheet_config, flag_preferences, raw, updated_at)
  values (p_ing, private.lj_txt(p_val->'stockUnit'), coalesce(private.lj_bool(p_val->'infiniteStock'), false),
    coalesce(private.lj_txt(p_val->'lowThresholdMode'), 'global'), private.lj_num(p_val->'lowThresholdKg'), private.lj_num(p_val->'lowThresholdBase'),
    private.lj_num(p_val->'packageQty'), private.lj_num(p_val->'suggestedExpiryDays')::int, private.lj_num(p_val->'expiringSoonDays')::int,
    private.lj_date(p_val->'defaultExpiryDate'), p_val->'lotConfig', p_val->'weeklySheetConfig', p_val->'flagPreferences', p_val - 'entries', now())
  on conflict (ingrediente_id) do update set stock_unit = excluded.stock_unit, infinite_stock = excluded.infinite_stock,
    low_threshold_mode = excluded.low_threshold_mode, low_threshold_kg = excluded.low_threshold_kg, low_threshold_base = excluded.low_threshold_base,
    package_qty = excluded.package_qty, suggested_expiry_days = excluded.suggested_expiry_days, expiring_soon_days = excluded.expiring_soon_days,
    default_expiry_date = excluded.default_expiry_date, lot_config = excluded.lot_config, weekly_sheet_config = excluded.weekly_sheet_config,
    flag_preferences = excluded.flag_preferences, raw = excluded.raw, updated_at = now();

  if jsonb_typeof(p_val->'entries') in ('array', 'object') then
    for e in select v from (
        select value as v, (case when jsonb_typeof(p_val->'entries') = 'array' then ord::int else ord::int end) as o
        from jsonb_array_elements(case when jsonb_typeof(p_val->'entries') = 'array' then p_val->'entries'
                                       else (select coalesce(jsonb_agg(value), '[]'::jsonb) from jsonb_each(p_val->'entries')) end)
             with ordinality as t(value, ord)) s order by s.o loop
      v_id := private.lj_txt(e->'id');
      if v_id is null then v_id := 'entry_' || md5(e::text); end if;
      v_ids := v_ids || v_id;
      select raw into v_old from inventario_lotes where id = v_id;
      v_new := e - array['productionUsage', 'expiryResolutions', 'movementHistory'];
      if v_old is not null and private.lj_lote_operativo(v_old) is distinct from private.lj_lote_operativo(v_new)
         and not private.lj_recien_creado(v_old) then
        perform private.lj_exigir('editar');
      end if;
      insert into inventario_lotes (id, ingrediente_id, fecha_ingreso, vencimiento, unidad, cantidad, cantidad_base, cantidad_kg, disponible,
        disponible_base, disponible_kg, package_qty, proveedor, factura, remito, lote, lote_personalizado, estado, status, resolucion_estado,
        congelado, congelado_desde, no_perecedero, uso_interno, factura_urls, auto_egreso_state, editado_at, editado_por, orden, raw, created_at)
      values (v_id, p_ing, coalesce(private.lj_date(e->'entryDate'), private.lj_date(e->'createdAt'), current_date), private.lj_date(e->'expiryDate'),
        coalesce(private.lj_txt(e->'unit'), ''), coalesce(private.lj_num(e->'qty'), 0), private.lj_num(e->'qtyBase'), private.lj_num(e->'qtyKg'),
        coalesce(private.lj_num(e->'availableQty'), 0), coalesce(private.lj_num(e->'availableBase'), 0), coalesce(private.lj_num(e->'availableKg'), 0),
        private.lj_num(e->'packageQty'), private.lj_txt(e->'provider'), private.lj_txt(e->'invoiceNumber'), private.lj_txt(e->'remitoNumber'),
        private.lj_txt(e->'lotNumber'), private.lj_bool(e->'customLot'), private.lj_txt(e->'lotStatus'), private.lj_txt(e->'status'),
        private.lj_txt(e->'expiryResolutionStatus'), coalesce(private.lj_bool(e->'isFrozen'), false), private.lj_date(e->'frozenAt'),
        coalesce(private.lj_bool(e->'noPerecedero'), false), coalesce(private.lj_bool(e->'usoInternoEmpresa'), false),
        coalesce((select array_agg(distinct u) from (
           select jsonb_array_elements_text(case when jsonb_typeof(e->'invoiceImageUrls') = 'array' then e->'invoiceImageUrls' else '[]'::jsonb end) u
           union select e->>'invoiceImageUrl') x where u is not null and u <> ''), '{}'),
        e->'autoEgresoState', private.lj_ts(e->'lastEditedAt'), private.lj_txt(e->'lastEditedBy'), i, v_new,
        coalesce(private.lj_ts(e->'createdAt'), now()))
      on conflict (id) do update set ingrediente_id = excluded.ingrediente_id, fecha_ingreso = excluded.fecha_ingreso, vencimiento = excluded.vencimiento,
        unidad = excluded.unidad, cantidad = excluded.cantidad, cantidad_base = excluded.cantidad_base, cantidad_kg = excluded.cantidad_kg,
        disponible = excluded.disponible, disponible_base = excluded.disponible_base, disponible_kg = excluded.disponible_kg,
        package_qty = excluded.package_qty, proveedor = excluded.proveedor, factura = excluded.factura, remito = excluded.remito, lote = excluded.lote,
        lote_personalizado = excluded.lote_personalizado, estado = excluded.estado, status = excluded.status, resolucion_estado = excluded.resolucion_estado,
        congelado = excluded.congelado, congelado_desde = excluded.congelado_desde, no_perecedero = excluded.no_perecedero, uso_interno = excluded.uso_interno,
        factura_urls = excluded.factura_urls, auto_egreso_state = excluded.auto_egreso_state, editado_at = excluded.editado_at,
        editado_por = excluded.editado_por, orden = excluded.orden, raw = excluded.raw;
      perform private.lj_mov_sync(v_id, p_ing, 'productionUsage', e->'productionUsage');
      perform private.lj_mov_sync(v_id, p_ing, 'expiryResolutions', e->'expiryResolutions');
      perform private.lj_mov_sync(v_id, p_ing, 'movementHistory', e->'movementHistory');
      i := i + 1;
    end loop;
  end if;
  -- Lotes que ya no están en el registro: borrarlos requiere "borrar".
  if exists (select 1 from inventario_lotes where ingrediente_id = p_ing and not (id = any(v_ids))) then
    perform private.lj_exigir('borrar');
    delete from inventario_lotes where ingrediente_id = p_ing and not (id = any(v_ids));
  end if;
end $$;
