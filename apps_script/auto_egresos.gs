/**
 * Auto-egresos "Venta en mostrador" para La Jamonera
 *
 * Corrección principal:
 * - El descuento ahora se hace en BASE exacta (g/ml/u) y luego se sincroniza
 *   availableQty/availableBase/availableKg sin proporcionalidad aproximada.
 * - Soporta correctamente kilos, gramos, litros, ml, unidades y paquetes.
 */

const CFG = {
  INVENTARIO_PATH: '/inventario',
  HOLIDAYS_API: 'https://api.argentinadatos.com/v1/feriados/',
  TIMEZONE: PropertiesService.getScriptProperties().getProperty('TZ') || 'America/Argentina/Buenos_Aires',
  WORKER_BASE_URL: PropertiesService.getScriptProperties().getProperty('WORKER_BASE_URL') || '',
  OPEN_WINDOWS: [
    { from: '08:30', to: '13:00' },
    { from: '16:30', to: '19:30' }
  ],
  HOLIDAY_TYPES_EXCLUDED: new Set(['inamovible', 'puente']),
  EPS: 0.0001,
  // Si querés forzar que sólo se ejecute dentro de horario comercial, poner true.
  STRICT_RUN_WINDOW: false,
  // Cantidad máxima de movimientos por día para un lote.
  MAX_DAILY_SPLITS: Number(PropertiesService.getScriptProperties().getProperty('AUTO_EGRESOS_MAX_DAILY_SPLITS') || 8),
  MIN_WEIGHT_VOL_MOVE_QTY: 0.25,
  MIN_UNIT_MOVE_QTY: 1,
  MAX_WEIGHT_VOL_MOVE_QTY: Number(PropertiesService.getScriptProperties().getProperty('AUTO_EGRESOS_MAX_WEIGHT_VOL_MOVE_QTY') || 3),
  MAX_UNIT_MOVE_QTY: Number(PropertiesService.getScriptProperties().getProperty('AUTO_EGRESOS_MAX_UNIT_MOVE_QTY') || 4),
  MAX_PACKAGE_MOVE_QTY: Number(PropertiesService.getScriptProperties().getProperty('AUTO_EGRESOS_MAX_PACKAGE_MOVE_QTY') || 3),
  MAX_UNIT_DAY_QTY: Number(PropertiesService.getScriptProperties().getProperty('AUTO_EGRESOS_MAX_UNIT_DAY_QTY') || 12),
  MAX_PACKAGE_DAY_QTY: Number(PropertiesService.getScriptProperties().getProperty('AUTO_EGRESOS_MAX_PACKAGE_DAY_QTY') || 8),
  MAX_WEIGHT_VOL_DAY_QTY: Number(PropertiesService.getScriptProperties().getProperty('AUTO_EGRESOS_MAX_WEIGHT_VOL_DAY_QTY') || 10),
  DEEPSEEK_MODEL_FALLBACK: PropertiesService.getScriptProperties().getProperty('DEEPSEEK_MODEL') || 'deepseek-chat',
  DEEPSEEK_ENABLED: String(PropertiesService.getScriptProperties().getProperty('DEEPSEEK_ENABLED') || 'true').toLowerCase() !== 'false',
  DEEPSEEK_MAX_BATCH_ITEMS: Number(PropertiesService.getScriptProperties().getProperty('DEEPSEEK_MAX_BATCH_ITEMS') || 20),
  MAX_RUN_MILLIS: Number(PropertiesService.getScriptProperties().getProperty('AUTO_EGRESOS_MAX_RUN_MILLIS') || 330000),
  MAX_PRODUCTS_PER_RUN: Number(PropertiesService.getScriptProperties().getProperty('AUTO_EGRESOS_MAX_PRODUCTS_PER_RUN') || 60),
  RUN_CURSOR_KEY: 'AUTO_EGRESOS_CURSOR',
  AUTO_EGRESOS_DEFAULTS: {
    AUTO_EGRESOS_MAX_DAILY_SPLITS: '8',
    AUTO_EGRESOS_MAX_UNIT_MOVE_QTY: '4',
    AUTO_EGRESOS_MAX_PACKAGE_MOVE_QTY: '3',
    AUTO_EGRESOS_MAX_WEIGHT_VOL_MOVE_QTY: '3',
    AUTO_EGRESOS_MAX_UNIT_DAY_QTY: '12',
    AUTO_EGRESOS_MAX_PACKAGE_DAY_QTY: '8',
    AUTO_EGRESOS_MAX_WEIGHT_VOL_DAY_QTY: '10',
    AUTO_EGRESOS_MAX_RUN_MILLIS: '330000',
    AUTO_EGRESOS_MAX_PRODUCTS_PER_RUN: '60',
    DEEPSEEK_MAX_BATCH_ITEMS: '20'
  }
};

const RUNTIME = {
  deepseek: null
};

