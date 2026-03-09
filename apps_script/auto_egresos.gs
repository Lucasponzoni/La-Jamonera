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
  MAX_DAILY_SPLITS: 3
};

function runAutoEgresos() {
  if (!CFG.WORKER_BASE_URL) throw new Error('Falta Script Property WORKER_BASE_URL');

  const now = new Date();
  if (CFG.STRICT_RUN_WINDOW && !isWithinOpenWindows(now, CFG.TIMEZONE, CFG.OPEN_WINDOWS)) {
    Logger.log('Fuera de horario comercial. No se ejecuta.');
    return;
  }

  const runId = `run_${Date.now()}`;
  const inventario = workerRead(CFG.INVENTARIO_PATH) || {};
  const items = safeObj(inventario.items);
  const todayIso = dateToIso(now, CFG.TIMEZONE);

  let affectedProducts = 0;
  let generatedMovements = 0;

  const yearsNeeded = collectYearsToFetch(items, todayIso);
  const holidaySet = fetchHolidaySet(yearsNeeded);

  Object.keys(items).forEach((ingredientId) => {
    const record = items[ingredientId];
    if (!record || !Array.isArray(record.entries) || !record.entries.length) return;

    const weeklyCfg = withDefaultWeeklyConfig(record.weeklySheetConfig);
    if (!weeklyCfg.egresoEnabled) return;

    let changedRecord = false;

    record.entries = record.entries.map((entry) => {
      const result = processEntryAutoEgreso({
        ingredientId,
        entry,
        weeklyCfg,
        todayIso,
        holidaySet,
        runId
      });
      if (!result.changed) return entry;
      changedRecord = true;
      generatedMovements += result.movementsCreated;
      return result.entry;
    });

    if (changedRecord) {
      recalcRecordStock(record);
      workerWrite(`/inventario/items/${ingredientId}`, record);
      affectedProducts += 1;
    }
  });

  Logger.log(`Auto-egresos OK | productos: ${affectedProducts} | movimientos: ${generatedMovements} | runId: ${runId}`);
}

