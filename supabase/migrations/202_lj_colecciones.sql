-- 202 · Guardado por colección: raw = JSON original; columnas derivadas para consultas.

create or replace function private.lj_fk(p_tabla text, p_id text) returns text
language plpgsql stable as $$
declare ok boolean;
begin
  if p_id is null or p_id = '' then return null; end if;
  execute format('select exists (select 1 from public.%I where id = $1)', p_tabla) into ok using p_id;
  return case when ok then p_id else null end;
end $$;

-- ---------- Catálogo ----------
create or replace function private.lj_up_familias(p_id text, r jsonb) returns void language plpgsql as $$
begin
  insert into familias (id, nombre, imagen_url, orden, created_at, updated_at, raw)
  values (p_id, coalesce(private.lj_txt(r->'name'), p_id), private.lj_txt(r->'imageUrl'), private.lj_num(r->'order')::int,
          private.lj_ts(r->'createdAt'), private.lj_ts(r->'updatedAt'), r)
  on conflict (id) do update set nombre = excluded.nombre, imagen_url = excluded.imagen_url, orden = excluded.orden,
    created_at = excluded.created_at, updated_at = excluded.updated_at, raw = excluded.raw;
end $$;

create or replace function private.lj_up_ingredientes(p_id text, r jsonb) returns void language plpgsql as $$
begin
  insert into ingredientes (id, nombre, descripcion, familia_id, medida, imagen_url, created_at, updated_at, raw)
  values (p_id, coalesce(private.lj_txt(r->'name'), '(sin nombre)'), private.lj_txt(r->'description'),
          private.lj_fk('familias', private.lj_txt(r->'familyId')), private.lj_txt(r->'measure'), private.lj_txt(r->'imageUrl'),
          private.lj_ts(r->'createdAt'), private.lj_ts(r->'updatedAt'), r)
  on conflict (id) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, familia_id = excluded.familia_id,
    medida = excluded.medida, imagen_url = excluded.imagen_url, created_at = excluded.created_at, updated_at = excluded.updated_at, raw = excluded.raw;
end $$;

create or replace function private.lj_up_receta_grupos(p_id text, r jsonb) returns void language plpgsql as $$
begin
  insert into receta_grupos (id, nombre, imagen_url, orden, created_at, updated_at, raw)
  values (p_id, coalesce(private.lj_txt(r->'name'), p_id), private.lj_txt(r->'imageUrl'), private.lj_num(r->'order')::int,
          private.lj_ts(r->'createdAt'), private.lj_ts(r->'updatedAt'), r)
  on conflict (id) do update set nombre = excluded.nombre, imagen_url = excluded.imagen_url, orden = excluded.orden,
    created_at = excluded.created_at, updated_at = excluded.updated_at, raw = excluded.raw;
end $$;