function runAutoEgresos() {
  if (!CFG.WORKER_BASE_URL) throw new Error('Falta Script Property WORKER_BASE_URL');

  const runStartedAt = Date.now();
  const now = new Date();
  if (CFG.STRICT_RUN_WINDOW && !isWithinOpenWindows(now, CFG.TIMEZONE, CFG.OPEN_WINDOWS)) {
    logInfo('⏰ Fuera de horario comercial. No se ejecuta.');
    return;
  }

  const runId = `run_${Date.now()}`;
  logInfo(`🚀 Inicio run ${runId}`);
  const inventario = workerRead(CFG.INVENTARIO_PATH) || {};
  const items = safeObj(inventario.items);
  const ingredientes = safeObj(workerRead('/ingredientes/items') || {});
  const todayIso = dateToIso(now, CFG.TIMEZONE);

  const allIngredientIds = Object.keys(items);
  if (!allIngredientIds.length) {
    clearRunCursor_();
    logInfo(`✅ Auto-egresos OK sin items | runId=${runId}`);
    return;
  }

  let affectedProducts = 0;
  let generatedMovements = 0;

  const resumeCursor = getRunCursor_();
  const startIndex = resolveStartIndex_(allIngredientIds, resumeCursor);
  const maxProducts = Math.max(1, Number(CFG.MAX_PRODUCTS_PER_RUN || 60));
  const selectedIds = allIngredientIds.slice(startIndex, startIndex + maxProducts);
  const hasMoreByCap = (startIndex + selectedIds.length) < allIngredientIds.length;
  if (!selectedIds.length) {
    clearRunCursor_();
    logInfo(`✅ Auto-egresos OK | sin productos pendientes | runId=${runId}`);
    return;
  }

  const scopedItems = {};
  selectedIds.forEach((ingredientId) => { scopedItems[ingredientId] = items[ingredientId]; });

  const yearsNeeded = collectYearsToFetch(scopedItems, todayIso);
  const holidaySet = fetchHolidaySet(yearsNeeded);
  const aiPlansByEntryId = buildAiBatchPlans({ items: scopedItems, ingredientes, todayIso, holidaySet, runId });

  let timedOut = false;
  for (let i = 0; i < selectedIds.length; i += 1) {
    const ingredientId = selectedIds[i];
    if (Date.now() - runStartedAt >= CFG.MAX_RUN_MILLIS) {
      timedOut = true;
      setRunCursor_(ingredientId);
      logWarn(`⏱️ Corte por tiempo de ejecución. Continúa en próxima corrida desde ${ingredientId}.`);
      break;
    }

    const record = items[ingredientId];
    if (!record || !Array.isArray(record.entries) || !record.entries.length) continue;

    const weeklyCfg = withDefaultWeeklyConfig(record.weeklySheetConfig);
    if (!weeklyCfg.egresoEnabled) continue;

    let changedRecord = false;
    const ingredientInfo = safeObj(ingredientes[ingredientId]);
    const ingredientName = String(ingredientInfo.name || ingredientId);
    const ingredientDesc = String(ingredientInfo.description || 'Sin descripción');
    const entries = Array.isArray(record.entries) ? record.entries : [];

    for (let j = 0; j < entries.length; j += 1) {
      const entry = entries[j];
      try {
        const normalized = normalizeLegacyAutoEgresoEntry(entry);
        if (normalized.changed) {
          changedRecord = true;
          logInfo(`🧹 Normalizado legado auto-egreso en lote ${entry.id || '-'} (${ingredientId})`);
        }

        const result = processEntryAutoEgreso({
          ingredientId,
          ingredient: ingredientInfo,
          record,
          entry: normalized.entry,
          weeklyCfg,
          todayIso,
          holidaySet,
          runId,
          aiPlanByDay: safeObj(aiPlansByEntryId[normalizeText(normalized.entry.id)])
        });
        entries[j] = result.entry;

        if (result.changed) {
          logInfo(`🧾 ${ingredientName} | ${ingredientDesc} | lote ${normalized.entry.id || '-'} | +${result.movementsCreated} mov.`);
          changedRecord = true;
          generatedMovements += result.movementsCreated;
        }
      } catch (error) {
        logError(`❌ Error procesando lote ${entry?.id || '-'} de ${ingredientId}: ${error.message}`);
      }
    }

    record.entries = entries;
    if (changedRecord) {
      recalcRecordStock(record);
      workerWrite(`/inventario/items/${ingredientId}`, record);
      logInfo(`📦 Producto ${ingredientId} actualizado | stockBase=${record.stockBase} | stockKg=${record.stockKg}`);
      affectedProducts += 1;
    }

    const nextId = selectedIds[i + 1] || '';
    if (nextId) {
      setRunCursor_(nextId);
    } else if (hasMoreByCap) {
      setRunCursor_(allIngredientIds[startIndex + selectedIds.length] || '');
    }
  }

  if (!timedOut) {
    if (hasMoreByCap) {
      setRunCursor_(allIngredientIds[startIndex + selectedIds.length] || '');
      logInfo(`⏭️ Quedaron productos pendientes por límite de corrida. Sigue desde ${allIngredientIds[startIndex + selectedIds.length] || '-'}.`);
    } else {
      clearRunCursor_();
    }
  }

  logInfo(`✅ Auto-egresos OK | productos=${affectedProducts} | movimientos=${generatedMovements} | runId=${runId} | cursor=${getRunCursor_() || '-'}`);
}


function normalizeLegacyAutoEgresoEntry(entry) {
  const next = safeObj(entry);
  let changed = false;
  next.expiryResolutions = Array.isArray(next.expiryResolutions) ? next.expiryResolutions : [];
  next.expiryResolutions = next.expiryResolutions.map((res) => {
    const isAuto = Boolean(res?.generatedAutomatically) || normalizeText(res?.source) === 'apps_script_auto_egreso';
    if (!isAuto) return res;
    if (normalizeText(res?.type) === 'sold_counter') {
      changed = true;
      return { ...res, type: 'auto_sold_local' };
    }
    return res;
  });
  const status = normalizeText(next.expiryResolutionStatus || next.status);
  if (status === 'sold_counter') {
    const hasAuto = next.expiryResolutions.some((res) => Boolean(res?.generatedAutomatically) || normalizeText(res?.source) === 'apps_script_auto_egreso' || normalizeText(res?.type) === 'auto_sold_local');
    if (hasAuto) {
      if (Object.prototype.hasOwnProperty.call(next, 'expiryResolutionStatus')) {
        delete next.expiryResolutionStatus;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(next, 'status')) {
        delete next.status;
        changed = true;
      }
    }
  }
  return { changed, entry: next };
}

