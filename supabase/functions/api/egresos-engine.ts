// @ts-nocheck
// Motor de auto-egresos: copia literal de functions/auto-egresos.js (líneas puras, sin acceso a datos).
const TZ = 'America/Argentina/Buenos_Aires';
const SOURCE = 'cloud_function_auto_egreso';
const AUTO_SOURCES = new Set(['apps_script_auto_egreso', SOURCE]);
const LOCK_MS = 9 * 60 * 1000;

const DEFAULTS = {
  enabled: true,
  aiEnabled: true,
  expiredLotAction: 'venta',
  OPEN_WINDOWS: [{ from: '08:30', to: '13:00' }, { from: '16:30', to: '19:30' }],
  HOLIDAY_TYPES_EXCLUDED: ['inamovible', 'puente'],
  HOLIDAYS_API: 'https://api.argentinadatos.com/v1/feriados/',
  STRICT_RUN_WINDOW: false,
  MAX_DAILY_SPLITS: 8,
  MIN_WEIGHT_VOL_MOVE_QTY: 0.25,
  MIN_UNIT_MOVE_QTY: 1,
  MAX_WEIGHT_VOL_MOVE_QTY: 3,
  MAX_UNIT_MOVE_QTY: 4,
  MAX_PACKAGE_MOVE_QTY: 3,
  MAX_UNIT_DAY_QTY: 12,
  MAX_PACKAGE_DAY_QTY: 8,
  MAX_WEIGHT_VOL_DAY_QTY: 10,
  AI_MAX_BATCH_ITEMS: 20,
  MAX_RUN_MILLIS: 480000,
  MAX_PRODUCTS_PER_RUN: 500,
  INDEX_VERSION: 4
};
const EPS = 0.0001;

const num = (v) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
const normalizeText = (v) => String(v || '').trim().toLowerCase();
const normalizeValue = (v) => String(v || '').trim();
const safeObj = (v) => (v && typeof v === 'object' ? v : {});
const normalizeIso = (v) => { const s = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };
const minIso = (a, b) => { if (!a) return b; if (!b) return a; return a <= b ? a : b; };
const hhmmToMinutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map((x) => parseInt(x, 10)); return (h * 60) + m; };
const toFiniteNumber = (value, fallback) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
const isNoPerecedero = (entry) => Boolean(entry && entry.noPerecedero);
const isAutoSource = (v) => AUTO_SOURCES.has(normalizeText(v));

const isoMs = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (iso, n) => new Date(isoMs(iso) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (fromIso, toIso) => Math.round((isoMs(toIso) - isoMs(fromIso)) / 86400000);
const dayOfWeek = (iso) => new Date(isoMs(iso)).getUTCDay();

function makeTz(tz) {
  let fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  } catch (_) { fmt = null; }
  const FALLBACK_OFFSET_MIN = -180;
  const wall = (ms) => {
    if (!fmt) {
      const d = new Date(ms + FALLBACK_OFFSET_MIN * 60000);
      return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
    }
    const p = {};
    fmt.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
  };
  const pad = (n) => String(n).padStart(2, '0');
  return {
    dateToIso: (date) => { const w = wall(new Date(date).getTime()); return `${w.y}-${pad(w.mo)}-${pad(w.d)}`; },
    hhmm: (date) => { const w = wall(new Date(date).getTime()); return `${pad(w.h)}:${pad(w.mi)}`; },
    localToTs: (iso, hh, mm) => {
      const [y, m, d] = iso.split('-').map(Number);
      const target = Date.UTC(y, m - 1, d, hh, mm);
      let ts = target;
      for (let i = 0; i < 2; i += 1) {
        const w = wall(ts);
        const seen = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
        ts += target - seen;
      }
      return ts;
    }
  };
}