create or replace function private.lj_up_recetas(p_id text, r jsonb) returns void language plpgsql as $$
declare f jsonb; i int := 0; fid text;
begin
  insert into recetas (id, titulo, nombre_comercial, descripcion, imagen_url, grupo_id, rinde, rinde_unidad, vida_util_dias,
    estacionado_dias, extension_congelado_dias, congelado_previo, demora_envasado, modo_orden, planilla_version, rnpa,
    rnpa_no_requerido, rnpa_exento, rnpa_exento_motivo, subproducto_sin_rnpa, nutricion, raw, created_at, updated_at)
  values (p_id, coalesce(private.lj_txt(r->'title'), p_id), private.lj_txt(r->'nombreComercial'), private.lj_txt(r->'description'),
    private.lj_txt(r->'imageUrl'), private.lj_fk('receta_grupos', private.lj_txt(r->'recipeGroupId')), private.lj_num(r->'yieldQuantity'),
    private.lj_txt(r->'yieldUnit'), private.lj_num(r->'shelfLifeDays')::int, private.lj_num(r->'agingDays')::int,
    private.lj_num(r->'frozenShelfLifeExtension')::int, private.lj_bool(r->'prePackagingFreeze'), private.lj_txt(r->'packagingDelayType'),
    private.lj_txt(r->'orderMode'), private.lj_num(r->'planillaVersion')::int, r->'rnpa', coalesce(private.lj_bool(r->'rnpaNotRequired'), false),
    coalesce(private.lj_bool(r->'rnpaExempt'), false), private.lj_txt(r->'rnpaExemptReason'), coalesce(private.lj_bool(r->'subproductNoRnpa'), false),
    r->'nutrition', r, private.lj_ts(r->'createdAt'), private.lj_ts(r->'updatedAt'))
  on conflict (id) do update set titulo = excluded.titulo, nombre_comercial = excluded.nombre_comercial, descripcion = excluded.descripcion,
    imagen_url = excluded.imagen_url, grupo_id = excluded.grupo_id, rinde = excluded.rinde, rinde_unidad = excluded.rinde_unidad,
    vida_util_dias = excluded.vida_util_dias, estacionado_dias = excluded.estacionado_dias, extension_congelado_dias = excluded.extension_congelado_dias,
    congelado_previo = excluded.congelado_previo, demora_envasado = excluded.demora_envasado, modo_orden = excluded.modo_orden,
    planilla_version = excluded.planilla_version, rnpa = excluded.rnpa, rnpa_no_requerido = excluded.rnpa_no_requerido,
    rnpa_exento = excluded.rnpa_exento, rnpa_exento_motivo = excluded.rnpa_exento_motivo, subproducto_sin_rnpa = excluded.subproducto_sin_rnpa,
    nutricion = excluded.nutricion, raw = excluded.raw, created_at = excluded.created_at, updated_at = excluded.updated_at;
  delete from receta_filas where receta_id = p_id;
  if jsonb_typeof(r->'rows') = 'array' then
    for f in select * from jsonb_array_elements(r->'rows') loop
      fid := coalesce(private.lj_txt(f->'id'), 'row_' || i);
      insert into receta_filas (receta_id, id, orden, tipo, ingrediente_id, ingrediente_nombre, cantidad, unidad, relacionados, extra)
      values (p_id, fid, i, private.lj_txt(f->'type'), private.lj_fk('ingredientes', private.lj_txt(f->'ingredientId')),
              private.lj_txt(f->'ingredientName'), private.lj_num(f->'quantity'), private.lj_txt(f->'unit'), f->'relatedIngredients', f)
      on conflict (receta_id, id) do nothing;
      i := i + 1;
    end loop;
  end if;
end $$;