function processEntryAutoEgreso(ctx) {
  const { ingredientId, ingredient, record, entry, weeklyCfg, todayIso, holidaySet, runId, aiPlanByDay = null } = ctx;
  const out = { changed: false, movementsCreated: 0, entry };

  const unitMeta = getUnitMeta(entry.unit);
  let availableBase = getAvailableBase(entry, unitMeta);
  if (availableBase <= CFG.EPS) return out;

  const window = getEntryProcessingWindow(entry, weeklyCfg, todayIso, holidaySet);
  if (!window) return out;
  const { fromIso, toIso, processDays, limitIso } = window;

  let businessDaysLeft = listBusinessDays(fromIso, limitIso, holidaySet).length;
  if (businessDaysLeft <= 0) businessDaysLeft = 1;

  processDays.forEach((dayIso) => {
    availableBase = getAvailableBase(entry, unitMeta);
    if (availableBase <= CFG.EPS) return;

    const aiSplits = Array.isArray(aiPlanByDay?.[dayIso]) ? aiPlanByDay[dayIso] : [];
    let splits = [];
    if (aiSplits.length) {
      const aiDayBase = aiSplits
        .map((item) => Number(item || 0))
        .filter((item) => item > CFG.EPS)
        .reduce((acc, item) => acc + roundBaseReasonable(item, unitMeta), 0);
      const isLastLimitDay = dayIso === limitIso;
      const fairDayBase = roundBaseReasonable(availableBase / businessDaysLeft, unitMeta);
      const hardDayLimitBase = getHardDailyLimitBase_(unitMeta);
      const aiDayLimitBase = Math.max(hardDayLimitBase, roundBaseReasonable(fairDayBase * 1.35, unitMeta));
      const cappedAiDayBase = isLastLimitDay
        ? availableBase
        : Math.min(availableBase, Math.max(0, Math.min(aiDayBase, aiDayLimitBase)));
      splits = splitBaseQuantity(cappedAiDayBase, unitMeta);
      logInfo(`🤖 ${String(ingredient?.name || ingredientId)} ${dayIso} baseAI=${Number(cappedAiDayBase.toFixed(3))}${isLastLimitDay ? ' (bypass tope diario por vencimiento/limite)' : ''} movimientos=${splits.length}`);
    }

    if (!splits.length) {
      const isLastLimitDay = dayIso === limitIso;
      const baseTarget = availableBase / businessDaysLeft;
      const factor = randBetween(0.85, 1.15);
      let dayBase = isLastLimitDay ? availableBase : (baseTarget * factor);
      dayBase = roundBaseReasonable(dayBase, unitMeta);

      if (dayBase <= 0) {
        businessDaysLeft = Math.max(1, businessDaysLeft - 1);
        return;
      }
      if (dayBase > availableBase) dayBase = availableBase;
      splits = splitBaseQuantity(dayBase, unitMeta);
    }

    splits.forEach((partBase) => {
      if (partBase <= 0) return;

      const before = getAvailableBase(entry, unitMeta);
      if (before <= CFG.EPS) return;

      const appliedBase = applyDiscountBaseToEntry(entry, partBase, unitMeta);
      if (appliedBase <= CFG.EPS) return;

      const atTs = randomTimestampInBusinessWindows(dayIso, CFG.TIMEZONE, CFG.OPEN_WINDOWS);
      const qtyUnit = fromBase(appliedBase, unitMeta);

      pushAutoEgresoMovement(entry, {
        atTs,
        qtyUnit,
        qtyBase: appliedBase,
        unitMeta,
        unitLabel: String(entry.unit || ''),
        runId
      });

      out.movementsCreated += 1;
      out.changed = true;
    });

    // Remanente final en la fecha límite (regla dura)
    availableBase = getAvailableBase(entry, unitMeta);
    if (dayIso === limitIso && availableBase > CFG.EPS) {
      const finalBase = roundBaseReasonable(availableBase, unitMeta);
      if (finalBase > 0) {
        const appliedBase = applyDiscountBaseToEntry(entry, finalBase, unitMeta);
        if (appliedBase > CFG.EPS) {
          const atTs = randomTimestampInBusinessWindows(dayIso, CFG.TIMEZONE, CFG.OPEN_WINDOWS);
          const qtyUnit = fromBase(appliedBase, unitMeta);
          pushAutoEgresoMovement(entry, {
            atTs,
            qtyUnit,
            qtyBase: appliedBase,
            unitMeta,
            unitLabel: String(entry.unit || ''),
            runId
          });
          out.movementsCreated += 1;
          out.changed = true;
        }
      }
    }

    businessDaysLeft = Math.max(1, businessDaysLeft - 1);
  });

  if (num(entry.availableQty) <= CFG.EPS) {
    entry.availableQty = 0;
    entry.availableBase = 0;
    entry.availableKg = 0;
    entry.lotStatus = 'consumido_en_produccion';
  } else {
    entry.lotStatus = 'disponible';
  }

  entry.autoEgresoState = safeObj(entry.autoEgresoState);
  entry.autoEgresoState.lastProcessedDate = toIso;
  entry.autoEgresoState.lastRunAt = Date.now();
  entry.autoEgresoState.lastRunId = runId;

  return out;
}