function parseAiJsonFromText(text) {
  const content = String(text || '').trim();
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch (_error) {
    const block = content.match(/```json([\s\S]*?)```/i) || content.match(/```([\s\S]*?)```/);
    if (block && block[1]) {
      try { return JSON.parse(block[1].trim()); } catch (_inner) { /* sigue */ }
    }
    const first = content.indexOf('{');
    const last = content.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(content.slice(first, last + 1)); } catch (_inner2) { /* sigue */ }
    }
    return null;
  }
}

function withDefaultWeeklyConfig(cfg) {
  return Object.assign({ configured: false, counterOnly: false, egresoEnabled: true, perishable: true, rotationDays: 7, updatedAt: 0 }, cfg || {});
}

function getUnitMeta(unitRaw) {
  const u = String(unitRaw || '').toLowerCase().trim();
  const mass = { kg: 1000, kilo: 1000, kilos: 1000, g: 1, gr: 1, gramo: 1, gramos: 1, mg: 0.001, oz: 28.3495 };
  const vol = { l: 1000, lt: 1000, litro: 1000, litros: 1000, ml: 1, cc: 1 };
  if (mass[u]) return { category: 'peso', factor: mass[u] };
  if (vol[u]) return { category: 'volumen', factor: vol[u] };
  if (['u', 'un', 'unidad', 'unidades'].includes(u)) return { category: 'unidad', factor: 1 };
  if (['pack', 'paquete', 'paquetes'].includes(u)) return { category: 'paquete', factor: 1 };
  return { category: 'otro', factor: 1 };
}
const toBase = (qty, unitMeta) => num(qty) * num(unitMeta.factor || 1);
const fromBase = (base, unitMeta) => { const f = num(unitMeta.factor || 1); return f > 0 ? (num(base) / f) : 0; };
function getAvailableBase(entry, unitMeta) {
  const byBase = Number(entry.availableBase);
  if (Number.isFinite(byBase) && byBase >= 0) return byBase;
  return toBase(num(entry.availableQty), unitMeta);
}
function roundQtyForUnit(qty, unitMeta) {
  const q = Math.max(0, num(qty));
  if (unitMeta.category === 'unidad' || unitMeta.category === 'paquete') return Math.max(0, Math.round(q));
  return Number(q.toFixed(3));
}
function roundBaseReasonable(baseQty, unitMeta) {
  return Number(toBase(roundQtyForUnit(fromBase(baseQty, unitMeta), unitMeta), unitMeta).toFixed(6));
}
function baseToKg(baseQty, unitMeta) {
  if (unitMeta.category !== 'peso') return 0;
  return Number((num(baseQty) / 1000).toFixed(4));
}

function applyDiscountBaseToEntry(entry, baseOutRaw, unitMeta) {
  const prevBase = getAvailableBase(entry, unitMeta);
  if (prevBase <= EPS) return 0;
  const baseOut = Math.max(0, Math.min(prevBase, num(baseOutRaw)));
  if (baseOut <= EPS) return 0;
  const nextBase = Number(Math.max(0, prevBase - baseOut).toFixed(6));
  entry.availableBase = nextBase;
  entry.availableQty = roundQtyForUnit(fromBase(nextBase, unitMeta), unitMeta);
  if (unitMeta.category === 'peso') {
    entry.availableKg = Number((nextBase / 1000).toFixed(4));
  } else if (typeof entry.availableKg === 'number') {
    entry.availableKg = Number(Math.max(0, num(entry.availableKg) - baseToKg(baseOut, unitMeta)).toFixed(4));
  }
  return baseOut;
}