-- ---------- Producción ----------
create or replace function private.lj_up_producciones(p_id text, r jsonb) returns void language plpgsql as $$
declare ins jsonb; l jsonb; i int := 0; j int;
begin
  insert into producciones (id, receta_id, receta_titulo, nombre_comercial, raw, fecha_produccion, kg, estado, encargados, observaciones,
    fecha_envasado, vencimiento_producto, vida_util_dias, estacionado_dias, extension_congelado, lote_antiguo, sin_trazabilidad,
    uso_lote_congelado, reserva_id, planilla_version, public_trace_url, trazabilidad, audit_trail, created_at, created_by)
  values (p_id, private.lj_fk('recetas', private.lj_txt(r->'recipeId')), private.lj_txt(r->'recipeTitle'), private.lj_txt(r->'recipeNombreComercial'), r,
    coalesce(private.lj_date(r->'productionDate'), private.lj_date(r->'createdAt'), current_date), coalesce(private.lj_num(r->'quantityKg'), 0),
    private.lj_txt(r->'status'), r->'managers', private.lj_txt(r->'observations'), private.lj_date(r->'packagingDate'),
    private.lj_date(r->'productExpiryDate'), private.lj_num(r->'shelfLifeDaysAtProduction')::int, private.lj_num(r->'agingDaysAtProduction')::int,
    r->'frozenShelfLifeExtensionAtProduction', private.lj_bool(r->'loteAntiguo'), private.lj_bool(r->'sinTrazabilidad'),
    private.lj_bool(r->'usedFrozenLot'), private.lj_txt(r->'reservationId'), private.lj_num(r->'planillaVersion')::int,
    private.lj_txt(r->'publicTraceUrl'), r->'traceability', r->'auditTrail', coalesce(private.lj_ts(r->'createdAt'), now()), private.lj_txt(r->'createdBy'))
  on conflict (id) do update set receta_id = excluded.receta_id, receta_titulo = excluded.receta_titulo, nombre_comercial = excluded.nombre_comercial,
    raw = excluded.raw, fecha_produccion = excluded.fecha_produccion, kg = excluded.kg, estado = excluded.estado, encargados = excluded.encargados,
    observaciones = excluded.observaciones, fecha_envasado = excluded.fecha_envasado, vencimiento_producto = excluded.vencimiento_producto,
    vida_util_dias = excluded.vida_util_dias, estacionado_dias = excluded.estacionado_dias, extension_congelado = excluded.extension_congelado,
    lote_antiguo = excluded.lote_antiguo, sin_trazabilidad = excluded.sin_trazabilidad, uso_lote_congelado = excluded.uso_lote_congelado,
    reserva_id = excluded.reserva_id, planilla_version = excluded.planilla_version, public_trace_url = excluded.public_trace_url,
    trazabilidad = excluded.trazabilidad, audit_trail = excluded.audit_trail, created_at = excluded.created_at, created_by = excluded.created_by;
  delete from produccion_insumos where produccion_id = p_id;
  if jsonb_typeof(r->'lots') = 'array' then
    for ins in select * from jsonb_array_elements(r->'lots') loop
      insert into produccion_insumos (produccion_id, idx, ingrediente_id, ingrediente_nombre, unidad, necesario, disponible, faltante, sustituto,
        ingrediente_origen_id, ingrediente_origen_nombre, etiqueta_sustitucion, sin_trazabilidad, stock_infinito, extra)
      values (p_id, i, private.lj_txt(ins->'ingredientId'), private.lj_txt(ins->'ingredientName'), private.lj_txt(ins->'ingredientUnit'),
        private.lj_num(ins->'neededQty'), private.lj_num(ins->'availableQty'), private.lj_num(ins->'missingQty'), coalesce(private.lj_bool(ins->'isSubstitute'), false),
        private.lj_txt(ins->'sourceIngredientId'), private.lj_txt(ins->'sourceIngredientName'), private.lj_txt(ins->'substitutionLabel'),
        coalesce(private.lj_bool(ins->'noTraceability'), private.lj_bool(ins->'sinTrazabilidad'), false), coalesce(private.lj_bool(ins->'infiniteStock'), false),
        ins - 'lots');
      j := 0;
      if jsonb_typeof(ins->'lots') = 'array' then
        for l in select * from jsonb_array_elements(ins->'lots') loop
          insert into produccion_lotes (produccion_id, insumo_idx, idx, lote_id, ingrediente_id, lote, factura, proveedor, proveedor_rne,
            fecha_ingreso, vencimiento, cantidad, cantidad_base, unidad, congelado, congelado_desde, datos)
          values (p_id, i, j, private.lj_txt(l->'entryId'), private.lj_txt(l->'ingredientId'), private.lj_txt(l->'lotNumber'), private.lj_txt(l->'invoiceNumber'),
            private.lj_txt(l->'provider'), private.lj_txt(l->'providerRne'), private.lj_date(l->'entryDate'), private.lj_date(l->'expiryDate'),
            private.lj_num(l->'takeQty'), private.lj_num(l->'takeBaseQty'), private.lj_txt(l->'unit'), coalesce(private.lj_bool(l->'isFrozen'), false),
            private.lj_date(l->'frozenAt'), l);
          j := j + 1;
        end loop;
      end if;
      i := i + 1;
    end loop;
  end if;