function processEntryAutoEgreso(ctx) {
  const { entry, weeklyCfg, todayIso, holidaySet, runId } = ctx;
  const out = { changed: false, movementsCreated: 0, entry };

  const unitMeta = getUnitMeta(entry.unit);
  let availableBase = getAvailableBase(entry, unitMeta);
  if (availableBase <= CFG.EPS) return out;

  const entryDateIso = normalizeIso(entry.entryDate);
  if (!entryDateIso) return out;

  const expiryIso = isNoPerecedero(entry) ? '' : normalizeIso(entry.expiryDate);
  const rotationDays = Math.max(0, Math.round(num(weeklyCfg.rotationDays)));

  // Fecha límite real: min(vencimiento, ingreso + rotación hábil inclusiva)
  const rotationLimitIso = addBusinessDaysInclusive(entryDateIso, rotationDays, holidaySet);
  let limitIso = rotationLimitIso;
  if (expiryIso) limitIso = minIso(expiryIso, rotationLimitIso);

  if (todayIso < entryDateIso) return out;

  entry.autoEgresoState = safeObj(entry.autoEgresoState);
  const lastProcessedDate = normalizeIso(entry.autoEgresoState.lastProcessedDate);

  let fromIso = entryDateIso;
  if (lastProcessedDate) {
    fromIso = nextBusinessDay(addDays(lastProcessedDate, 1), holidaySet);
  }

  const toIso = minIso(todayIso, limitIso);
  if (!toIso || fromIso > toIso) return out;

  const processDays = listBusinessDays(fromIso, toIso, holidaySet);
  if (!processDays.length) return out;

  let businessDaysLeft = listBusinessDays(fromIso, limitIso, holidaySet).length;
  if (businessDaysLeft <= 0) businessDaysLeft = 1;

  processDays.forEach((dayIso) => {
    availableBase = getAvailableBase(entry, unitMeta);
    if (availableBase <= CFG.EPS) return;

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

    const splits = splitBaseQuantity(dayBase, unitMeta);

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
    entry.expiryResolutionStatus = 'sold_counter';
    entry.status = 'sold_counter';
  }

  entry.autoEgresoState.lastProcessedDate = toIso;
  entry.autoEgresoState.lastRunAt = Date.now();
  entry.autoEgresoState.lastRunId = runId;

  return out;
}

function pushAutoEgresoMovement(entry, meta) {
  const { atTs, qtyUnit, qtyBase, unitMeta, unitLabel, runId } = meta;

  entry.expiryResolutions = Array.isArray(entry.expiryResolutions) ? entry.expiryResolutions : [];
  entry.expiryResolutions.unshift({
    id: `auto_res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: atTs,
    type: 'sold_counter',
    qtyKg: baseToKg(qtyBase, unitMeta),
    qty: roundQtyForUnit(qtyUnit, unitMeta),
    unit: unitLabel,
    reason: 'Venta en mostrador',
    generatedAutomatically: true,
    source: 'apps_script_auto_egreso',
    runId
  });

  // Historial técnico (útil para auditoría y debugging)
  entry.movementHistory = Array.isArray(entry.movementHistory) ? entry.movementHistory : [];
  entry.movementHistory.unshift({
    createdAt: atTs,
    type: 'egreso_automatico',
    reason: 'Venta en mostrador',
    qty: roundQtyForUnit(qtyUnit, unitMeta),
    qtyBase: Number(qtyBase.toFixed(6)),
    qtyKg: baseToKg(qtyBase, unitMeta),
    qtyUnit: unitLabel,
    generatedAutomatically: true,
    source: 'apps_script_auto_egreso',
    reference: runId
  });
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
      Logger.log(`No se pudo leer feriados ${year}: ${e.message}`);
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

function splitBaseQuantity(dayBase, unitMeta) {
  if (dayBase <= 0) return [];

  // unidades/paquetes: splits enteros reales
  if (unitMeta.category === 'unidad' || unitMeta.category === 'paquete') {
    let units = Math.round(fromBase(dayBase, unitMeta));
    units = Math.max(0, units);
    if (units === 0) return [];

    const maxParts = Math.min(2, units);
    const parts = Math.max(1, Math.floor(randBetween(1, maxParts + 1)));
    if (parts === 1) return [toBase(units, unitMeta)];

    const out = [];
    let left = units;
    for (let i = 0; i < parts - 1; i++) {
      const min = 1;
      const max = Math.max(1, left - (parts - i - 1));
      const p = Math.floor(randBetween(min, max + 1));
      out.push(toBase(p, unitMeta));
      left -= p;
    }
    if (left > 0) out.push(toBase(left, unitMeta));
    return out.filter((v) => v > 0);
  }

  const maxParts = Math.max(1, Math.min(CFG.MAX_DAILY_SPLITS, 3));
  const parts = Math.max(1, Math.floor(randBetween(1, maxParts + 1)));
  if (parts === 1) return [roundBaseReasonable(dayBase, unitMeta)];

  let remain = dayBase;
  const out = [];
  for (let i = 0; i < parts - 1; i++) {
    const minB = roundBaseReasonable(toBase(0.05, unitMeta), unitMeta);
    const maxB = Math.max(minB, remain * 0.7);
    let p = randBetween(minB, maxB);
    p = roundBaseReasonable(p, unitMeta);
    if (p <= 0) continue;
    if (p >= remain) p = roundBaseReasonable(remain / 2, unitMeta);
    out.push(p);
    remain = roundBaseReasonable(remain - p, unitMeta);
    if (remain <= 0) break;
  }
  if (remain > 0) out.push(roundBaseReasonable(remain, unitMeta));

  const sum = out.reduce((a, b) => a + b, 0);
  const diff = roundBaseReasonable(dayBase - sum, unitMeta);
  if (Math.abs(diff) > CFG.EPS && out.length) out[out.length - 1] = roundBaseReasonable(out[out.length - 1] + diff, unitMeta);
  return out.filter((v) => v > 0);
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

function safeObj(v) {
  return v && typeof v === 'object' ? v : {};
}