function pushAutoEgresoMovement(entry, meta) {
  const { atTs, qtyUnit, qtyBase, unitMeta, unitLabel, runId } = meta;

  const roundedQty = roundQtyForUnit(qtyUnit, unitMeta);
  const roundedBase = Number(qtyBase.toFixed(6));
  const roundedKg = baseToKg(qtyBase, unitMeta);

  entry.expiryResolutions = Array.isArray(entry.expiryResolutions) ? entry.expiryResolutions : [];
  entry.expiryResolutions.unshift({
    id: `auto_res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: atTs,
    type: 'auto_sold_local',
    qtyKg: roundedKg,
    qty: roundedQty,
    unit: unitLabel,
    reason: 'Venta en mostrador',
    generatedAutomatically: true,
    source: 'apps_script_auto_egreso',
    runId
  });

  // Filas de trazabilidad en front (usa productionUsage para múltiples filas)
  entry.productionUsage = Array.isArray(entry.productionUsage) ? entry.productionUsage : [];
  entry.productionUsage.unshift({
    id: `usage_auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: atTs,
    producedAt: atTs,
    productionDate: dateToIso(new Date(atTs), CFG.TIMEZONE),
    expiryDateAtProduction: 'Venta en mostrador',
    kilosUsed: roundedKg,
    usedQty: roundedQty,
    usedUnit: unitLabel,
    usedBaseQty: roundedBase,
    lotNumber: String(entry.lotNumber || entry.invoiceNumber || entry.id || '-'),
    ingredientLot: String(entry.lotNumber || entry.invoiceNumber || entry.id || '-'),
    productionId: `AUTO-EGRESO-${runId}`,
    internalUse: true,
    generatedAutomatically: true,
    source: 'apps_script_auto_egreso',
    note: 'Auto egreso · Venta en mostrador'
  });

  // Historial técnico (útil para auditoría y debugging)
  entry.movementHistory = Array.isArray(entry.movementHistory) ? entry.movementHistory : [];
  entry.movementHistory.unshift({
    createdAt: atTs,
    type: 'egreso_automatico',
    reason: 'Venta en mostrador',
    qty: roundedQty,
    qtyBase: roundedBase,
    qtyKg: roundedKg,
    qtyUnit: unitLabel,
    generatedAutomatically: true,
    source: 'apps_script_auto_egreso',
    reference: runId
  });
}

function resolveStartIndex_(ingredientIds, cursorId) {
  if (!cursorId) return 0;
  const idx = ingredientIds.indexOf(String(cursorId));
  return idx >= 0 ? idx : 0;
}

function getRunCursor_() {
  return String(PropertiesService.getScriptProperties().getProperty(CFG.RUN_CURSOR_KEY) || '').trim();
}

function setRunCursor_(ingredientId) {
  const value = String(ingredientId || '').trim();
  if (!value) {
    clearRunCursor_();
    return;
  }
  PropertiesService.getScriptProperties().setProperty(CFG.RUN_CURSOR_KEY, value);
}

function clearRunCursor_() {
  PropertiesService.getScriptProperties().deleteProperty(CFG.RUN_CURSOR_KEY);
}

function installAutoEgresoPropertiesDefaults(forceOverwrite) {
  const props = PropertiesService.getScriptProperties();
  const defaults = safeObj(CFG.AUTO_EGRESOS_DEFAULTS);
  const overwrite = Boolean(forceOverwrite);
  Object.keys(defaults).forEach((key) => {
    const value = String(defaults[key]);
    const current = props.getProperty(key);
    if (overwrite || current === null || String(current).trim() === '') {
      props.setProperty(key, value);
    }
  });
  Logger.log(`Propiedades auto-egreso ${overwrite ? 'actualizadas' : 'verificadas'}: ${Object.keys(defaults).join(', ')}`);
}

function installAutoEgresoRuntimeSetup() {
  installAutoEgresoPropertiesDefaults(false);
  installAutoEgresoTriggerHourly();
}

function installAutoEgresoTriggerHourly() {
  deleteTriggers_('runAutoEgresos');
  ScriptApp.newTrigger('runAutoEgresos').timeBased().everyHours(1).create();
  Logger.log('Trigger instalado: runAutoEgresos cada 1 hora.');
}

function deleteTriggers_(funcName) {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t);
  });
}

function workerRead(path) {
  const base = workerBaseUrl_();
  const url = `${base}/rtdb/read?path=${encodeURIComponent(path || '')}`;
  const resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(`workerRead ${code}: ${resp.getContentText()}`);
  const txt = resp.getContentText();
  return txt ? JSON.parse(txt) : null;
}

function workerWrite(path, value) {
  const base = workerBaseUrl_();
  const url = `${base}/rtdb/write`;
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ path, value }),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(`workerWrite ${code}: ${resp.getContentText()}`);
  const txt = resp.getContentText();
  return txt ? JSON.parse(txt) : null;
}

function workerBaseUrl_() {
  const base = CFG.WORKER_BASE_URL;
  return String(base).replace(/\/+$/, '');
}

function fetchHolidaySet(years) {
  const set = new Set();
  years.forEach((year) => {
    const url = `${CFG.HOLIDAYS_API}${year}/`;
    try {
      const resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
      if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) return;
      const arr = JSON.parse(resp.getContentText() || '[]');
      arr.forEach((h) => {
        const tipo = String(h.tipo || '').toLowerCase().trim();
        if (CFG.HOLIDAY_TYPES_EXCLUDED.has(tipo)) {
          const iso = normalizeIso(h.fecha);
          if (iso) set.add(iso);
        }
      });
    } catch (e) {
      logWarn(`📅 No se pudo leer feriados ${year}: ${e.message}`);
    }
  });
  return set;
}

function collectYearsToFetch(items, todayIso) {
  const y = Number(String(todayIso || '').slice(0, 4));
  const years = new Set([y, y + 1]);
  Object.values(items || {}).forEach((record) => {
    (record.entries || []).forEach((e) => {
      const y1 = normalizeIso(e.entryDate);
      const y2 = normalizeIso(e.expiryDate);
      if (y1) years.add(Number(y1.slice(0, 4)));
      if (y2) years.add(Number(y2.slice(0, 4)));
    });
  });
  return [...years].filter((n) => Number.isFinite(n));
}

function isBusinessDay(iso, holidaySet) {
  const d = isoToDate(iso);
  const dow = Number(Utilities.formatDate(d, CFG.TIMEZONE, 'u')); // 1..7 (lun..dom)
  if (dow === 7) return false;
  if (holidaySet.has(iso)) return false;
  return true;
}