end $$;

create or replace function private.lj_up_produccion_auditoria(p_id text, r jsonb) returns void language plpgsql as $$
begin
  insert into produccion_auditoria (id, produccion_id, accion, motivo, usuario, antes, despues, created_at, raw)
  values (p_id, private.lj_txt(r->'productionId'), private.lj_txt(r->'action'), private.lj_txt(r->'reason'), private.lj_txt(r->'user'),
          r->'before', r->'after', private.lj_ts(r->'createdAt'), r)
  on conflict (id) do update set produccion_id = excluded.produccion_id, accion = excluded.accion, motivo = excluded.motivo,
    usuario = excluded.usuario, antes = excluded.antes, despues = excluded.despues, created_at = excluded.created_at, raw = excluded.raw;
end $$;

create or replace function private.lj_up_produccion_reservas(p_id text, r jsonb) returns void language plpgsql as $$
begin
  insert into produccion_reservas (id, receta_id, estado, locks, expires_at, owner_session_id, owner_label, draft_id, released_at, released_reason, created_at, raw)
  values (p_id, private.lj_txt(r->'recipeId'), private.lj_txt(r->'status'), r->'locks', private.lj_ts(r->'expiresAt'), private.lj_txt(r->'ownerSessionId'),
          private.lj_txt(r->'ownerLabel'), private.lj_txt(r->'draftId'), private.lj_ts(r->'releasedAt'), private.lj_txt(r->'releasedReason'), private.lj_ts(r->'createdAt'), r)
  on conflict (id) do update set receta_id = excluded.receta_id, estado = excluded.estado, locks = excluded.locks, expires_at = excluded.expires_at,
    owner_session_id = excluded.owner_session_id, owner_label = excluded.owner_label, draft_id = excluded.draft_id, released_at = excluded.released_at,
    released_reason = excluded.released_reason, created_at = excluded.created_at, raw = excluded.raw;
end $$;

create or replace function private.lj_up_produccion_borradores(p_id text, r jsonb) returns void language plpgsql as $$
begin
  insert into produccion_borradores (id, datos, updated_at) values (p_id, r, now())
  on conflict (id) do update set datos = excluded.datos, updated_at = now();
end $$;

-- ---------- Reparto ----------
create or replace function private.lj_up_clientes(p_id text, r jsonb) returns void language plpgsql as $$
begin
  insert into clientes (id, nombre, doc, direccion, ciudad, provincia, pais, iniciales, origen, created_at, raw)
  values (p_id, coalesce(private.lj_txt(r->'name'), p_id), private.lj_txt(r->'doc'), private.lj_txt(r->'address'), private.lj_txt(r->'city'),
          private.lj_txt(r->'province'), private.lj_txt(r->'country'), private.lj_txt(r->'initials'), private.lj_txt(r->'source'), private.lj_ts(r->'createdAt'), r)
  on conflict (id) do update set nombre = excluded.nombre, doc = excluded.doc, direccion = excluded.direccion, ciudad = excluded.ciudad,
    provincia = excluded.provincia, pais = excluded.pais, iniciales = excluded.iniciales, origen = excluded.origen, created_at = excluded.created_at, raw = excluded.raw;
end $$;

create or replace function private.lj_up_vehiculos(p_id text, r jsonb) returns void language plpgsql as $$
begin
  insert into vehiculos (id, patente, marca, tipo, numero, vencimiento, adjunto_url, created_at, updated_at, raw)
  values (p_id, private.lj_txt(r->'patent'), private.lj_txt(r->'brand'), private.lj_txt(r->'type'), private.lj_txt(r->'number'),
          private.lj_date(r->'expiryDate'), private.lj_txt(r->'attachmentUrl'), private.lj_ts(r->'createdAt'), private.lj_ts(r->'updatedAt'), r)
  on conflict (id) do update set patente = excluded.patente, marca = excluded.marca, tipo = excluded.tipo, numero = excluded.numero,
    vencimiento = excluded.vencimiento, adjunto_url = excluded.adjunto_url, created_at = excluded.created_at, updated_at = excluded.updated_at, raw = excluded.raw;