function normalizeLegacyAutoEgresoEntry(entry) {
  const next = safeObj(entry);
  let changed = false;
  next.expiryResolutions = Array.isArray(next.expiryResolutions) ? next.expiryResolutions : [];
  next.expiryResolutions = next.expiryResolutions.map((res) => {
    const isAuto = Boolean(res && res.generatedAutomatically) || isAutoSource(res && res.source);
    if (!isAuto) return res;
    if (normalizeText(res && res.type) === 'sold_counter') {
      changed = true;
      return { ...res, type: 'auto_sold_local' };
    }
    return res;
  });
  const status = normalizeText(next.expiryResolutionStatus || next.status);
  if (status === 'sold_counter') {
    const hasAuto = next.expiryResolutions.some((res) => Boolean(res && res.generatedAutomatically) || isAutoSource(res && res.source) || normalizeText(res && res.type) === 'auto_sold_local');
    if (hasAuto) {
      if (Object.prototype.hasOwnProperty.call(next, 'expiryResolutionStatus')) { delete next.expiryResolutionStatus; changed = true; }
      if (Object.prototype.hasOwnProperty.call(next, 'status')) { delete next.status; changed = true; }
    }
  }
  return { changed, entry: next };
}

function createEngine({ cfg, random = Math.random, tz = TZ, log }) {
  const T = makeTz(tz);
  const rnd = () => random();
  const randBetween = (min, max) => min + rnd() * (max - min);
  const holidayTypes = new Set((cfg.HOLIDAY_TYPES_EXCLUDED || []).map(normalizeText));

  const isBusinessDay = (iso, holidaySet) => dayOfWeek(iso) !== 0 && !holidaySet.has(iso);
  function listBusinessDays(fromIso, toIso, holidaySet) {
    if (!fromIso || !toIso || fromIso > toIso) return [];
    const out = [];
    for (let cur = fromIso; cur <= toIso; cur = addDays(cur, 1)) if (isBusinessDay(cur, holidaySet)) out.push(cur);
    return out;
  }
  function addBusinessDaysInclusive(startIso, nDays, holidaySet) {
    let cur = startIso;
    if (nDays <= 0) return cur;
    let count = 0;
    for (let guard = 0; guard < 4000; guard += 1) {
      if (isBusinessDay(cur, holidaySet)) count += 1;
      if (count >= nDays) return cur;
      cur = addDays(cur, 1);
    }
    return cur;
  }
  function nextBusinessDay(iso, holidaySet) {
    let cur = iso;
    for (let guard = 0; guard < 400 && !isBusinessDay(cur, holidaySet); guard += 1) cur = addDays(cur, 1);
    return cur;
  }
  const isWithinOpenWindows = (date) => { const hhmm = T.hhmm(date); return cfg.OPEN_WINDOWS.some((w) => hhmm >= w.from && hhmm <= w.to); };

  function randomTimestampInBusinessWindows(dayIso) {
    const windows = cfg.OPEN_WINDOWS;
    const pick = windows[Math.floor(rnd() * windows.length)];
    const min = Math.floor(randBetween(hhmmToMinutes(pick.from), hhmmToMinutes(pick.to) + 1));
    return T.localToTs(normalizeIso(dayIso), Math.floor(min / 60), min % 60);
  }

  function getHardDailyLimitBase(unitMeta) {
    if (unitMeta.category === 'unidad') return roundBaseReasonable(toBase(Math.max(cfg.MIN_UNIT_MOVE_QTY, num(cfg.MAX_UNIT_DAY_QTY || 12)), unitMeta), unitMeta);
    if (unitMeta.category === 'paquete') return roundBaseReasonable(toBase(Math.max(cfg.MIN_UNIT_MOVE_QTY, num(cfg.MAX_PACKAGE_DAY_QTY || 8)), unitMeta), unitMeta);
    return roundBaseReasonable(toBase(Math.max(cfg.MIN_WEIGHT_VOL_MOVE_QTY, num(cfg.MAX_WEIGHT_VOL_DAY_QTY || 10)), unitMeta), unitMeta);
  }

  function splitBaseQuantity(dayBase, unitMeta) {
    if (dayBase <= 0) return [];
    const maxDailySplits = Math.max(1, Math.floor(num(cfg.MAX_DAILY_SPLITS || 8)));
    if (unitMeta.category === 'unidad' || unitMeta.category === 'paquete') {
      const maxMoveQty = unitMeta.category === 'paquete'
        ? Math.max(1, Math.floor(num(cfg.MAX_PACKAGE_MOVE_QTY || 3)))
        : Math.max(1, Math.floor(num(cfg.MAX_UNIT_MOVE_QTY || 4)));
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
        const thisQty = out.length >= maxDailySplits - 1 ? Math.min(maxMoveQty, qtyLeft) : Math.floor(randBetween(minThis, maxThis + 1));
        out.push(toBase(thisQty, unitMeta));
        qtyLeft -= thisQty;
      }
      return out.filter((v) => v > 0);
    }
    const maxMoveQty = Math.max(cfg.MIN_WEIGHT_VOL_MOVE_QTY, num(cfg.MAX_WEIGHT_VOL_MOVE_QTY || 3));
    let qtyLeft = Math.max(0, fromBase(dayBase, unitMeta));
    if (qtyLeft <= EPS) return [];
    const out = [];
    let guard = 0;
    while (qtyLeft > EPS && guard < 2000) {
      guard += 1;
      const qtyChunk = Math.min(maxMoveQty, qtyLeft);
      const minChunk = Math.min(qtyChunk, cfg.MIN_WEIGHT_VOL_MOVE_QTY);
      const picked = out.length >= maxDailySplits - 1 ? qtyChunk : randBetween(minChunk, qtyChunk);
      const rounded = roundBaseReasonable(toBase(picked, unitMeta), unitMeta);
      if (rounded <= EPS) break;
      out.push(rounded);
      qtyLeft = Math.max(0, qtyLeft - fromBase(rounded, unitMeta));
    }
    const sum = out.reduce((a, b) => a + b, 0);
    const diff = roundBaseReasonable(dayBase - sum, unitMeta);
    if (Math.abs(diff) > EPS && out.length) out[out.length - 1] = roundBaseReasonable(out[out.length - 1] + diff, unitMeta);
    return out.filter((v) => v > 0 && fromBase(v, unitMeta) >= cfg.MIN_WEIGHT_VOL_MOVE_QTY - EPS);
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
    const overdueFlush = todayIso > limitIso;
    const expiredDrain = overdueFlush && Boolean(expiryIso) && expiryIso <= limitIso;
    const toIso = overdueFlush ? todayIso : minIso(todayIso, limitIso);
    if (!toIso || fromIso > toIso) return null;
    const processDays = listBusinessDays(fromIso, toIso, holidaySet);
    if (!processDays.length) return null;
    return { fromIso, toIso, processDays, limitIso, overdueFlush, expiredDrain };
  }

  function pushAutoEgresoMovement(entry, { atTs, qtyUnit, qtyBase, unitMeta, unitLabel, runId, kind = 'venta' }) {
    const roundedQty = roundQtyForUnit(qtyUnit, unitMeta);
    const roundedBase = Number(qtyBase.toFixed(6));
    const roundedKg = baseToKg(qtyBase, unitMeta);
    const isBaja = kind === 'baja';
    const reason = isBaja ? 'Baja por vencimiento' : 'Venta en mostrador';
    entry.expiryResolutions = Array.isArray(entry.expiryResolutions) ? entry.expiryResolutions : [];
    entry.expiryResolutions.unshift({
      id: `auto_res_${Date.now()}_${rnd().toString(36).slice(2, 8)}`,
      createdAt: atTs,
      type: isBaja ? 'auto_expired_discard' : 'auto_sold_local',
      qtyKg: roundedKg,
      qty: roundedQty,
      unit: unitLabel,
      reason,
      generatedAutomatically: true,
      source: SOURCE,
      runId
    });
    entry.productionUsage = Array.isArray(entry.productionUsage) ? entry.productionUsage : [];
    entry.productionUsage.unshift({
      id: `usage_auto_${Date.now()}_${rnd().toString(36).slice(2, 8)}`,
      createdAt: atTs,
      producedAt: atTs,
      productionDate: T.dateToIso(atTs),
      expiryDateAtProduction: reason,
      kilosUsed: roundedKg,
      usedQty: roundedQty,
      usedUnit: unitLabel,
      usedBaseQty: roundedBase,
      lotNumber: String(entry.lotNumber || entry.invoiceNumber || entry.id || '-'),
      ingredientLot: String(entry.lotNumber || entry.invoiceNumber || entry.id || '-'),
      productionId: `AUTO-EGRESO-${runId}`,
      internalUse: true,
      generatedAutomatically: true,
      source: SOURCE,
      note: `Auto egreso · ${reason}`
    });
    entry.movementHistory = Array.isArray(entry.movementHistory) ? entry.movementHistory : [];
    entry.movementHistory.unshift({
      createdAt: atTs,
      type: isBaja ? 'baja_automatica_vencimiento' : 'egreso_automatico',
      reason,
      qty: roundedQty,
      qtyBase: roundedBase,
      qtyKg: roundedKg,
      qtyUnit: unitLabel,
      generatedAutomatically: true,
      source: SOURCE,
      reference: runId
    });
    return { atTs, dayIso: T.dateToIso(atTs), qty: roundedQty, qtyBase: roundedBase, unit: unitLabel, kind };
  }

  function processEntryAutoEgreso({ ingredientId, ingredient, entry, weeklyCfg, todayIso, holidaySet, runId, aiPlanByDay = null }) {
    const out = { changed: false, movementsCreated: 0, entry, overdueFlush: false, movements: [] };
    const unitMeta = getUnitMeta(entry.unit);
    let availableBase = getAvailableBase(entry, unitMeta);
    if (availableBase <= EPS) return out;
    const window = getEntryProcessingWindow(entry, weeklyCfg, todayIso, holidaySet);
    if (!window) return out;
    const { fromIso, toIso, limitIso, overdueFlush, expiredDrain } = window;
    let { processDays } = window;
    const bajaMode = cfg.expiredLotAction === 'baja' && expiredDrain;
    let drainOnIso;
    let bajaOnIso = '';
    if (bajaMode) {
      processDays = processDays.filter((d) => d <= limitIso);
      drainOnIso = limitIso;
      bajaOnIso = minIso(nextBusinessDay(addDays(limitIso, 1), holidaySet), todayIso);
      if (bajaOnIso < fromIso) bajaOnIso = fromIso > todayIso ? todayIso : fromIso;
    } else {
      drainOnIso = overdueFlush ? processDays[processDays.length - 1] : limitIso;
    }
    out.overdueFlush = Boolean(overdueFlush);
    const unitLabel = String(entry.unit || '');
    const record = (appliedBase, dayIso, kind) => {
      const atTs = randomTimestampInBusinessWindows(dayIso);
      out.movements.push(pushAutoEgresoMovement(entry, { atTs, qtyUnit: fromBase(appliedBase, unitMeta), qtyBase: appliedBase, unitMeta, unitLabel, runId, kind }));
      out.movementsCreated += 1;
      out.changed = true;
    };

    let businessDaysLeft = listBusinessDays(fromIso, drainOnIso, holidaySet).length;
    if (businessDaysLeft <= 0) businessDaysLeft = 1;

    processDays.forEach((dayIso) => {
      availableBase = getAvailableBase(entry, unitMeta);
      if (availableBase <= EPS) return;
      const aiSplits = Array.isArray(aiPlanByDay && aiPlanByDay[dayIso]) ? aiPlanByDay[dayIso] : [];
      let splits = [];
      if (aiSplits.length) {
        const aiDayBase = aiSplits.map((item) => Number(item || 0)).filter((item) => item > EPS).reduce((acc, item) => acc + roundBaseReasonable(item, unitMeta), 0);
        const isLastLimitDay = dayIso === drainOnIso;
        const fairDayBase = roundBaseReasonable(availableBase / businessDaysLeft, unitMeta);
        const aiDayLimitBase = Math.max(getHardDailyLimitBase(unitMeta), roundBaseReasonable(fairDayBase * 1.35, unitMeta));
        const cappedAiDayBase = isLastLimitDay ? availableBase : Math.min(availableBase, Math.max(0, Math.min(aiDayBase, aiDayLimitBase)));
        splits = splitBaseQuantity(cappedAiDayBase, unitMeta);
        log.info(`IA ${String((ingredient && ingredient.name) || ingredientId)} ${dayIso} base=${Number(cappedAiDayBase.toFixed(3))}${isLastLimitDay ? ' (día límite)' : ''} movimientos=${splits.length}`);
      }
      if (!splits.length) {
        const isLastLimitDay = dayIso === drainOnIso;
        const factor = randBetween(0.85, 1.15);
        let dayBase = isLastLimitDay ? availableBase : ((availableBase / businessDaysLeft) * factor);
        dayBase = roundBaseReasonable(dayBase, unitMeta);
        if (dayBase <= 0) { businessDaysLeft = Math.max(1, businessDaysLeft - 1); return; }
        if (dayBase > availableBase) dayBase = availableBase;
        splits = splitBaseQuantity(dayBase, unitMeta);
      }
      splits.forEach((partBase) => {
        if (partBase <= 0) return;
        if (getAvailableBase(entry, unitMeta) <= EPS) return;
        const appliedBase = applyDiscountBaseToEntry(entry, partBase, unitMeta);
        if (appliedBase <= EPS) return;
        record(appliedBase, dayIso, 'venta');
      });
      availableBase = getAvailableBase(entry, unitMeta);
      if (dayIso === drainOnIso && availableBase > EPS) {
        const finalBase = roundBaseReasonable(availableBase, unitMeta);
        if (finalBase > 0) {
          const appliedBase = applyDiscountBaseToEntry(entry, finalBase, unitMeta);
          if (appliedBase > EPS) record(appliedBase, dayIso, 'venta');
        }
      }
      businessDaysLeft = Math.max(1, businessDaysLeft - 1);
    });

    if (bajaMode) {
      const remaining = getAvailableBase(entry, unitMeta);
      if (remaining > EPS) {
        const appliedBase = applyDiscountBaseToEntry(entry, remaining, unitMeta);
        if (appliedBase > EPS) record(appliedBase, bajaOnIso, 'baja');
      }
    }

    if (num(entry.availableQty) <= EPS) {
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

  async function fetchHolidaySet(years, fetchImpl) {
    const set = new Set();
    await Promise.all(years.map(async (year) => {
      try {
        const resp = await fetchImpl(`${cfg.HOLIDAYS_API}${year}/`);
        if (!resp.ok) return;
        const arr = await resp.json();
        (Array.isArray(arr) ? arr : []).forEach((h) => {
          if (holidayTypes.has(normalizeText(h.tipo))) { const iso = normalizeIso(h.fecha); if (iso) set.add(iso); }
        });
      } catch (e) {
        log.warn(`No se pudieron leer feriados ${year}: ${e.message}`);
      }
    }));
    return set;
  }

  async function buildAiBatchPlans({ items, ingredientes, todayIso, holidaySet, aiChat }) {
    const plans = {};
    if (!aiChat) return plans;
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
        if (availableBase <= EPS) return;
        const bajaMode = cfg.expiredLotAction === 'baja' && window.expiredDrain;
        const processDays = bajaMode ? window.processDays.filter((d) => d <= window.limitIso) : window.processDays;
        if (!processDays.length) return;
        candidates.push({
          ingredientId,
          entryId: normalizeText(entry.id),
          ingredientName: String(ingredient.name || ingredientId),
          ingredientDesc: String(ingredient.description || 'Sin descripción'),
          provider: String(entry.provider || ''),
          unit: String(entry.unit || ''),
          packageQty: Number(entry.packageQty || record.packageQty || 0) || 0,
          entryDate: String(entry.entryDate || ''),
          expiryDate: String(entry.expiryDate || ''),
          rotationDays: Number(weeklyCfg.rotationDays || 0),
          processDays,
          limitIso: window.limitIso,
          overdueFlush: Boolean(window.overdueFlush) && !bajaMode,
          availableQty: Number(entry.availableQty || 0),
          availableBase
        });
      });
    });
    if (!candidates.length) return plans;

    const batchSize = Math.max(1, Math.min(100, Number(cfg.AI_MAX_BATCH_ITEMS || 20)));
    for (let i = 0; i < candidates.length; i += batchSize) {
      const chunk = candidates.slice(i, i + batchSize);
      try {
        const response = await aiChat({
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Sos planificador de ventas realistas de mostrador para frigorífico/panificados. Responde SOLO JSON válido.' },
            { role: 'user', content: `Generá plan para cada item. Output estricto: {"plans":[{"entryId":"id","movements":[{"dayIso":"YYYY-MM-DD","qty":number}]}]}. Respetar processDays de cada item y suma <= availableQty. Si overdueFlush=true, el item ya está vencido: poner TODA la cantidad disponible en el último processDay. Contexto: ${JSON.stringify(chunk)}` }
          ]
        });
        const content = String((((response || {}).choices || [])[0] || {}).message?.content || '');
        const parsed = parseAiJsonFromText(content);
        const aiPlans = Array.isArray(parsed && parsed.plans) ? parsed.plans : [];
        aiPlans.forEach((planItem) => {
          const entryId = normalizeText(planItem && planItem.entryId);
          if (!entryId) return;
          const source = chunk.find((c) => c.entryId === entryId);
          if (!source) return;
          const allowed = new Set(source.processDays);
          const unitMeta = getUnitMeta(source.unit);
          const next = {};
          (Array.isArray(planItem.movements) ? planItem.movements : []).forEach((mv) => {
            const dayIso = normalizeIso(mv && mv.dayIso);
            if (!dayIso || !allowed.has(dayIso)) return;
            const qty = Number((mv && mv.qty) || 0);
            if (!Number.isFinite(qty) || qty <= 0) return;
            const base = roundBaseReasonable(toBase(qty, unitMeta), unitMeta);
            if (base <= EPS) return;
            (next[dayIso] = next[dayIso] || []).push(base);
          });
          const totalBase = Object.values(next).flat().reduce((acc, n) => acc + Number(n || 0), 0);
          if (totalBase > source.availableBase && totalBase > 0) {
            const ratio = source.availableBase / totalBase;
            Object.keys(next).forEach((d) => {
              next[d] = next[d].map((b) => roundBaseReasonable(Number(b || 0) * ratio, unitMeta)).filter((b) => b > EPS);
            });
          }
          if (Object.keys(next).length) plans[entryId] = next;
        });
      } catch (error) {
        log.warn(`Lote IA ${Math.floor(i / batchSize) + 1} falló: ${error.message}. Se usa el reparto local.`);
      }
    }
    log.info(`Planes IA aplicables: ${Object.keys(plans).length}/${candidates.length}`);
    return plans;
  }

  return {
    T, isWithinOpenWindows, listBusinessDays, splitBaseQuantity, getEntryProcessingWindow,
    processEntryAutoEgreso, fetchHolidaySet, buildAiBatchPlans
  };
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

export { TZ, SOURCE, DEFAULTS, EPS, createEngine, collectYearsToFetch, normalizeLegacyAutoEgresoEntry, withDefaultWeeklyConfig, getUnitMeta, getAvailableBase, safeObj, normalizeText, normalizeValue, normalizeIso, num, parseAiJsonFromText, makeTz, addDays, dayOfWeek };