function listBusinessDays(fromIso, toIso, holidaySet) {
  if (!fromIso || !toIso || fromIso > toIso) return [];
  const out = [];
  let cur = fromIso;
  while (cur <= toIso) {
    if (isBusinessDay(cur, holidaySet)) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function addBusinessDaysInclusive(startIso, nDays, holidaySet) {
  let cur = startIso;
  if (nDays <= 0) return cur;
  let count = 0;
  while (true) {
    if (isBusinessDay(cur, holidaySet)) count += 1;
    if (count >= nDays) return cur;
    cur = addDays(cur, 1);
  }
}

function nextBusinessDay(iso, holidaySet) {
  let cur = iso;
  while (!isBusinessDay(cur, holidaySet)) cur = addDays(cur, 1);
  return cur;
}

function isWithinOpenWindows(dateObj, tz, windows) {
  const hhmm = Utilities.formatDate(dateObj, tz, 'HH:mm');
  return windows.some((w) => hhmm >= w.from && hhmm <= w.to);
}

function randomTimestampInBusinessWindows(dayIso, tz, windows) {
  const pick = windows[Math.floor(Math.random() * windows.length)];
  const fromMin = hhmmToMinutes(pick.from);
  const toMin = hhmmToMinutes(pick.to);
  const min = Math.floor(randBetween(fromMin, toMin + 1));
  const hh = String(Math.floor(min / 60)).padStart(2, '0');
  const mm = String(min % 60).padStart(2, '0');

  const isoDate = normalizeIso(dayIso);
  const scriptTz = Session.getScriptTimeZone();
  const tzOffset = Utilities.formatDate(isoToDate(isoDate), tz, 'XXX');
  // Construye timestamp con offset explícito (evita desfasajes por TZ del script)
  const d = new Date(`${isoDate}T${hh}:${mm}:00${tzOffset}`);

  // fallback por si alguna combinación de runtime parsea raro
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date(`${isoDate}T${hh}:${mm}:00`);
    return new Date(Utilities.formatDate(fallback, scriptTz, "yyyy/MM/dd HH:mm:ss")).getTime();
  }
  return d.getTime();
}

function getUnitMeta(unitRaw) {
  const u = String(unitRaw || '').toLowerCase().trim();
  const mass = { kg:1000, kilo:1000, kilos:1000, g:1, gr:1, gramo:1, gramos:1, mg:0.001, oz:28.3495 };
  const vol = { l:1000, lt:1000, litro:1000, litros:1000, ml:1, cc:1 };
  if (mass[u]) return { category: 'peso', factor: mass[u] };      // base: gramos
  if (vol[u]) return { category: 'volumen', factor: vol[u] };      // base: ml
  if (['u','un','unidad','unidades'].includes(u)) return { category: 'unidad', factor: 1 };
  if (['pack','paquete','paquetes'].includes(u)) return { category: 'paquete', factor: 1 };
  return { category: 'otro', factor: 1 };
}

function toBase(qty, unitMeta) {
  return num(qty) * num(unitMeta.factor || 1);
}

function fromBase(base, unitMeta) {
  const f = num(unitMeta.factor || 1);
  return f > 0 ? (num(base) / f) : 0;
}

function getAvailableBase(entry, unitMeta) {
  const byBase = Number(entry.availableBase);
  if (Number.isFinite(byBase) && byBase >= 0) return byBase;
  return toBase(num(entry.availableQty), unitMeta);
}

function roundQtyForUnit(qty, unitMeta) {
  const q = Math.max(0, num(qty));
  if (unitMeta.category === 'unidad' || unitMeta.category === 'paquete') {
    return Math.max(0, Math.round(q));
  }
  return Number(q.toFixed(3));
}

function roundBaseReasonable(baseQty, unitMeta) {
  const q = fromBase(baseQty, unitMeta);
  const roundedQty = roundQtyForUnit(q, unitMeta);
  return Number(toBase(roundedQty, unitMeta).toFixed(6));
}

function getHardDailyLimitBase_(unitMeta) {
  if (unitMeta.category === 'unidad') {
    return roundBaseReasonable(toBase(Math.max(CFG.MIN_UNIT_MOVE_QTY, num(CFG.MAX_UNIT_DAY_QTY || 12)), unitMeta), unitMeta);
  }
  if (unitMeta.category === 'paquete') {
    return roundBaseReasonable(toBase(Math.max(CFG.MIN_UNIT_MOVE_QTY, num(CFG.MAX_PACKAGE_DAY_QTY || 8)), unitMeta), unitMeta);
  }
  return roundBaseReasonable(toBase(Math.max(CFG.MIN_WEIGHT_VOL_MOVE_QTY, num(CFG.MAX_WEIGHT_VOL_DAY_QTY || 10)), unitMeta), unitMeta);
}

function splitBaseQuantity(dayBase, unitMeta) {
  if (dayBase <= 0) return [];

  const maxDailySplits = Math.max(1, Math.floor(num(CFG.MAX_DAILY_SPLITS || 8)));

  // unidades/paquetes: movimientos chicos y realistas
  if (unitMeta.category === 'unidad' || unitMeta.category === 'paquete') {
    const maxMoveQty = unitMeta.category === 'paquete'
      ? Math.max(1, Math.floor(num(CFG.MAX_PACKAGE_MOVE_QTY || 3)))
      : Math.max(1, Math.floor(num(CFG.MAX_UNIT_MOVE_QTY || 4)));

    let qtyLeft = Math.max(0, Math.round(fromBase(dayBase, unitMeta)));
    if (qtyLeft <= 0) return [];

    const out = [];
    let guard = 0;
    while (qtyLeft > 0 && guard < 2000) {
      guard += 1;
      const remainingSlots = Math.max(1, maxDailySplits - out.length);
      const minNeededForRest = Math.max(0, qtyLeft - (remainingSlots * maxMoveQty));
      const minThis = Math.max(1, minNeededForRest);
      const maxThis = Math.max(minThis, Math.min(maxMoveQty, qtyLeft));
      const thisQty = out.length >= maxDailySplits - 1
        ? Math.min(maxMoveQty, qtyLeft)
        : Math.floor(randBetween(minThis, maxThis + 1));
      out.push(toBase(thisQty, unitMeta));
      qtyLeft -= thisQty;
    }
    return out.filter((v) => v > 0);
  }

  // peso/volumen: evita tickets enormes por movimiento
  const maxMoveQty = Math.max(CFG.MIN_WEIGHT_VOL_MOVE_QTY, num(CFG.MAX_WEIGHT_VOL_MOVE_QTY || 3));
  let qtyLeft = Math.max(0, fromBase(dayBase, unitMeta));
  if (qtyLeft <= CFG.EPS) return [];

  const out = [];
  let guard = 0;
  while (qtyLeft > CFG.EPS && guard < 2000) {
    guard += 1;
    const qtyChunk = Math.min(maxMoveQty, qtyLeft);
    const minChunk = Math.min(qtyChunk, CFG.MIN_WEIGHT_VOL_MOVE_QTY);
    const picked = out.length >= maxDailySplits - 1 ? qtyChunk : randBetween(minChunk, qtyChunk);
    const rounded = roundBaseReasonable(toBase(picked, unitMeta), unitMeta);
    if (rounded <= CFG.EPS) break;
    out.push(rounded);
    qtyLeft = Math.max(0, qtyLeft - fromBase(rounded, unitMeta));
  }

  const sum = out.reduce((a, b) => a + b, 0);
  const diff = roundBaseReasonable(dayBase - sum, unitMeta);
  if (Math.abs(diff) > CFG.EPS && out.length) {
    out[out.length - 1] = roundBaseReasonable(out[out.length - 1] + diff, unitMeta);
  }

  return out.filter((v) => v > 0 && fromBase(v, unitMeta) >= CFG.MIN_WEIGHT_VOL_MOVE_QTY - CFG.EPS);
}

function applyDiscountBaseToEntry(entry, baseOutRaw, unitMeta) {
  const prevBase = getAvailableBase(entry, unitMeta);
  if (prevBase <= CFG.EPS) return 0;

  const baseOut = Math.max(0, Math.min(prevBase, num(baseOutRaw)));
  if (baseOut <= CFG.EPS) return 0;

  const nextBase = Number(Math.max(0, prevBase - baseOut).toFixed(6));
  entry.availableBase = nextBase;

  const nextQty = roundQtyForUnit(fromBase(nextBase, unitMeta), unitMeta);
  entry.availableQty = nextQty;

  if (unitMeta.category === 'peso') {
    entry.availableKg = Number((nextBase / 1000).toFixed(4));
  } else if (typeof entry.availableKg === 'number') {
    // para unidades/volumen mantenemos consistencia sin inventar conversión a kg
    entry.availableKg = Number(Math.max(0, num(entry.availableKg) - baseToKg(baseOut, unitMeta)).toFixed(4));
  }

  return baseOut;
}

function baseToKg(baseQty, unitMeta) {
  if (unitMeta.category !== 'peso') return 0;
  return Number((num(baseQty) / 1000).toFixed(4));
}

function recalcRecordStock(record) {
  const entries = Array.isArray(record.entries) ? record.entries : [];
  const stockBase = entries.reduce((acc, e) => {
    const meta = getUnitMeta(e.unit);
    return acc + getAvailableBase(e, meta);
  }, 0);
  record.stockBase = Number(stockBase.toFixed(6));

  const unit = String(record.stockUnit || (entries[0] && entries[0].unit) || '').toLowerCase();
  const unitMeta = getUnitMeta(unit);
  if (unitMeta.category === 'peso') {
    record.stockKg = Number((record.stockBase / 1000).toFixed(4));
  } else {
    record.stockKg = Number(entries.reduce((acc, e) => acc + num(e.availableKg), 0).toFixed(4));
  }
  record.hasEntries = entries.length > 0;
}



function buildAiBatchPlans({ items, ingredientes, todayIso, holidaySet, runId }) {
  const plans = {};
  if (!CFG.DEEPSEEK_ENABLED) {
    logWarn('🤖 DeepSeek deshabilitado para batch.');
    return plans;
  }
  const deepseekConfig = getDeepseekConfig();
  if (!deepseekConfig.apiKey) {
    logWarn('🤖 Sin clave DeepSeek para batch. Se usará fallback local por producto.');
    return plans;
  }

  const candidates = [];
  Object.keys(items || {}).forEach((ingredientId) => {
    const record = items[ingredientId];
    if (!record || !Array.isArray(record.entries) || !record.entries.length) return;
    const weeklyCfg = withDefaultWeeklyConfig(record.weeklySheetConfig);
    if (!weeklyCfg.egresoEnabled) return;
    const ingredient = safeObj(ingredientes[ingredientId]);
    record.entries.forEach((entry) => {
      const window = getEntryProcessingWindow(entry, weeklyCfg, todayIso, holidaySet);
      if (!window) return;
      const unitMeta = getUnitMeta(entry.unit);
      const availableBase = getAvailableBase(entry, unitMeta);
      if (availableBase <= CFG.EPS) return;
      const ingredientName = String(ingredient.name || ingredientId);
      const ingredientDesc = String(ingredient.description || 'Sin descripción');
      candidates.push({
        ingredientId,
        entryId: normalizeText(entry.id),
        ingredientName,
        ingredientDesc,
        provider: String(entry.provider || ''),
        unit: String(entry.unit || ''),
        packageQty: Number(entry.packageQty || record.packageQty || 0) || 0,
        entryDate: String(entry.entryDate || ''),
        expiryDate: String(entry.expiryDate || ''),
        rotationDays: Number(weeklyCfg.rotationDays || 0),
        processDays: window.processDays,
        limitIso: window.limitIso,
        availableQty: Number(entry.availableQty || 0),
        availableBase
      });
      logInfo(`🧠 Contexto AI: ${ingredientName} | ${ingredientDesc} | unidad=${entry.unit || '-'} | dispQty=${entry.availableQty || 0} | pack=${entry.packageQty || record.packageQty || '-'} | días=${window.processDays.join(',')}`);
    });
  });

  if (!candidates.length) {
    logInfo('🤖 Sin candidatos para planificación AI.');
    return plans;
  }

  const batchSize = Math.max(1, Math.min(100, Number(CFG.DEEPSEEK_MAX_BATCH_ITEMS || 20)));
  for (let i = 0; i < candidates.length; i += batchSize) {
    const chunk = candidates.slice(i, i + batchSize);
    try {
      const payload = {
        model: deepseekConfig.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Sos planificador de ventas realistas de mostrador para frigorífico/panificados. Responde SOLO JSON válido.' },
          { role: 'user', content: `Generá plan para cada item. Output estricto: {"plans":[{"entryId":"id","movements":[{"dayIso":"YYYY-MM-DD","qty":number}]}]}. Respetar processDays de cada item y suma <= availableQty. Contexto: ${JSON.stringify(chunk)}` }
        ]
      };
      logInfo(`🤖 Batch DeepSeek ${Math.floor(i / batchSize) + 1}: items=${chunk.length}`);
      const response = callDeepseek(payload, deepseekConfig);
      const content = String(response?.choices?.[0]?.message?.content || '');
      logInfo(`🤖 Respuesta cruda batch: ${content.slice(0, 280)}${content.length > 280 ? '…' : ''}`);
      const parsed = parseAiJsonFromText(content);
      const aiPlans = Array.isArray(parsed?.plans) ? parsed.plans : [];
      aiPlans.forEach((planItem) => {
        const entryId = normalizeText(planItem?.entryId);
        if (!entryId) return;
        const source = chunk.find((c) => c.entryId === entryId);
        if (!source) return;
        const allowed = new Set(source.processDays);
        const unitMeta = getUnitMeta(source.unit);
        const next = {};
        (Array.isArray(planItem?.movements) ? planItem.movements : []).forEach((mv) => {
          const dayIso = normalizeIso(mv?.dayIso);
          if (!dayIso || !allowed.has(dayIso)) return;
          const qty = Number(mv?.qty || 0);
          if (!Number.isFinite(qty) || qty <= 0) return;
          const base = roundBaseReasonable(toBase(qty, unitMeta), unitMeta);
          if (base <= CFG.EPS) return;
          next[dayIso] = Array.isArray(next[dayIso]) ? next[dayIso] : [];
          next[dayIso].push(base);
        });
        const totalBase = Object.values(next).flat().reduce((acc, n) => acc + Number(n || 0), 0);
        if (totalBase > source.availableBase && totalBase > 0) {
          const ratio = source.availableBase / totalBase;
          Object.keys(next).forEach((d) => {
            next[d] = next[d].map((b) => roundBaseReasonable(Number(b || 0) * ratio, unitMeta)).filter((b) => b > CFG.EPS);
          });
        }
        if (Object.keys(next).length) {
          plans[entryId] = next;
          logInfo(`🤖 Plan AI OK: ${source.ingredientName} (${entryId}) días=${Object.keys(next).length}`);
        }
      });
    } catch (error) {
      logWarn(`🤖 Batch DeepSeek falló (${Math.floor(i / batchSize) + 1}): ${error.message}.`);
    }
  }

  logInfo(`🤖 Planes AI totales aplicables: ${Object.keys(plans).length}/${candidates.length}`);
  return plans;
}