end $$;

create or replace function private.lj_up_repartos(p_id text, r jsonb) returns void language plpgsql as $$
declare it jsonb; i int := 0;
begin
  insert into repartos (id, codigo, fecha, cliente_id, cliente_snapshot, vehiculo_id, encargados, perfiles_encargados, importado_xlsx,
    factura_importada, raw, created_at, created_by)
  values (p_id, private.lj_txt(r->'code'), coalesce(private.lj_date(r->'dispatchDate'), private.lj_date(r->'createdAt'), current_date),
    private.lj_fk('clientes', private.lj_txt(r->'clientId')), r->'clientSnapshot', private.lj_fk('vehiculos', private.lj_txt(r->'vehicleId')),
    r->'managers', r->'managerProfiles', coalesce(private.lj_bool(r->'importedFromXlsx'), false), r->'importedInvoice', r,
    private.lj_ts(r->'createdAt'), private.lj_txt(r->'createdBy'))
  on conflict (id) do update set codigo = excluded.codigo, fecha = excluded.fecha, cliente_id = excluded.cliente_id,
    cliente_snapshot = excluded.cliente_snapshot, vehiculo_id = excluded.vehiculo_id, encargados = excluded.encargados,
    perfiles_encargados = excluded.perfiles_encargados, importado_xlsx = excluded.importado_xlsx, factura_importada = excluded.factura_importada,
    raw = excluded.raw, created_at = excluded.created_at, created_by = excluded.created_by;
  delete from reparto_items where reparto_id = p_id;
  if jsonb_typeof(r->'products') = 'array' then
    for it in select * from jsonb_array_elements(r->'products') loop
      insert into reparto_items (reparto_id, idx, receta_id, receta_titulo, receta_imagen_url, cantidad, cantidad_kg, unidad, asignaciones, origen, extra)
      values (p_id, i, private.lj_txt(it->'recipeId'), private.lj_txt(it->'recipeTitle'), private.lj_txt(it->'recipeImageUrl'), private.lj_num(it->'qty'),
              private.lj_num(it->'qtyKg'), private.lj_txt(it->'qtyUnit'), it->'allocations', null, it);
      i := i + 1;
    end loop;
  end if;
end $$;

-- ---------- QR público ----------
create or replace function private.lj_up_public_traces(p_id text, r jsonb) returns void language plpgsql as $$
begin
  insert into public_traces (id, registro, config, version, updated_at, raw)
  values (p_id, coalesce(r->'registro', '{}'::jsonb), r->'config', private.lj_num(r->'version')::int, private.lj_ts(r->'updatedAt'), r)
  on conflict (id) do update set registro = excluded.registro, config = excluded.config, version = excluded.version,
    updated_at = excluded.updated_at, raw = excluded.raw;
end $$;

-- ---------- Informes y análisis (árbol por fecha aaaa/mm/dd) ----------
alter table informes add column if not exists ruta text;
alter table analisis add column if not exists ruta text;
create index if not exists informes_ruta_idx on informes (ruta);
create index if not exists analisis_ruta_idx on analisis (ruta);