function getEntryProcessingWindow(entry, weeklyCfg, todayIso, holidaySet) {
  const entryDateIso = normalizeIso(entry.entryDate);
  if (!entryDateIso) return null;
  const expiryIso = isNoPerecedero(entry) ? '' : normalizeIso(entry.expiryDate);
  const rotationDays = Math.max(0, Math.round(num(weeklyCfg.rotationDays)));
  const rotationLimitIso = addBusinessDaysInclusive(entryDateIso, rotationDays, holidaySet);
  const limitIso = expiryIso ? minIso(expiryIso, rotationLimitIso) : rotationLimitIso;
  if (todayIso < entryDateIso) return null;
  const lastProcessedDate = normalizeIso(safeObj(entry.autoEgresoState).lastProcessedDate);
  let fromIso = entryDateIso;
  if (lastProcessedDate) fromIso = nextBusinessDay(addDays(lastProcessedDate, 1), holidaySet);
  const toIso = minIso(todayIso, limitIso);
  if (!toIso || fromIso > toIso) return null;
  const processDays = listBusinessDays(fromIso, toIso, holidaySet);
  if (!processDays.length) return null;
  return { fromIso, toIso, processDays, limitIso };
}

function buildAiPlanForEntry(ctx) {
  if (!CFG.DEEPSEEK_ENABLED) {
    logWarn('🤖 DeepSeek deshabilitado. Uso fallback local.');
    return null;
  }
  const deepseekConfig = getDeepseekConfig();
  if (!deepseekConfig.apiKey) {
    logWarn('🤖 Sin clave DeepSeek en Firebase (/deepseek/apiKey). Uso fallback local.');
    return null;
  }

  const { ingredientId, ingredient, record, entry, weeklyCfg, processDays, limitIso, availableBase, unitMeta, runId } = ctx;
  try {
    const prompt = {
      ingredientId,
      ingredientName: String(ingredient?.name || ''),
      ingredientDescription: String(ingredient?.description || ''),
      provider: String(entry?.provider || ''),
      unit: String(entry?.unit || ''),
      packageQty: Number(entry?.packageQty || record?.packageQty || 0) || 0,
      entryDate: String(entry?.entryDate || ''),
      expiryDate: String(entry?.expiryDate || ''),
      limitDate: limitIso,
      rotationDays: Number(weeklyCfg?.rotationDays || 0),
      availableQty: Number(entry?.availableQty || 0),
      availableBase,
      processDays,
      rules: {
        mondayToSaturdayOnly: true,
        excludeHolidayTypes: ['inamovible', 'puente'],
        openWindows: CFG.OPEN_WINDOWS,
        minWeightOrVolumeQty: CFG.MIN_WEIGHT_VOL_MOVE_QTY,
        minUnitQty: CFG.MIN_UNIT_MOVE_QTY
      }
    };

    const sys = 'Sos un planificador de ventas en local para frigorífico. Responde SOLO JSON válido.';
    const usr = `Genera movimientos de egreso realistas para el contexto: ${JSON.stringify(prompt)}.\nFormato estricto de salida: {"movements":[{"dayIso":"YYYY-MM-DD","qty":number}]} .\nReglas: no inventar días fuera de processDays, cantidades positivas, y suma <= availableQty.`;
    const payload = {
      model: deepseekConfig.model,
      temperature: 0.25,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: usr }
      ]
    };

    logInfo(`🤖 Consultando DeepSeek para ${ingredientId} run=${runId}`);
    const response = callDeepseek(payload, deepseekConfig);
    const content = String(response?.choices?.[0]?.message?.content || '');
    const parsed = parseAiJsonFromText(content);
    if (!parsed || !Array.isArray(parsed.movements)) {
      logWarn(`🤖 Respuesta inválida para ${ingredientId}. Fallback local.`);
      return null;
    }

    const allowed = new Set(processDays);
    const planByDay = {};
    parsed.movements.forEach((move) => {
      const dayIso = normalizeIso(move?.dayIso);
      if (!dayIso || !allowed.has(dayIso)) return;
      const qty = Number(move?.qty || 0);
      if (!Number.isFinite(qty) || qty <= 0) return;
      const base = roundBaseReasonable(toBase(qty, unitMeta), unitMeta);
      if (base <= CFG.EPS) return;
      if (!Array.isArray(planByDay[dayIso])) planByDay[dayIso] = [];
      planByDay[dayIso].push(base);
    });

    const totalBase = Object.values(planByDay).flat().reduce((acc, item) => acc + Number(item || 0), 0);
    if (totalBase <= CFG.EPS) {
      logWarn(`🤖 Sin movimientos utilizables para ${ingredientId}. Fallback local.`);
      return null;
    }

    if (totalBase > availableBase) {
      const ratio = availableBase / totalBase;
      Object.keys(planByDay).forEach((day) => {
        planByDay[day] = planByDay[day].map((b) => roundBaseReasonable(Number(b || 0) * ratio, unitMeta)).filter((b) => b > CFG.EPS);
      });
    }

    logInfo(`🤖 Plan AI aplicado para ${ingredientId}. días=${Object.keys(planByDay).length}`);
    return planByDay;
  } catch (error) {
    logError(`🤖 Error AI para ${ctx.ingredientId}: ${error.message}. Fallback local.`);
    return null;
  }
}

function callDeepseek(payload, deepseekConfig) {
  const response = UrlFetchApp.fetch('https://api.deepseek.com/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${deepseekConfig.apiKey}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const txt = response.getContentText() || '{}';
  if (code < 200 || code >= 300) {
    throw new Error(`DeepSeek ${code}: ${txt}`);
  }
  return JSON.parse(txt);
}

function parseAiJsonFromText(text) {
  const content = String(text || '').trim();
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch (_error) {
    const block = content.match(/```json([\s\S]*?)```/i) || content.match(/```([\s\S]*?)```/);
    if (block?.[1]) {
      try { return JSON.parse(block[1].trim()); } catch (_inner) {}
    }
    const first = content.indexOf('{');
    const last = content.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(content.slice(first, last + 1)); } catch (_inner2) {}
    }
    return null;
  }
}


function getDeepseekConfig() {
  if (RUNTIME.deepseek) return RUNTIME.deepseek;
  try {
    const keyNode = workerRead('/deepseek/apiKey');
    const apiKey = typeof keyNode === 'string' ? String(keyNode).trim() : String((keyNode && keyNode.apiKey) || '').trim();
    const deepseekNode = safeObj(workerRead('/deepseek'));
    const model = String(deepseekNode.model || CFG.DEEPSEEK_MODEL_FALLBACK || 'deepseek-chat').trim() || 'deepseek-chat';
    const cfg = { apiKey, model };
    if (apiKey) {
      logInfo(`🔐 DeepSeek clave cargada desde Firebase. Modelo=${model}`);
    }
    RUNTIME.deepseek = cfg;
    return cfg;
  } catch (error) {
    logError(`🔐 Error leyendo configuración DeepSeek desde Firebase: ${error.message}`);
    RUNTIME.deepseek = { apiKey: '', model: CFG.DEEPSEEK_MODEL_FALLBACK || 'deepseek-chat' };
    return RUNTIME.deepseek;
  }
}

function logInfo(msg) { Logger.log(`🟦 ${msg}`); }
function logWarn(msg) { Logger.log(`🟨 ${msg}`); }
function logError(msg) { Logger.log(`🟥 ${msg}`); }

function withDefaultWeeklyConfig(cfg) {
  return Object.assign({
    configured: false,
    counterOnly: false,
    egresoEnabled: true,
    perishable: true,
    rotationDays: 7,
    updatedAt: 0
  }, cfg || {});
}

function isNoPerecedero(entry) {
  return Boolean(entry && entry.noPerecedero);
}

function normalizeIso(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function dateToIso(d, tz) {
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

function isoToDate(iso) {
  return new Date(`${iso}T00:00:00`);
}

function addDays(iso, n) {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, CFG.TIMEZONE, 'yyyy-MM-dd');
}

function minIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return (h * 60) + m;
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

function num(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(v) {
  return String(v || '').trim().toLowerCase();
}

function safeObj(v) {
  return v && typeof v === 'object' ? v : {};
}