create or replace function private.lj_up_informes(p_ruta text, p_id text, r jsonb) returns void language plpgsql as $$
begin
  insert into informes (id, ruta, fecha, titulo, html, importancia, persona_id, autor_nombre, autor_email, autor_puesto, adjuntos, comentarios, raw, created_at, updated_at)
  values (p_id, p_ruta, coalesce(private.lj_date(r->'reportDate'), to_date(p_ruta, 'YYYY/MM/DD'), current_date), private.lj_txt(r->'title'),
    coalesce(r->>'html', ''), private.lj_num(r->'importance')::int, private.lj_fk('personas', private.lj_txt(r->'userId')), private.lj_txt(r->'userName'),
    private.lj_txt(r->'userEmail'), private.lj_txt(r->'userPosition'), r->'attachments', r->'comments', r, private.lj_ts(r->'createdAt'), private.lj_ts(r->'updatedAt'))
  on conflict (id) do update set ruta = excluded.ruta, fecha = excluded.fecha, titulo = excluded.titulo, html = excluded.html, importancia = excluded.importancia,
    persona_id = excluded.persona_id, autor_nombre = excluded.autor_nombre, autor_email = excluded.autor_email, autor_puesto = excluded.autor_puesto,
    adjuntos = excluded.adjuntos, comentarios = excluded.comentarios, raw = excluded.raw, created_at = excluded.created_at, updated_at = excluded.updated_at;
end $$;

create or replace function private.lj_up_analisis(p_ruta text, p_id text, r jsonb) returns void language plpgsql as $$
begin
  insert into analisis (id, ruta, fecha, tipo, etiqueta, muestra, laboratorio, html, importancia, observaciones, adjuntos, autor_email, raw, created_at, updated_at)
  values (p_id, p_ruta, coalesce(private.lj_date(r->'reportDate'), to_date(p_ruta, 'YYYY/MM/DD'), current_date), private.lj_txt(r->'analysisType'),
    private.lj_txt(r->'analysisLabel'), private.lj_txt(r->'sampleId'), private.lj_txt(r->'laboratory'), coalesce(r->>'html', ''),
    private.lj_num(r->'importance')::int, private.lj_txt(r->'observations'), r->'attachments', private.lj_txt(r->'userEmail'), r,
    private.lj_ts(r->'createdAt'), private.lj_ts(r->'updatedAt'))
  on conflict (id) do update set ruta = excluded.ruta, fecha = excluded.fecha, tipo = excluded.tipo, etiqueta = excluded.etiqueta, muestra = excluded.muestra,
    laboratorio = excluded.laboratorio, html = excluded.html, importancia = excluded.importancia, observaciones = excluded.observaciones,
    adjuntos = excluded.adjuntos, autor_email = excluded.autor_email, raw = excluded.raw, created_at = excluded.created_at, updated_at = excluded.updated_at;
end $$;

-- ---------- Personas (/informes/users) — el PIN nunca se guarda ni se devuelve en claro ----------
create or replace function private.lj_up_personas(p_id text, r jsonb) returns void language plpgsql
set search_path = public, extensions as $$
declare v_pin text := private.lj_txt(r->'pin'); v_raw jsonb := r - 'pin' - 'hasPin'; v_hash text;
begin
  select pin_hash into v_hash from personas where id = p_id;
  if v_pin is not null and v_pin ~ '^\d{4}$' and (v_hash is null or v_hash <> crypt(v_pin, v_hash)) then
    v_hash := crypt(v_pin, gen_salt('bf'));
  end if;
  insert into personas (id, nombre, puesto, email, foto_url, telefono, pin_hash, raw, created_at, updated_at)
  values (p_id, coalesce(private.lj_txt(r->'fullName'), p_id), private.lj_txt(r->'position'), private.lj_txt(r->'email'), private.lj_txt(r->'photoUrl'),
          private.lj_txt(r->'phone'), v_hash, v_raw, coalesce(private.lj_ts(r->'createdAt'), now()), coalesce(private.lj_ts(r->'updatedAt'), now()))
  on conflict (id) do update set nombre = excluded.nombre, puesto = excluded.puesto, email = excluded.email, foto_url = excluded.foto_url,
    telefono = excluded.telefono, pin_hash = excluded.pin_hash, raw = excluded.raw, updated_at = excluded.updated_at;
end $$;
