(function produccionModule() {
  const produccionModal = document.getElementById('produccionModal');
  if (!produccionModal) return;

  const nodes = {
    loading: document.getElementById('produccionLoading'),
    empty: document.getElementById('produccionEmpty'),
    data: document.getElementById('produccionData'),
    list: document.getElementById('produccionList'),
    editor: document.getElementById('produccionEditor'),
    search: document.getElementById('produccionSearchInput')
  };

  const FIAMBRES_IMAGE = 'https://i.postimg.cc/fyvNDdrt/FIambres.png';
  const BASE_ICON = '<i class="fa-solid fa-drumstick-bite"></i>';
  const CONFIG_PATH = '/produccion/config';
  const RESERVAS_PATH = '/produccion/reservas';
  const DRAFTS_PATH = '/produccion/drafts';
  const REGISTROS_PATH = '/produccion/registros';
  const SEQUENCE_PATH = '/produccion/sequence';
  const AUDIT_PATH = '/produccion/auditoria';
  const RESERVE_TTL_MS = 10 * 60 * 1000;

  const state = {
    recetas: {},
    ingredientes: {},
    inventario: {},
    users: {},
    reservas: {},
    drafts: {},
    registros: {},
    search: '',
    view: 'loading',
    analysis: {},
    activeRecipeId: '',
    activeDraftId: '',
    activeReservationId: '',
    reservationTick: null,
    editorPlan: null,
    lotCollapseState: {},
    config: {
      globalMinKg: 1,
      recipeMinKg: {},
      lastProductionByRecipe: {},
      preferredManagers: [],
      preferredManagersByRecipe: {},
      usersPreferences: {},
      idConfig: { prefix: 'PROD-LJ' }
    }
  };

  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const capitalize = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (ch) => ch.toUpperCase());
  const parseNumber = (value) => {
    const parsed = Number(normalizeValue(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  const parsePositive = (value, fallback = 1) => {
    const n = parseNumber(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nowTs = () => Date.now();

  const sessionId = (() => {
    const key = 'laJamoneraProduccionSessionId';
    const current = normalizeValue(localStorage.getItem(key));
    if (current) return current;
    const next = makeId('prod_session');
    localStorage.setItem(key, next);
    return next;
  })();

  const getCurrentUserLabel = () => 'La Jamonera';

  const getUnitMeta = (unitRaw) => {
    const unit = normalizeLower(unitRaw);
    const massMap = {
      kg: 1000, kilo: 1000, kilos: 1000, kilogramo: 1000, kilogramos: 1000,
      g: 1, gr: 1, gramo: 1, gramos: 1,
      mg: 0.001, miligramo: 0.001, miligramos: 0.001
    };
    const volumeMap = {
      l: 1000, lt: 1000, litro: 1000, litros: 1000,
      ml: 1, mililitro: 1, mililitros: 1, cc: 1
    };
    if (massMap[unit]) return { category: 'peso', factor: massMap[unit], label: unit || 'g' };
    if (volumeMap[unit]) return { category: 'volumen', factor: volumeMap[unit], label: unit || 'ml' };
    if (['u', 'un', 'unidad', 'unidades'].includes(unit)) return { category: 'unidad', factor: 1, label: 'unidad' };
    if (['paquete', 'paquetes', 'pack', 'packs'].includes(unit)) return { category: 'paquete', factor: 1, label: 'paquete' };
    return { category: 'otro', factor: 1, label: unit || 'otro' };
  };

  const toBase = (qty, unit) => {
    const meta = getUnitMeta(unit);
    const amount = parseNumber(qty);
    if (!Number.isFinite(amount)) return Number.NaN;
    return amount * meta.factor;
  };

  const fromBase = (baseQty, unit) => {
    const meta = getUnitMeta(unit);
    return Number(baseQty || 0) / (meta.factor || 1);
  };

  const formatQty = (value, unit = '', digits = 2) => `${Number(value || 0).toFixed(digits)} ${unit}`.trim();
  const formatCompactQty = (value, unit = '') => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return formatQty(0, unit, 2);
    const digits = amount >= 10 ? 2 : 3;
    return `${amount.toFixed(digits)} ${unit}`.trim();
  };
  const toIsoDate = (value = nowTs()) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  };
  const formatDate = (value) => {
    if (!value) return 'Nunca producida';
    const d = new Date(Number(value));
    if (Number.isNaN(d.getTime())) return 'Nunca producida';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const formatDateTime = (value) => {
    const d = new Date(Number(value));
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const escapeHtml = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');


  const deepClone = (value) => JSON.parse(JSON.stringify(value || {}));
  const getRegistrosList = () => Object.values(safeObject(state.registros));

  const getGeneralPassword = async () => {
    await window.laJamoneraReady;
    const value = await window.dbLaJamoneraRest.read('/passGeneral/pass');
    return normalizeValue(value);
  };

  const askSensitivePassword = async (title, html, withReason = false) => {
    const result = await openIosSwal({
      title,
      html: `<div class="swal-stack-fields"><input id="produccionSecurePass" type="password" class="swal2-input ios-input" placeholder="Clave general">${withReason ? '<textarea id="produccionSecureReason" class="swal2-textarea ios-input" placeholder="Motivo"></textarea>' : ''}${html || ''}</div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Validar',
      cancelButtonText: 'Cancelar',
      preConfirm: async () => {
        const entered = normalizeValue(document.getElementById('produccionSecurePass')?.value);
        const remote = await getGeneralPassword();
        if (!entered || !remote || entered !== remote) {
          Swal.showValidationMessage('Clave incorrecta.');
          return false;
        }
        const reason = normalizeValue(document.getElementById('produccionSecureReason')?.value);
        if (withReason && !reason) {
          Swal.showValidationMessage('Ingresá un motivo.');
          return false;
        }
        return { reason };
      }
    });
    return result;
  };

  const appendAudit = async ({ action, productionId = '', before = null, after = null, reason = '' }) => {
    const existing = safeObject(await window.dbLaJamoneraRest.read(AUDIT_PATH));
    const id = makeId('audit');
    existing[id] = {
      id,
      action,
      productionId,
      user: getCurrentUserLabel(),
      reason: normalizeValue(reason),
      createdAt: nowTs(),
      before,
      after
    };
    await window.dbLaJamoneraRest.write(AUDIT_PATH, existing);
  };

  const updateEntryMovement = (entry, movement) => {
    const next = { ...entry };
    next.movementHistory = Array.isArray(next.movementHistory) ? next.movementHistory : [];
    next.movementHistory.unshift(movement);
    return next;
  };

  const applyPlanOnInventory = (inventorySource, plan, productionId, productionDate, mode = 'consume') => {
    const inventoryNext = safeObject(inventorySource);
    plan.ingredientPlans.forEach((item) => {
      const record = safeObject(inventoryNext.items?.[item.ingredientId]);
      const nextEntries = Array.isArray(record.entries) ? [...record.entries] : [];
      item.lots.forEach((lot) => {
        const index = nextEntries.findIndex((entry) => entry.id === lot.entryId);
        if (index === -1) return;
        const entry = { ...nextEntries[index] };
        const entryQty = parsePositive(entry.qty, 0);
        const amountInEntryUnit = fromBase(lot.takeBaseQty, entry.unit || lot.unit);
        const sign = mode === 'consume' ? -1 : 1;
        const nextQty = Math.max(0, Number((entryQty + (sign * amountInEntryUnit)).toFixed(4)));
        entry.qty = Number(nextQty.toFixed(2));
        entry.qtyKg = Number((toBase(nextQty, entry.unit) / 1000).toFixed(4));
        entry.lotStatus = nextQty <= 0 ? 'consumido_en_produccion' : 'disponible';
        const moveType = mode === 'consume' ? 'consumo_produccion' : 'reversion_produccion';
        nextEntries[index] = updateEntryMovement(entry, {
          type: moveType,
          productionId,
          qty: Number(amountInEntryUnit.toFixed(4)),
          qtyUnit: entry.unit || lot.unit,
          createdAt: nowTs(),
          productionDate,
          user: getCurrentUserLabel(),
          reference: productionId,
          observation: mode === 'consume' ? 'Consumo FEFO en producción' : 'Restitución por anulación/edición'
        });
      });
      const stockKg = nextEntries.reduce((acc, entry) => acc + (Number(entry.qtyKg || 0) || 0), 0);
      inventoryNext.items[item.ingredientId] = {
        ...record,
        entries: nextEntries,
        stockKg: Number(stockKg.toFixed(4))
      };
    });
    return inventoryNext;
  };

  const reportHtml = (registro) => {
    const lotRows = (registro.lots || []).map((item) => `
      <tr><td colspan="9" style="background:#eef3ff;font-weight:700">${escapeHtml(item.ingredientName || item.ingredientId)}</td></tr>
      ${(item.lots || []).map((lot) => `<tr>
        <td>${escapeHtml(lot.entryId || '-')}</td>
        <td>${escapeHtml(lot.entryDate || '-')}</td>
        <td>${escapeHtml(lot.expiryDate || '-')}</td>
        <td>${Number(lot.takeQty || 0).toFixed(2)}</td>
        <td>${escapeHtml(lot.unit || '')}</td>
        <td>${escapeHtml(lot.provider || '-')}</td>
        <td>${escapeHtml(lot.invoiceNumber || '-')}</td>
        <td>${Array.isArray(lot.invoiceImageUrls) ? lot.invoiceImageUrls.length : 0}</td>
        <td>${escapeHtml(lot.status || '-')}</td>
      </tr>`).join('')}
    `).join('');

    return `
      <div class="report-viewer-content-wrap" style="text-align:left">
        <h3 style="margin:0 0 6px">Informe de producción ${escapeHtml(registro.id)}</h3>
        <p><strong>Producto:</strong> ${escapeHtml(registro.recipeTitle || '-')} · <strong>Fecha:</strong> ${escapeHtml(registro.productionDate || '-')} · <strong>Estado:</strong> ${escapeHtml(registro.status || '-')}</p>
        <p><strong>Cantidad:</strong> ${Number(registro.quantityKg || 0).toFixed(2)} kg · <strong>Encargados:</strong> ${escapeHtml((registro.managers || []).join(', ') || 'Sin asignar')}</p>
        <p><strong>Observaciones:</strong> ${escapeHtml(registro.observations || '-')}</p>
        <div style="overflow:auto"><table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
          <thead><tr><th>Lote</th><th>Ingreso</th><th>Vence</th><th>Cantidad</th><th>Unidad</th><th>Proveedor</th><th>Factura</th><th>Imgs</th><th>Estado</th></tr></thead>
          <tbody>${lotRows || '<tr><td colspan="9">Sin lotes</td></tr>'}</tbody>
        </table></div>
      </div>`;
  };

  const initialsFromName = (value) => normalizeValue(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item.charAt(0).toUpperCase())
    .join('');

  const renderUserAvatar = (user) => {
    if (normalizeValue(user?.photoUrl)) {
      return `<span class="user-avatar-thumb"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-user-photo" src="${user.photoUrl}" alt="${normalizeValue(user.fullName || user.email || 'Usuario')}"></span>`;
    }
    const initials = initialsFromName(user?.fullName || user?.email || '');
    return `<span class="user-avatar-thumb user-avatar-initials">${initials || '<i class="bi bi-person-fill"></i>'}</span>`;
  };

  const prepareThumbLoaders = (selector) => {
    const list = Array.from(document.querySelectorAll(selector));
    list.forEach((img) => {
      const parent = img.closest('.user-avatar-thumb, .receta-thumb-wrap, .produccion-hero-avatar');
      const spinner = parent ? parent.querySelector('.thumb-loading') : null;
      const done = () => {
        img.classList.add('is-loaded');
        spinner?.remove();
      };
      if (img.complete && img.naturalWidth > 0) {
        done();
      } else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', () => { spinner?.remove(); }, { once: true });
      }
    });
  };

  const openIosSwal = (options) => Swal.fire({
    ...options,
    returnFocus: false,
    customClass: {
      popup: `ios-alert ${options?.customClass?.popup || ''}`.trim(),
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text',
      confirmButton: 'ios-btn ios-btn-primary',
      cancelButton: 'ios-btn ios-btn-secondary',
      denyButton: 'ios-btn ios-btn-warning',
      ...options.customClass
    },
    buttonsStyling: false
  });

  const readMinKgForRecipe = (recipeId) => {
    const local = parseNumber(state.config.recipeMinKg?.[recipeId]);
    if (Number.isFinite(local) && local > 0) return local;
    return parsePositive(state.config.globalMinKg, 1);
  };

  const persistConfig = async () => {
    await window.laJamoneraReady;
    await window.dbLaJamoneraRest.write(CONFIG_PATH, state.config);
  };

  const setStateView = (view) => {
    state.view = view;
    nodes.loading.classList.toggle('d-none', view !== 'loading');
    nodes.empty.classList.toggle('d-none', view !== 'empty');
    nodes.data.classList.toggle('d-none', view !== 'list');
    nodes.editor.classList.toggle('d-none', view !== 'editor');
  };

  const getRecipes = () => Object.values(safeObject(state.recetas));
  const getThumbPlaceholder = () => `<span class="image-placeholder-circle-2">${BASE_ICON}</span>`;

  const activeReservations = () => Object.values(safeObject(state.reservas))
    .filter((item) => Number(item?.expiresAt || 0) > nowTs() && item.status !== 'released');

  const reservedByOthersForEntry = (ingredientId, entryId, unit) => {
    const baseUnit = normalizeLower(unit);
    const baseMeta = getUnitMeta(baseUnit);
    return activeReservations().reduce((acc, reservation) => {
      if (reservation.ownerSessionId === sessionId) return acc;
      const locks = Array.isArray(reservation?.locks) ? reservation.locks : [];
      locks.forEach((lock) => {
        if (lock.ingredientId !== ingredientId) return;
        if (entryId && lock.entryId && lock.entryId !== entryId) return;
        const lockMeta = getUnitMeta(lock.unit || baseUnit);
        if (lockMeta.category !== baseMeta.category) return;
        const lockBase = Number(lock.reservedBaseQty || toBase(lock.reservedQty, lock.unit || baseUnit) || 0);
        acc += fromBase(lockBase, baseUnit);
      });
      return acc;
    }, 0);
  };

  const getInventoryAvailability = (ingredientId, targetUnit, productionDateIso = toIsoDate()) => {
    const record = safeObject(state.inventario.items?.[ingredientId]);
    const entries = Array.isArray(record.entries) ? record.entries : [];
    const targetMeta = getUnitMeta(targetUnit);

    if (!entries.length && targetMeta.category === 'peso') {
      const stockKg = Number(record.stockKg || 0);
      const base = Number.isFinite(stockKg) ? stockKg * 1000 : 0;
      const reserved = reservedByOthersForEntry(ingredientId, '', 'kg') * 1000;
      const net = Math.max(0, base - reserved);
      return {
        available: fromBase(net, targetUnit),
        total: fromBase(base, targetUnit),
        hasExpired: false,
        incompatibleUnits: [],
        nextToExpire: null
      };
    }

    const aggregate = entries.reduce((acc, entry) => {
      const qty = parseNumber(entry.qty);
      if (!Number.isFinite(qty) || qty <= 0) return acc;
      const entryMeta = getUnitMeta(entry.unit);
      const entryBase = qty * entryMeta.factor;
      const reservedQty = reservedByOthersForEntry(ingredientId, entry.id, entry.unit);
      const reservedBase = toBase(reservedQty, entry.unit);
      const netBase = Math.max(0, entryBase - (Number.isFinite(reservedBase) ? reservedBase : 0));
      const expiryIso = normalizeValue(entry.expiryDate);
      const expiredForDate = expiryIso && expiryIso < productionDateIso;
      if (entryMeta.category === targetMeta.category) {
        acc.totalBase += netBase;
        if (!expiredForDate) acc.usableBase += netBase;
      } else {
        acc.incompatible.push(entry.unit || 'sin unidad');
      }
      if (expiredForDate) acc.hasExpired = true;
      if (!acc.nextToExpire && expiryIso) acc.nextToExpire = expiryIso;
      return acc;
    }, { totalBase: 0, usableBase: 0, incompatible: [], hasExpired: false, nextToExpire: null });

    return {
      available: fromBase(aggregate.usableBase, targetUnit),
      total: fromBase(aggregate.totalBase, targetUnit),
      hasExpired: aggregate.hasExpired,
      incompatibleUnits: aggregate.incompatible,
      nextToExpire: aggregate.nextToExpire
    };
  };

  const analyzeRecipe = (recipe, productionDateIso = toIsoDate()) => {
    const rows = (Array.isArray(recipe.rows) ? recipe.rows : []).filter((row) => row.type === 'ingredient');
    const yieldQty = parseNumber(recipe.yieldQuantity);
    const yieldMeta = getUnitMeta(recipe.yieldUnit);
    const minKg = readMinKgForRecipe(recipe.id);

    if (!Number.isFinite(yieldQty) || yieldQty <= 0 || yieldMeta.category !== 'peso') {
      return {
        status: 'danger', statusText: 'Configuración inválida', maxKg: 0, progress: 0, canProduce: false,
        errors: ['La receta debe tener rendimiento en unidad de peso para calcular producción.'],
        requirements: [], missingForMin: [], hasExpired: false, minKg
      };
    }

    const yieldKg = toBase(yieldQty, recipe.yieldUnit) / 1000;
    const requirements = [];
    const errors = [];

    rows.forEach((row) => {
      const reqQty = parseNumber(row.quantity);
      const unit = normalizeLower(row.unit);
      if (!row.ingredientId || !Number.isFinite(reqQty) || reqQty <= 0 || !unit) return;
      const neededPerKg = reqQty / yieldKg;
      const availability = getInventoryAvailability(row.ingredientId, unit, productionDateIso);
      const coverage = neededPerKg > 0 ? Math.max(0, availability.available) / neededPerKg : 0;
      if (availability.incompatibleUnits.length) {
        errors.push(`Esta receta contiene unidades incompatibles para cálculo automático. Revisá ${capitalize(row.ingredientName)}.`);
      }
      requirements.push({
        ingredientId: row.ingredientId,
        name: capitalize(row.ingredientName || state.ingredientes[row.ingredientId]?.name || 'Ingrediente'),
        unit,
        neededPerKg,
        available: availability.available,
        coverage,
        missingForMin: Math.max(0, (neededPerKg * minKg) - availability.available),
        hasExpired: availability.hasExpired
      });
    });

    if (!requirements.length) {
      return {
        status: 'danger', statusText: 'Sin insumos', maxKg: 0, progress: 0, canProduce: false,
        errors: ['La receta no tiene ingredientes válidos para producción.'],
        requirements: [], missingForMin: [], hasExpired: false, minKg
      };
    }

    const minCoverage = Math.min(...requirements.map((item) => item.coverage));
    const maxKg = Math.max(0, minCoverage);
    const readyCount = requirements.filter((item) => item.missingForMin <= 0.0001).length;
    const progress = Math.max(0, Math.min(100, (readyCount / Math.max(requirements.length, 1)) * 100));
    const canProduce = maxKg >= minKg;
    const missingForMin = requirements.filter((item) => item.missingForMin > 0.0001);
    const hasExpired = requirements.some((item) => item.hasExpired);

    let status = 'danger';
    let statusText = 'Faltan insumos';
    if (canProduce) {
      status = 'success';
      statusText = 'Disponible';
    } else if (progress >= 50) {
      status = 'warning';
      statusText = 'Stock parcial';
    }

    return { status, statusText, maxKg, progress, canProduce, errors, requirements, missingForMin, hasExpired, minKg };
  };

  const sortEntriesFEFO = (entries = []) => [...entries].sort((a, b) => {
    const expiryA = normalizeValue(a.expiryDate) || '9999-12-31';
    const expiryB = normalizeValue(b.expiryDate) || '9999-12-31';
    if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
  });

  const buildPlanForRecipe = (recipe, qtyKg, productionDateIso = toIsoDate()) => {
    const analysis = analyzeRecipe(recipe, productionDateIso);
    const ingredientPlans = [];
    const conflicts = [];
    const warnings = [];

    analysis.requirements.forEach((requirement) => {
      const rowNeed = requirement.neededPerKg * qtyKg;
      let remaining = rowNeed;
      const record = safeObject(state.inventario.items?.[requirement.ingredientId]);
      const entries = sortEntriesFEFO(Array.isArray(record.entries) ? record.entries : []);
      const lots = [];

      entries.forEach((entry) => {
        const entryUnit = normalizeLower(entry.unit || requirement.unit);
        const entryMeta = getUnitMeta(entryUnit);
        const reqMeta = getUnitMeta(requirement.unit);
        if (entryMeta.category !== reqMeta.category) return;

        const entryQty = parsePositive(entry.qty, 0);
        const reservedByOther = reservedByOthersForEntry(requirement.ingredientId, entry.id, entryUnit);
        const available = Math.max(0, entryQty - reservedByOther);
        const expiryIso = normalizeValue(entry.expiryDate);
        const status = !expiryIso || expiryIso >= productionDateIso ? 'ok' : 'expired';
        const isSoon = expiryIso && expiryIso >= productionDateIso && expiryIso <= toIsoDate(new Date(productionDateIso).getTime() + 2 * 86400000);
        if (isSoon) warnings.push(`${requirement.name}: lote próximo a vencer (${expiryIso}).`);
        if (status === 'expired') return;

        const availableInReqUnit = fromBase(toBase(available, entryUnit), requirement.unit);
        const take = Math.min(remaining, availableInReqUnit);
        if (take <= 0) return;

        remaining = Number((remaining - take).toFixed(6));
        const lotNumber = normalizeValue(entry.lotNumber) || normalizeValue(entry.invoiceNumber) || entry.id;
        lots.push({
          ingredientId: requirement.ingredientId,
          ingredientName: requirement.name,
          ingredientImage: state.ingredientes[requirement.ingredientId]?.imageUrl || '',
          entryId: entry.id,
          lotNumber,
          entryDate: entry.entryDate || '',
          createdAt: Number(entry.createdAt || 0),
          expiryDate: expiryIso,
          provider: normalizeValue(entry.provider) || '-',
          invoiceNumber: normalizeValue(entry.invoiceNumber) || '-',
          invoiceImageUrls: Array.isArray(entry.invoiceImageUrls) ? entry.invoiceImageUrls : (entry.invoiceImageUrl ? [entry.invoiceImageUrl] : []),
          unit: requirement.unit,
          takeQty: Number(take.toFixed(4)),
          takeBaseQty: Number(toBase(take, requirement.unit).toFixed(6)),
          entryAvailableQty: Number(available.toFixed(4)),
          status: isSoon ? 'soon' : 'ok'
        });
      });

      const missing = Math.max(0, Number(remaining.toFixed(4)));
      if (missing > 0.0001) {
        conflicts.push(`${requirement.name}: faltan ${formatQty(missing, requirement.unit)} para la fecha ${productionDateIso}.`);
      }

      ingredientPlans.push({
        ingredientId: requirement.ingredientId,
        ingredientName: requirement.name,
        ingredientUnit: requirement.unit,
        neededQty: Number(rowNeed.toFixed(4)),
        availableQty: Number(requirement.available.toFixed(4)),
        missingQty: missing,
        lots
      });
    });

    const flatLocks = ingredientPlans.flatMap((item) => item.lots.map((lot) => ({
      ingredientId: lot.ingredientId,
      entryId: lot.entryId,
      reservedQty: lot.takeQty,
      reservedBaseQty: lot.takeBaseQty,
      unit: lot.unit,
      lotNumber: lot.lotNumber
    })));

    return {
      recipeId: recipe.id,
      qtyKg: Number(qtyKg.toFixed(2)),
      productionDate: productionDateIso,
      ingredientPlans,
      locks: flatLocks,
      warnings,
      conflicts,
      isValid: conflicts.length === 0
    };
  };

  const cleanupExpiredReservations = async () => {
    const now = nowTs();
    const reservas = safeObject(await window.dbLaJamoneraRest.read(RESERVAS_PATH));
    const updates = { ...reservas };
    let changed = false;
    Object.entries(reservas).forEach(([id, reservation]) => {
      if (!reservation) return;
      if (Number(reservation.expiresAt || 0) <= now && reservation.status === 'active') {
        updates[id] = { ...reservation, status: 'released', releasedAt: now, releasedReason: 'expired' };
        changed = true;
      }
    });
    if (changed) await window.dbLaJamoneraRest.write(RESERVAS_PATH, updates);
    state.reservas = changed ? updates : reservas;
  };

  const releaseReservation = async (reason = 'manual') => {
    if (!state.activeReservationId) return;
    const reservation = safeObject(state.reservas[state.activeReservationId]);
    if (!reservation || reservation.status !== 'active') {
      state.activeReservationId = '';
      return;
    }
    const next = {
      ...reservation,
      status: 'released',
      releasedAt: nowTs(),
      releasedReason: reason
    };
    const updated = { ...state.reservas, [state.activeReservationId]: next };
    await window.dbLaJamoneraRest.write(RESERVAS_PATH, updated);
    state.reservas = updated;
    state.activeReservationId = '';
    if (state.reservationTick) {
      clearInterval(state.reservationTick);
      state.reservationTick = null;
    }
  };

  const ensureReservationForPlan = async (plan) => {
    if (!plan?.locks?.length) return;
    if (state.activeReservationId) await releaseReservation('refresh');
    const reservationId = makeId('reserva');
    const reservation = {
      id: reservationId,
      recipeId: plan.recipeId,
      draftId: state.activeDraftId || '',
      ownerSessionId: sessionId,
      ownerLabel: getCurrentUserLabel(),
      createdAt: nowTs(),
      expiresAt: nowTs() + RESERVE_TTL_MS,
      status: 'active',
      locks: plan.locks
    };
    const next = { ...state.reservas, [reservationId]: reservation };
    await window.dbLaJamoneraRest.write(RESERVAS_PATH, next);
    state.reservas = next;
    state.activeReservationId = reservationId;

    if (state.reservationTick) clearInterval(state.reservationTick);
    state.reservationTick = setInterval(async () => {
      const remaining = Number(reservation.expiresAt || 0) - nowTs();
      const badge = nodes.editor.querySelector('#produccionReservaTimer');
      if (badge) {
        const mins = Math.max(0, Math.ceil(remaining / 60000));
        badge.textContent = `Reserva temporal: ${mins} min`;
      }
      if (remaining <= 0) {
        await releaseReservation('expired');
        await openIosSwal({
          title: 'Reserva vencida',
          html: '<p>La reserva temporal de stock venció. Recalculamos disponibilidad.</p>',
          icon: 'warning',
          confirmButtonText: 'Entendido'
        });
        await refreshData();
        renderList();
      }
    }, 5000);
  };

  const persistDraft = async (payload) => {
    const draftId = `${sessionId}_${payload.recipeId}`;
    const draft = {
      id: draftId,
      ownerSessionId: sessionId,
      ownerLabel: getCurrentUserLabel(),
      updatedAt: nowTs(),
      ...payload
    };
    const next = { ...state.drafts, [draftId]: draft };
    await window.dbLaJamoneraRest.write(DRAFTS_PATH, next);
    state.drafts = next;
    state.activeDraftId = draftId;
  };

  const discardDraft = async () => {
    if (!state.activeDraftId) return;
    const next = { ...state.drafts };
    delete next[state.activeDraftId];
    await window.dbLaJamoneraRest.write(DRAFTS_PATH, next);
    state.drafts = next;
    state.activeDraftId = '';
  };

  const getCurrentDraftForRecipe = (recipeId) => {
    const own = Object.values(safeObject(state.drafts)).find((item) => item.recipeId === recipeId && item.ownerSessionId === sessionId);
    return own || null;
  };

  const getOwnDrafts = () => Object.values(safeObject(state.drafts))
    .filter((item) => item.ownerSessionId === sessionId && item.status === 'active' && item.recipeId)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

  const getForeignDraftConflict = (recipeId) => Object.values(safeObject(state.drafts)).find((item) => item.recipeId === recipeId && item.ownerSessionId !== sessionId);

  const openGlobalMinConfig = async () => {
    const result = await openIosSwal({
      title: 'Umbral por producto',
      html: `<div class="produccion-umbral-form">
          <label for="produccionGlobalMinInput">Umbral de stock (kg)</label>
          <input id="produccionGlobalMinInput" type="number" min="0.1" step="0.1" class="swal2-input ios-input" value="${Number(state.config.globalMinKg || 1).toFixed(2)}">
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const value = document.getElementById('produccionGlobalMinInput')?.value;
        const n = parseNumber(value);
        if (!Number.isFinite(n) || n <= 0) {
          Swal.showValidationMessage('Ingresá un valor mayor a 0.');
          return false;
        }
        return n;
      },
      customClass: { popup: 'produccion-umbral-alert' }
    });
    if (!result.isConfirmed) return;
    state.config.globalMinKg = Number(result.value.toFixed(2));
    await persistConfig();
    recomputeAnalysis();
    renderList();
  };

  const openRecipeMinConfig = async (recipeId) => {
    const currentRaw = state.config.recipeMinKg?.[recipeId];
    const result = await openIosSwal({
      title: 'Umbral por producto',
      html: `<div class="produccion-umbral-form">
          <label for="produccionRecipeMinInput">Umbral de stock (kg)</label>
          <input id="produccionRecipeMinInput" type="number" min="0.1" step="0.1" class="swal2-input ios-input" value="${normalizeValue(currentRaw)}" placeholder="Vacío = usar global">
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const value = normalizeValue(document.getElementById('produccionRecipeMinInput')?.value);
        if (!value) return null;
        const n = parseNumber(value);
        if (!Number.isFinite(n) || n <= 0) {
          Swal.showValidationMessage('Ingresá un valor mayor a 0 o dejá vacío para usar global.');
          return false;
        }
        return n;
      },
      customClass: { popup: 'produccion-umbral-alert' }
    });
    if (!result.isConfirmed) return;
    if (result.value == null) {
      delete state.config.recipeMinKg[recipeId];
    } else {
      state.config.recipeMinKg[recipeId] = Number(result.value.toFixed(2));
    }
    await persistConfig();
    recomputeAnalysis();
    renderList();
  };


  const markProductionExport = async (productionId, type) => {
    const registros = deepClone(state.registros);
    const reg = registros[productionId];
    if (!reg) return;
    reg.exports = safeObject(reg.exports);
    reg.exports[type] = nowTs();
    reg.auditTrail = Array.isArray(reg.auditTrail) ? reg.auditTrail : [];
    reg.auditTrail.unshift({ action: `export_${type}`, user: getCurrentUserLabel(), at: nowTs() });
    registros[productionId] = reg;
    await window.dbLaJamoneraRest.write(REGISTROS_PATH, registros);
    state.registros = registros;
  };

  const printReport = async (registro) => {
    const include = await openIosSwal({
      title: 'Imprimir informe',
      html: '<p>¿Incluir facturas, remitos e imágenes adjuntas?</p>',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Sí, incluir',
      denyButtonText: 'No incluir',
      cancelButtonText: 'Cancelar',
      customClass: { denyButton: 'ios-btn ios-btn-danger' }
    });
    if (include.isDismissed || include.isCanceled) return;
    const win = window.open('', '_blank', 'width=1200,height=900');
    if (!win) return;
    win.document.write(`<html><head><title>${registro.id}</title></head><body>${reportHtml(registro)}${include.isDenied ? '<p><em>Adjuntos excluidos por el usuario.</em></p>' : ''}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
    await markProductionExport(registro.id, 'print');
  };

  const exportProductionExcel = async (registro) => {
    if (!window.ExcelJS) {
      await openIosSwal({ title: 'Excel no disponible', html: '<p>No se pudo cargar ExcelJS.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      return;
    }
    const wb = new window.ExcelJS.Workbook();
    const ws = wb.addWorksheet('Producción');
    ws.columns = [
      { header: 'Producción', key: 'id', width: 22 },
      { header: 'Producto', key: 'producto', width: 24 },
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Cantidad kg', key: 'kg', width: 14 },
      { header: 'Ingrediente', key: 'ingrediente', width: 24 },
      { header: 'Lote', key: 'lote', width: 22 },
      { header: 'Cantidad usada', key: 'cantidad', width: 16 },
      { header: 'Unidad', key: 'unit', width: 10 },
      { header: 'Proveedor', key: 'proveedor', width: 20 },
      { header: 'Factura', key: 'factura', width: 18 }
    ];
    (registro.lots || []).forEach((item) => {
      (item.lots || []).forEach((lot) => {
        ws.addRow({
          id: registro.id,
          producto: registro.recipeTitle,
          fecha: registro.productionDate,
          kg: Number(registro.quantityKg || 0),
          ingrediente: item.ingredientName || item.ingredientId,
          lote: lot.entryId,
          cantidad: Number(lot.takeQty || 0),
          unit: lot.unit,
          proveedor: lot.provider || '-',
          factura: lot.invoiceNumber || '-'
        });
      });
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${registro.id}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    await markProductionExport(registro.id, 'excel');
  };

  const exportProductionPdf = async (registro) => {
    if (!window.jspdf?.jsPDF) {
      await openIosSwal({ title: 'PDF no disponible', html: '<p>No se pudo cargar jsPDF.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      return;
    }
    const doc = new window.jspdf.jsPDF();
    doc.setFontSize(12);
    doc.text(`Producción ${registro.id}`, 10, 12);
    doc.text(`Producto: ${registro.recipeTitle || '-'}`, 10, 20);
    doc.text(`Fecha: ${registro.productionDate || '-'} / Estado: ${registro.status || '-'}`, 10, 28);
    doc.text(`Cantidad: ${Number(registro.quantityKg || 0).toFixed(2)} kg`, 10, 36);
    doc.text(`Encargados: ${(registro.managers || []).join(', ') || '-'}`, 10, 44);
    doc.text(`Observaciones: ${registro.observations || '-'}`, 10, 52);
    doc.save(`${registro.id}.pdf`);
    await markProductionExport(registro.id, 'pdf');
  };

  const openTraceability = async (registro) => {
    const html = `<div class="report-viewer-content-wrap"><div id="prodTraceBody" style="transform-origin:top left">
      <p><strong>${escapeHtml(registro.recipeTitle || registro.id)}</strong></p>
      <ul>${(registro.lots || []).map((i) => `<li>${escapeHtml(i.ingredientName || i.ingredientId)}<ul>${(i.lots || []).map((lot) => `<li>Lote ${escapeHtml(lot.entryId || '-')} · ${Number(lot.takeQty || 0).toFixed(2)} ${escapeHtml(lot.unit || '')}</li>`).join('')}</ul></li>`).join('')}</ul>
    </div></div>
    <div class="image-viewer-controls"><button id="traceZoomOut" class="btn ios-btn ios-btn-secondary" type="button"><i class="fa-solid fa-magnifying-glass-minus"></i></button><button id="traceZoomIn" class="btn ios-btn ios-btn-secondary" type="button"><i class="fa-solid fa-magnifying-glass-plus"></i></button></div>`;
    let zoom = 1;
    await openIosSwal({
      title: 'Trazabilidad visual',
      html,
      width: '80vw',
      confirmButtonText: 'Cerrar',
      didOpen: (popup) => {
        const body = popup.querySelector('#prodTraceBody');
        const apply = () => { if (body) body.style.transform = `scale(${zoom})`; };
        popup.querySelector('#traceZoomOut')?.addEventListener('click', () => { zoom = Math.max(0.6, zoom - 0.1); apply(); });
        popup.querySelector('#traceZoomIn')?.addEventListener('click', () => { zoom = Math.min(2.2, zoom + 0.1); apply(); });
      }
    });
  };

  const openHistory = async () => {
    const registros = getRegistrosList().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const table = `<div class="report-viewer-content-wrap"><table class="table recipe-table"><thead><tr><th>ID</th><th>Fecha</th><th>Producto</th><th>Kg</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${registros.map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.productionDate || '-')}</td><td>${escapeHtml(item.recipeTitle || '-')}</td><td>${Number(item.quantityKg || 0).toFixed(2)}</td><td>${escapeHtml(item.status || '-')}</td><td><div class="report-comment-actions"><button type="button" class="report-comment-reply-btn" data-prod-report="${item.id}">Informe</button><button type="button" class="report-comment-reply-btn" data-prod-print="${item.id}">Imprimir</button><button type="button" class="report-comment-reply-btn" data-prod-excel="${item.id}">Excel</button><button type="button" class="report-comment-reply-btn" data-prod-pdf="${item.id}">PDF</button><button type="button" class="report-comment-reply-btn" data-prod-trace="${item.id}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"> Trazabilidad</button><button type="button" class="report-comment-reply-btn" data-prod-edit="${item.id}">Editar</button><button type="button" class="report-comment-reply-btn is-danger" data-prod-cancel="${item.id}">Anular</button></div></td></tr>`).join('') || '<tr><td colspan="6">Sin producciones guardadas.</td></tr>'}</tbody></table></div>`;

    await openIosSwal({
      title: 'Producciones guardadas',
      html: table,
      width: '95vw',
      confirmButtonText: 'Cerrar',
      didOpen: (popup) => {
        const find = (id) => state.registros[id];
        popup.querySelectorAll('[data-prod-report]').forEach((btn) => btn.addEventListener('click', async () => {
          const reg = find(btn.dataset.prodReport);
          if (!reg) return;
          await openIosSwal({ title: `Informe ${reg.id}`, html: reportHtml(reg), width: '90vw', confirmButtonText: 'Cerrar' });
        }));
        popup.querySelectorAll('[data-prod-print]').forEach((btn) => btn.addEventListener('click', async () => { const reg = find(btn.dataset.prodPrint); if (reg) await printReport(reg); }));
        popup.querySelectorAll('[data-prod-excel]').forEach((btn) => btn.addEventListener('click', async () => { const reg = find(btn.dataset.prodExcel); if (reg) await exportProductionExcel(reg); }));
        popup.querySelectorAll('[data-prod-pdf]').forEach((btn) => btn.addEventListener('click', async () => { const reg = find(btn.dataset.prodPdf); if (reg) await exportProductionPdf(reg); }));
        popup.querySelectorAll('[data-prod-trace]').forEach((btn) => btn.addEventListener('click', async () => { const reg = find(btn.dataset.prodTrace); if (reg) await openTraceability(reg); }));
        popup.querySelectorAll('[data-prod-cancel]').forEach((btn) => btn.addEventListener('click', async () => { const reg = find(btn.dataset.prodCancel); if (reg) await cancelProduction(reg); }));
        popup.querySelectorAll('[data-prod-edit]').forEach((btn) => btn.addEventListener('click', async () => { const reg = find(btn.dataset.prodEdit); if (reg) await editProduction(reg); }));
      }
    });
  };

  const cancelProduction = async (registro) => {
    if (registro.status === 'anulada') {
      await openIosSwal({ title: 'Ya anulada', html: '<p>La producción ya estaba anulada.</p>', icon: 'info', confirmButtonText: 'Entendido' });
      return;
    }
    const auth = await askSensitivePassword('Anular producción', '<p>Se restituirá stock al inventario.</p>', true);
    if (!auth.isConfirmed) return;
    const latestInventory = safeObject(await window.dbLaJamoneraRest.read('/inventario'));
    const restored = applyPlanOnInventory(latestInventory, { ingredientPlans: registro.lots || [] }, registro.id, registro.productionDate, 'restore');
    const registros = deepClone(state.registros);
    const previous = deepClone(registros[registro.id]);
    registros[registro.id] = { ...registro, status: 'anulada', canceledAt: nowTs(), canceledBy: getCurrentUserLabel(), cancelReason: auth.value.reason };
    await window.dbLaJamoneraRest.write('/inventario', restored);
    await window.dbLaJamoneraRest.write(REGISTROS_PATH, registros);
    await appendAudit({ action: 'produccion_anulada', productionId: registro.id, before: previous, after: registros[registro.id], reason: auth.value.reason });
    state.inventario = restored;
    state.registros = registros;
    await openIosSwal({ title: 'Producción anulada', html: `<p>Se anuló ${registro.id} y se restituyó el stock.</p>`, icon: 'success', confirmButtonText: 'Entendido' });
  };

  const editProduction = async (registro) => {
    if (registro.status === 'anulada') {
      await openIosSwal({ title: 'No editable', html: '<p>Una producción anulada no puede editarse.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }
    const auth = await askSensitivePassword('Editar producción', '<p>Se recalculará el consumo FEFO.</p>', true);
    if (!auth.isConfirmed) return;
    const form = await openIosSwal({
      title: `Editar ${registro.id}`,
      html: `<div class="swal-stack-fields"><input id="editQty" type="number" min="0.1" step="0.01" class="swal2-input ios-input" value="${Number(registro.quantityKg || 0).toFixed(2)}"><input id="editDate" type="date" class="swal2-input ios-input" value="${registro.productionDate || toIsoDate()}"><textarea id="editObs" class="swal2-textarea ios-input">${escapeHtml(registro.observations || '')}</textarea></div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar cambios',
      cancelButtonText: 'Cancelar',
      preConfirm: () => ({ qty: parsePositive(document.getElementById('editQty')?.value, 0), date: normalizeValue(document.getElementById('editDate')?.value), obs: normalizeValue(document.getElementById('editObs')?.value) })
    });
    if (!form.isConfirmed) return;

    const recipe = state.recetas[registro.recipeId];
    if (!recipe) return;
    const currentInventory = safeObject(await window.dbLaJamoneraRest.read('/inventario'));
    const restored = applyPlanOnInventory(currentInventory, { ingredientPlans: registro.lots || [] }, registro.id, registro.productionDate, 'restore');
    const backup = state.inventario;
    state.inventario = restored;
    const plan = buildPlanForRecipe(recipe, form.value.qty, form.value.date || toIsoDate());
    state.inventario = backup;
    if (!plan.isValid) {
      await openIosSwal({ title: 'No se puede editar', html: `<p>${plan.conflicts.join('<br>')}</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }
    const consumed = applyPlanOnInventory(restored, plan, registro.id, form.value.date || toIsoDate(), 'consume');
    const registros = deepClone(state.registros);
    const prev = deepClone(registros[registro.id]);
    registros[registro.id] = {
      ...registro,
      quantityKg: Number(form.value.qty.toFixed(2)),
      productionDate: form.value.date || toIsoDate(),
      observations: form.value.obs,
      lots: plan.ingredientPlans,
      editedAt: nowTs(),
      editedBy: getCurrentUserLabel(),
      editReason: auth.value.reason
    };
    await window.dbLaJamoneraRest.write('/inventario', consumed);
    await window.dbLaJamoneraRest.write(REGISTROS_PATH, registros);
    await appendAudit({ action: 'produccion_editada', productionId: registro.id, before: prev, after: registros[registro.id], reason: auth.value.reason });
    state.inventario = consumed;
    state.registros = registros;
    await openIosSwal({ title: 'Producción editada', html: `<p>${registro.id} fue recalculada y guardada.</p>`, icon: 'success', confirmButtonText: 'Entendido' });
  };

  const renderList = () => {
    const query = normalizeLower(state.search);
    const list = getRecipes()
      .filter((item) => !query || normalizeLower(item.title).includes(query) || normalizeLower(item.description).includes(query))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

    if (!list.length) {
      nodes.list.innerHTML = '<div class="ingrediente-empty-list">No hay recetas para ese filtro.</div>';
      setStateView(getRecipes().length ? 'list' : 'empty');
      return;
    }

    const buildCoverageChecksHtml = (analysis) => {
      const available = analysis.requirements.filter((item) => item.missingForMin <= 0.0001).length;
      return `
        <div class="produccion-checks-head">${available}/${analysis.requirements.length} ingredientes listos</div>
        <div class="produccion-checks-list">${analysis.requirements.map((item) => `
          <span class="produccion-check-item ${item.missingForMin <= 0.0001 ? 'is-ok' : 'is-missing'}">
            <i class="fa-solid ${item.missingForMin <= 0.0001 ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
            <span>${item.name}</span>
          </span>`).join('')}
        </div>`;
    };

    const cardsHtml = list.map((recipe) => {
      const analysis = state.analysis[recipe.id] || analyzeRecipe(recipe);
      const statusClass = analysis.status === 'success' ? 'tone-success' : analysis.status === 'warning' ? 'tone-warning' : 'tone-danger';
      const action = analysis.canProduce
        ? `<button type="button" class="btn ios-btn ios-btn-success produccion-main-btn" data-open-produccion="${recipe.id}"><i class="bi bi-plus-lg"></i><span>Producir</span></button>`
        : `<button type="button" class="btn ios-btn produccion-to-inventario-btn" data-open-inventario="1"><i class="fa-solid fa-boxes-stacked"></i><span>Inventario</span></button>`;

      const foreignDraft = getForeignDraftConflict(recipe.id);
      const badges = [
        analysis.missingForMin.length ? '<span class="produccion-badge">Faltan insumos</span>' : '',
        analysis.status === 'warning' ? '<span class="produccion-badge is-warning">Stock parcial</span>' : '',
        analysis.hasExpired ? '<span class="produccion-badge is-danger">Vencido</span>' : '',
        foreignDraft ? '<span class="produccion-badge is-warning">Borrador en uso</span>' : ''
      ].filter(Boolean).join('');

      const missingHtml = analysis.missingForMin.length
        ? `<div class="produccion-missing-list">${analysis.missingForMin.map((item) => `<p><strong>${item.name}:</strong> disponible ${formatQty(item.available, item.unit)} / faltan ${formatQty(item.missingForMin, item.unit)}</p>`).join('')}</div>`
        : '<p class="produccion-ok-line">Cobertura suficiente para iniciar producción.</p>';

      const lastProductionAt = state.config.lastProductionByRecipe?.[recipe.id] || recipe.lastProductionAt || recipe.production?.lastAt || 0;

      return `
        <article class="ingrediente-card receta-card produccion-card ${statusClass}">
          <div class="ingrediente-avatar receta-thumb-wrap">
            ${recipe.imageUrl
              ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="receta-thumb js-produccion-thumb" src="${recipe.imageUrl}" alt="${capitalize(recipe.title || 'Receta')}" loading="lazy">`
              : getThumbPlaceholder()}
          </div>
          <div class="ingrediente-main receta-main">
            <div class="produccion-row-head">
              <h6 class="ingrediente-name receta-name">${capitalize(recipe.title || 'Sin título')}</h6>
              <span class="produccion-chip ${statusClass}"><span class="produccion-semaforo"></span>${analysis.statusText}</span>
            </div>
            <div class="produccion-stats-line">
              <div class="produccion-stat-block">
                <small>Máximo producible</small>
                <strong>${analysis.maxKg.toFixed(2)} kg</strong>
              </div>
              <div class="produccion-stat-sep" aria-hidden="true"></div>
              <div class="produccion-stat-block">
                <small>Mínimo</small>
                <strong>${analysis.minKg.toFixed(2)} kg</strong>
              </div>
            </div>
            <p class="produccion-last-line"><i class="fa-regular fa-clock"></i> Última producción: <strong>${formatDate(lastProductionAt)}</strong></p>
            <div class="produccion-progress-wrap">
              <div class="produccion-progress-bar"><span style="width:${analysis.progress.toFixed(1)}%"></span></div>
              <small>Cobertura del mínimo: ${analysis.progress.toFixed(0)}%</small>
            </div>
            ${buildCoverageChecksHtml(analysis)}
            <div class="produccion-badges">${badges}</div>
            ${analysis.errors.length ? `<p class="produccion-error">${analysis.errors[0]}</p>` : missingHtml}
            <div class="produccion-actions-row">
              ${action}
              <button type="button" class="btn ios-btn ios-btn-secondary produccion-umbral-btn" data-set-recipe-min="${recipe.id}"><i class="fa-solid fa-sliders"></i><span>Umbral</span></button>
            </div>
          </div>
        </article>`;
    }).join('');

    const drafts = getOwnDrafts();
    const draftsHtml = drafts.length
      ? `<section class="produccion-drafts-wrap">
          <h6 class="step-title"><span class="recipe-step-number">B</span> Borradores</h6>
          <div class="produccion-drafts-grid">${drafts.map((draft) => {
            const recipe = state.recetas[draft.recipeId] || {};
            return `<article class="produccion-draft-card">
              <div>
                <strong>${capitalize(recipe.title || 'Receta')}</strong>
                <small>Actualizado: ${formatDateTime(draft.updatedAt)}</small>
              </div>
              <div class="produccion-draft-actions">
                <button type="button" class="btn ios-btn ios-btn-secondary" data-open-draft="${draft.id}"><i class="fa-solid fa-pen"></i><span>Continuar</span></button>
                <button type="button" class="btn ios-btn ios-btn-warning" data-delete-draft="${draft.id}"><i class="fa-solid fa-trash"></i><span>Descartar</span></button>
              </div>
            </article>`;
          }).join('')}</div>
        </section>`
      : '';

    nodes.list.innerHTML = `${draftsHtml}${cardsHtml}`;

    document.querySelectorAll('.js-produccion-thumb').forEach((image) => {
      const wrap = image.closest('.receta-thumb-wrap');
      image.addEventListener('error', () => {
        if (wrap) wrap.innerHTML = getThumbPlaceholder();
      }, { once: true });
    });
    prepareThumbLoaders('.js-produccion-thumb');

    setStateView('list');
  };

  const buildLotsBreakdownHtml = (plan) => {
    const mergeIcon = './IMG/Octicons-git-merge.svg';
    const allExpanded = plan.ingredientPlans.every((row) => state.lotCollapseState[row.ingredientId] !== true);
    const allCollapsed = plan.ingredientPlans.every((row) => state.lotCollapseState[row.ingredientId] === true);
    const getExpiryBadge = (expiryDate) => {
      const expiry = normalizeValue(expiryDate);
      if (!expiry) return '<span class="produccion-expiry-badge is-unknown">Sin fecha</span>';
      const days = Math.ceil((new Date(`${expiry}T00:00:00`).getTime() - new Date(`${plan.productionDate}T00:00:00`).getTime()) / 86400000);
      if (days < 0) return `<span class="produccion-expiry-badge is-danger">Vencido ${Math.abs(days)}d</span>`;
      if (days <= 2) return `<span class="produccion-expiry-badge is-danger">${days}d</span>`;
      if (days <= 4) return `<span class="produccion-expiry-badge is-warning">${days}d</span>`;
      return `<span class="produccion-expiry-badge is-ok">${days}d</span>`;
    };

    return `<div class="produccion-lote-global-actions">
        <button type="button" class="btn ios-btn ios-btn-secondary" id="produccionCollapseAllBtn" ${allCollapsed ? 'disabled' : ''}>Colapsar todo</button>
        <button type="button" class="btn ios-btn ios-btn-secondary" id="produccionExpandAllBtn" ${allExpanded ? 'disabled' : ''}>Descolapsar todo</button>
      </div>` + plan.ingredientPlans.map((row) => `
      <article class="produccion-lote-group ${row.missingQty > 0 ? 'is-missing' : ''}" data-lot-group="${row.ingredientId}">
        <header class="produccion-lote-head">
          <div class="produccion-lote-main">
            <img src="${state.ingredientes[row.ingredientId]?.imageUrl || FIAMBRES_IMAGE}" alt="${row.ingredientName}" class="produccion-lote-ingredient-image">
            <div>
              <h6>${row.ingredientName}</h6>
              <p>
                <span class="produccion-needs-label">Necesita</span>
                <strong class="produccion-needs-value">${formatCompactQty(row.neededQty, row.ingredientUnit)}</strong>
                <span class="produccion-available-value">· Disponible <strong>${formatCompactQty(row.availableQty, row.ingredientUnit)}</strong></span>
                ${row.missingQty > 0 ? ` <em>· Faltan ${formatCompactQty(row.missingQty, row.ingredientUnit)}</em>` : ''}
              </p>
            </div>
          </div>
          <div class="produccion-lote-head-actions">
            <button type="button" class="btn ios-btn ios-btn-secondary produccion-lote-toggle-btn" data-lot-toggle="${row.ingredientId}">
              <i class="fa-solid ${state.lotCollapseState[row.ingredientId] ? 'fa-chevron-down' : 'fa-chevron-up'}"></i>
              <span>${state.lotCollapseState[row.ingredientId] ? 'Desplegar' : 'Colapsar'}</span>
            </button>
            <img src="${mergeIcon}" alt="Desglose" class="produccion-merge-icon" width="20" height="20" style="width:20px;height:20px;">
          </div>
        </header>
        <div class="produccion-lote-rows ${state.lotCollapseState[row.ingredientId] ? 'is-collapsed' : ''}">
          ${row.lots.length ? row.lots.map((lot) => `
          <div class="produccion-lote-row tone-${lot.status}">
            <div><strong class="produccion-lote-key">Lote:</strong> <span class="produccion-lote-value">${lot.lotNumber}</span></div>
            <div><strong>Ingreso:</strong> ${lot.entryDate || formatDateTime(lot.createdAt)}</div>
            <div><strong>Vence:</strong> ${lot.expiryDate || '-'} ${getExpiryBadge(lot.expiryDate)}</div>
            <div><strong>Usar:</strong> ${formatCompactQty(lot.takeQty, lot.unit)}</div>
            <div><strong class="produccion-provider-key">Proveedor:</strong> ${lot.provider || '-'}</div>
            <div><strong>Factura:</strong> ${lot.invoiceNumber || '-'}</div>
            <div class="produccion-lote-adjuntos-row"><strong>Adjuntos:</strong> ${lot.invoiceImageUrls.length
              ? `<button type="button" class="btn ios-btn ios-btn-secondary produccion-lote-adjuntos-btn" data-lot-images="${encodeURIComponent(JSON.stringify(lot.invoiceImageUrls))}"><i class="fa-regular fa-image"></i><span>Ver (${lot.invoiceImageUrls.length})</span></button>`
              : '<span>Sin adjuntos</span>'}</div>
          </div>`).join('<hr class="produccion-lote-separator">') : '<p class="produccion-lote-empty">Sin lotes aptos para la fecha elegida.</p>'}
        </div>
      </article>
    `).join('');
  };

  const saveEditorDraft = async () => {
    const recipe = state.recetas[state.activeRecipeId];
    if (!recipe || !state.editorPlan) return;
    const qty = parsePositive(nodes.editor.querySelector('#produccionQtyInput')?.value, state.editorPlan.qtyKg || 1);
    const productionDate = normalizeValue(nodes.editor.querySelector('#produccionDateInput')?.value) || toIsoDate();
    const observations = normalizeValue(nodes.editor.querySelector('#produccionObsInput')?.value);
    const managers = [...nodes.editor.querySelectorAll('[data-manager-check]:checked')].map((node) => node.value).filter(Boolean);

    await persistDraft({
      recipeId: recipe.id,
      quantityKg: qty,
      productionDate,
      managers,
      observations,
      locks: state.editorPlan.locks,
      lotPlan: state.editorPlan,
      reservationId: state.activeReservationId,
      step: 'editor',
      status: 'active'
    });
  };

  const buildManagersHtml = (selected = []) => {
    const users = Object.values(safeObject(state.users))
      .sort((a, b) => String(a.fullName || a.email || '').localeCompare(String(b.fullName || b.email || '')));
    if (!users.length) return '<p class="produccion-empty-users">No hay usuarios cargados. Podés continuar sin asignar encargados.</p>';
    return users.map((user) => {
      const fullName = normalizeValue(user.fullName || user.name || user.email || 'Usuario');
      const userId = normalizeValue(user.id) || normalizeValue(user.email) || `user_${normalizeLower(fullName).replace(/[^a-z0-9]+/g, '_')}`;
      const position = normalizeValue(user.position || user.role || 'Sin puesto');
      return `<label class="produccion-user-check">
        <input type="checkbox" data-manager-check value="${userId}" ${selected.includes(userId) ? 'checked' : ''}>
        ${renderUserAvatar(user)}
        <span class="produccion-user-text"><strong>${fullName}</strong><small>${position}</small></span>
      </label>`;
    }).join('');
  };

  const renderEditor = async (recipeId) => {
    const recipe = state.recetas[recipeId];
    const analysis = state.analysis[recipeId];
    if (!recipe || !analysis) return;

    const foreignDraft = getForeignDraftConflict(recipe.id);
    if (foreignDraft) {
      const action = await openIosSwal({
        title: 'Conflicto de borrador',
        html: `<p>Existe un borrador en uso para esta receta por ${foreignDraft.ownerLabel || 'otro usuario'}.</p>`,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Cancelar borrador y continuar',
        denyButtonText: 'Cargar borrador',
        cancelButtonText: 'Volver'
      });
      if (action.isDismissed) return;
      if (action.isDenied) {
        state.activeDraftId = foreignDraft.id;
      } else if (action.isConfirmed) {
        const next = { ...state.drafts };
        delete next[foreignDraft.id];
        await window.dbLaJamoneraRest.write(DRAFTS_PATH, next);
        state.drafts = next;
      }
    }

    const ownDraft = getCurrentDraftForRecipe(recipe.id);
    const preferredManagers = Array.isArray(state.config.preferredManagersByRecipe?.[recipe.id])
      ? state.config.preferredManagersByRecipe[recipe.id]
      : (Array.isArray(state.config.preferredManagers) ? state.config.preferredManagers : []);
    const initialQty = ownDraft ? parsePositive(ownDraft.quantityKg, analysis.minKg) : Math.max(analysis.minKg, 0.1);
    const initialDate = ownDraft?.productionDate || toIsoDate();
    const initialObs = ownDraft?.observations || '';
    const initialManagers = Array.isArray(ownDraft?.managers) ? ownDraft.managers : preferredManagers;

    state.lotCollapseState = {};
    state.editorPlan = buildPlanForRecipe(recipe, initialQty, initialDate);
    await ensureReservationForPlan(state.editorPlan);
    state.activeDraftId = ownDraft?.id || state.activeDraftId;

    nodes.editor.innerHTML = `
      <div class="recetas-editor-header produccion-editor-header">
        <button id="produccionBackBtn" type="button" class="btn ios-btn ios-btn-secondary recetas-back-btn"><i class="fa-solid fa-arrow-left"></i><span>Atrás</span></button>
        <div>
          <p class="recetas-editor-kicker">Producción</p>
          <h6 class="recetas-editor-title mb-0">Detalle de producción</h6>
        </div>
      </div>

      <section class="inventario-product-head-v2 produccion-head-box">
        <div class="produccion-hero-wrap">
          <img src="${FIAMBRES_IMAGE}" class="produccion-hero-bg" alt="Producción">
          <div class="produccion-hero-avatar">
            <span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img id="produccionHeadImage" class="produccion-head-image js-produccion-head-photo" src="${normalizeValue(recipe.imageUrl) || FIAMBRES_IMAGE}" alt="${capitalize(recipe.title || 'Producto')}" loading="lazy">
          </div>
        </div>
        <div class="inventario-product-copy">
          <p class="inventario-editor-kicker"><img src="./IMG/Octicons-git-branch.svg" class="produccion-head-icon" alt="Flujo"> Flujo de producción</p>
          <h3 class="inventario-editor-name">${capitalize(recipe.title || 'Sin título')}</h3>
          <p class="inventario-editor-meta">${capitalize(recipe.description || 'Sin descripción.')}</p>
          <p class="produccion-max-line">Máximo según inventario: <strong>${analysis.maxKg.toFixed(2)} kg</strong></p>
          <p id="produccionReservaTimer" class="produccion-reserva-timer"></p>
        </div>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">1</span> ¿Qué cantidad deseás producir?</h6>
        <div class="produccion-qty-grid">
          <input id="produccionQtyInput" type="number" min="0.1" step="0.01" max="${analysis.maxKg.toFixed(2)}" value="${initialQty.toFixed(2)}" class="form-control ios-input">
          <button id="produccionQtyMaxBtn" type="button" class="btn ios-btn ios-btn-secondary">Usar máximo</button>
        </div>
        <p id="produccionQtyHelp" class="produccion-qty-help"></p>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">2</span> Fecha de producción</h6>
        <input id="produccionDateInput" type="text" class="form-control ios-input" value="${initialDate}">
        <p class="produccion-qty-help">Si cambiás la fecha, recalculamos vencimientos y lotes (FEFO).</p>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">3</span> Encargados</h6>
        <div class="produccion-managers-actions">
          <button id="produccionSaveManagersPrefBtn" type="button" class="btn ios-btn ios-btn-secondary"><i class="fa-regular fa-bookmark"></i><span>Guardar preferencia</span></button>
        </div>
        <div class="produccion-managers-grid">${buildManagersHtml(initialManagers)}</div>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">4</span> Observaciones</h6>
        <textarea id="produccionObsInput" class="form-control ios-input" rows="3" placeholder="Notas de producción, incidentes, reemplazos...">${initialObs}</textarea>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">5</span> Desglose por lotes (FEFO)</h6>
        <p class="produccion-fefo-note"><strong>FEFO:</strong> <span>First Expired, First Out</span> · primero vence, primero se usa.</p>
        <div id="produccionLotsBreakdown" class="produccion-lotes-wrap"></div>
      </section>

      <section class="recipe-step-card step-block">
        <div class="produccion-final-actions">
          <button id="produccionSaveDraftBtn" type="button" class="btn ios-btn ios-btn-secondary"><i class="fa-solid fa-floppy-disk"></i><span>Guardar borrador</span></button>
          <button id="produccionConfirmBtn" type="button" class="btn ios-btn ios-btn-success"><i class="fa-solid fa-check"></i><span>Confirmar producción</span></button>
        </div>
      </section>`;

    const qtyInput = nodes.editor.querySelector('#produccionQtyInput');
    const dateInput = nodes.editor.querySelector('#produccionDateInput');
    const qtyHelp = nodes.editor.querySelector('#produccionQtyHelp');
    const lotsWrap = nodes.editor.querySelector('#produccionLotsBreakdown');

    const updateEditorPlan = async () => {
      let qty = parsePositive(qtyInput.value, 0.1);
      if (qty > analysis.maxKg) qty = analysis.maxKg;
      qtyInput.value = qty.toFixed(2);
      const productionDate = normalizeValue(dateInput.value) || toIsoDate();
      state.editorPlan = buildPlanForRecipe(recipe, qty, productionDate);
      lotsWrap.innerHTML = buildLotsBreakdownHtml(state.editorPlan);
      qtyHelp.textContent = state.editorPlan.isValid
        ? `Escala aplicada: ${qty.toFixed(2)} kg. Reserva temporal activa por 10 min.`
        : `Hay conflictos de stock/lotes para ${productionDate}.`;
      await ensureReservationForPlan(state.editorPlan);
      await saveEditorDraft();
    };

    nodes.editor.addEventListener('click', async (event) => {
      const toggleBtn = event.target.closest('[data-lot-toggle]');
      if (toggleBtn && state.editorPlan) {
        const ingredientId = toggleBtn.dataset.lotToggle;
        state.lotCollapseState[ingredientId] = !state.lotCollapseState[ingredientId];
        lotsWrap.innerHTML = buildLotsBreakdownHtml(state.editorPlan);
        return;
      }

      if (event.target.closest('#produccionCollapseAllBtn') && state.editorPlan) {
        state.editorPlan.ingredientPlans.forEach((item) => {
          state.lotCollapseState[item.ingredientId] = true;
        });
        lotsWrap.innerHTML = buildLotsBreakdownHtml(state.editorPlan);
        return;
      }

      if (event.target.closest('#produccionExpandAllBtn') && state.editorPlan) {
        state.editorPlan.ingredientPlans.forEach((item) => {
          state.lotCollapseState[item.ingredientId] = false;
        });
        lotsWrap.innerHTML = buildLotsBreakdownHtml(state.editorPlan);
        return;
      }

      const attachmentBtn = event.target.closest('[data-lot-images]');
      if (attachmentBtn) {
        const raw = decodeURIComponent(attachmentBtn.dataset.lotImages || '');
        let urls = [];
        try {
          urls = JSON.parse(raw);
        } catch (error) {
          urls = [];
        }
        if (typeof window.laJamoneraOpenImageViewer === 'function') {
          await window.laJamoneraOpenImageViewer([{ invoiceImageUrls: urls }], 0, 'Adjuntos de lote');
        } else {
          await openIosSwal({ title: 'Visor no disponible', html: '<p>No se pudo abrir el visor de imágenes.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
        }
      }
    });

    if (window.flatpickr) {
      const locale = window.flatpickr.l10ns?.es || undefined;
      window.flatpickr(dateInput, {
        locale,
        dateFormat: 'Y-m-d',
        defaultDate: initialDate,
        allowInput: true,
        onChange: async () => {
          await updateEditorPlan();
        }
      });
    }

    qtyInput.addEventListener('change', async () => { await updateEditorPlan(); });
    qtyInput.addEventListener('blur', async () => { await updateEditorPlan(); });
    nodes.editor.querySelector('#produccionQtyMaxBtn').addEventListener('click', async () => {
      qtyInput.value = analysis.maxKg.toFixed(2);
      await updateEditorPlan();
    });

    nodes.editor.querySelectorAll('[data-manager-check]').forEach((input) => {
      input.addEventListener('change', async () => { await saveEditorDraft(); });
    });

    nodes.editor.querySelector('#produccionSaveManagersPrefBtn')?.addEventListener('click', async () => {
      const selected = [...nodes.editor.querySelectorAll('[data-manager-check]:checked')].map((node) => node.value).filter(Boolean);
      state.config.preferredManagers = selected;
      state.config.preferredManagersByRecipe = {
        ...safeObject(state.config.preferredManagersByRecipe),
        [recipe.id]: selected
      };
      await persistConfig();
      await openIosSwal({ title: 'Preferencia guardada', html: '<p>Este/estos encargados se preseleccionarán en próximas producciones.</p>', icon: 'success', confirmButtonText: 'Entendido' });
    });

    nodes.editor.querySelector('#produccionObsInput').addEventListener('input', async () => { await saveEditorDraft(); });

    nodes.editor.querySelector('#produccionSaveDraftBtn').addEventListener('click', async () => {
      await saveEditorDraft();
      await openIosSwal({ title: 'Borrador guardado', html: '<p>Podés retomarlo cuando quieras.</p>', icon: 'success', confirmButtonText: 'Entendido' });
    });

    prepareThumbLoaders('.js-produccion-head-photo, .js-produccion-user-photo');

    const confirmProduction = async () => {
      const refreshBefore = await window.dbLaJamoneraRest.read('/inventario');
      state.inventario = safeObject(refreshBefore);
      const qty = parsePositive(qtyInput.value, 0.1);
      const date = normalizeValue(dateInput.value) || toIsoDate();
      const revalidated = buildPlanForRecipe(recipe, qty, date);
      if (!revalidated.isValid) {
        await openIosSwal({
          title: 'Stock cambió durante la edición',
          html: `<p>Recalculamos y encontramos conflictos:</p><ul>${revalidated.conflicts.map((item) => `<li>${item}</li>`).join('')}</ul>`,
          icon: 'warning',
          confirmButtonText: 'Revisar'
        });
        state.editorPlan = revalidated;
        lotsWrap.innerHTML = buildLotsBreakdownHtml(state.editorPlan);
        return;
      }

      const confirm = await openIosSwal({
        title: 'Confirmar producción final',
        html: '<p>Se descontará stock real del inventario.</p>',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Confirmar',
        cancelButtonText: 'Cancelar'
      });
      if (!confirm.isConfirmed) return;

      Swal.fire({
        title: 'Cargando producción...',
        html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando producción" class="meta-spinner-login"></div>',
        allowOutsideClick: false,
        showConfirmButton: false,
        customClass: {
          popup: 'ios-alert produccion-loading-alert',
          title: 'ios-alert-title',
          htmlContainer: 'ios-alert-text'
        }
      });

      try {
        const registros = safeObject(await window.dbLaJamoneraRest.read(REGISTROS_PATH));
        const sequence = Number(await window.dbLaJamoneraRest.read(SEQUENCE_PATH)) || 0;
        const nextSequence = sequence + 1;
        const dateToken = date.replaceAll('-', '');
        const prefix = normalizeValue(state.config.idConfig?.prefix) || 'PROD-LJ';
        const productionId = `${prefix}-${dateToken}-${String(nextSequence).padStart(4, '0')}`;

        const managers = [...nodes.editor.querySelectorAll('[data-manager-check]:checked')].map((node) => node.value).filter(Boolean);
        const observations = normalizeValue(nodes.editor.querySelector('#produccionObsInput')?.value);

        const inventarioNext = applyPlanOnInventory(state.inventario, revalidated, productionId, date, 'consume');

        const registro = {
        id: productionId,
        recipeId: recipe.id,
        recipeTitle: recipe.title,
        productionDate: date,
        quantityKg: qty,
        managers,
        observations,
        lots: revalidated.ingredientPlans,
        createdBy: getCurrentUserLabel(),
        createdAt: nowTs(),
        status: 'confirmada',
        reservationId: state.activeReservationId,
        exports: {},
        auditTrail: [{ action: 'creada', at: nowTs(), user: getCurrentUserLabel() }]
      };

        await window.dbLaJamoneraRest.write('/inventario', inventarioNext);
        await window.dbLaJamoneraRest.write(SEQUENCE_PATH, nextSequence);
        await window.dbLaJamoneraRest.write(REGISTROS_PATH, { ...registros, [productionId]: registro });
        await appendAudit({ action: 'produccion_confirmada', productionId, before: null, after: registro, reason: 'confirmacion final' });

        state.config.lastProductionByRecipe[recipe.id] = nowTs();
        await persistConfig();
        await releaseReservation('confirmed');
        await discardDraft();
        await refreshData();
        renderList();
        Swal.close();
        await openIosSwal({ title: 'Producción guardada', html: `<p>ID generado: <strong>${productionId}</strong></p>`, icon: 'success', confirmButtonText: 'Genial' });
      } catch (error) {
        Swal.close();
        await openIosSwal({ title: 'No se pudo confirmar', html: '<p>Ocurrió un error al guardar la producción.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      }
    };

    nodes.editor.querySelector('#produccionConfirmBtn').addEventListener('click', confirmProduction);

    nodes.editor.querySelector('#produccionBackBtn').addEventListener('click', async () => {
      const result = await openIosSwal({
        title: '¿Deseás abandonar esta producción?',
        html: '<p>Se guardará borrador y se liberará la reserva temporal.</p>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Abandonar',
        cancelButtonText: 'Seguir'
      });
      if (!result.isConfirmed) return;
      await saveEditorDraft();
      await releaseReservation('abandoned');
      state.activeRecipeId = '';
      setStateView('list');
    });

    await updateEditorPlan();
    setStateView('editor');
  };

  const recomputeAnalysis = () => {
    state.analysis = Object.values(state.recetas).reduce((acc, recipe) => {
      acc[recipe.id] = analyzeRecipe(recipe);
      return acc;
    }, {});
  };

  const refreshData = async () => {
    setStateView('loading');
    await window.laJamoneraReady;
    const [recetas, ingredientes, inventario, config, reservas, drafts, registros, users] = await Promise.all([
      window.dbLaJamoneraRest.read('/recetas'),
      window.dbLaJamoneraRest.read('/ingredientes/items'),
      window.dbLaJamoneraRest.read('/inventario'),
      window.dbLaJamoneraRest.read(CONFIG_PATH),
      window.dbLaJamoneraRest.read(RESERVAS_PATH),
      window.dbLaJamoneraRest.read(DRAFTS_PATH),
      window.dbLaJamoneraRest.read(REGISTROS_PATH),
      window.dbLaJamoneraRest.read('/informes/users')
    ]);

    state.recetas = safeObject(recetas);
    state.ingredientes = safeObject(ingredientes);
    state.inventario = safeObject(inventario);
    state.reservas = safeObject(reservas);
    state.drafts = safeObject(drafts);
    state.registros = safeObject(registros);
    state.users = safeObject(users);
    state.config = {
      globalMinKg: parsePositive(config?.globalMinKg, 1),
      recipeMinKg: safeObject(config?.recipeMinKg),
      lastProductionByRecipe: safeObject(config?.lastProductionByRecipe),
      preferredManagers: Array.isArray(config?.preferredManagers) ? config.preferredManagers : [],
      preferredManagersByRecipe: safeObject(config?.preferredManagersByRecipe),
      usersPreferences: safeObject(config?.usersPreferences),
      idConfig: { prefix: normalizeValue(config?.idConfig?.prefix) || 'PROD-LJ' }
    };

    await cleanupExpiredReservations();
    recomputeAnalysis();
  };

  const openInventarioFromProduccion = () => {
    const productionInstance = window.bootstrap?.Modal?.getOrCreateInstance(produccionModal);
    const inventarioModal = document.getElementById('inventarioModal');
    const inventarioInstance = inventarioModal ? window.bootstrap?.Modal?.getOrCreateInstance(inventarioModal) : null;
    if (!productionInstance || !inventarioInstance) return;
    const openOnHidden = () => {
      produccionModal.removeEventListener('hidden.bs.modal', openOnHidden);
      inventarioInstance.show();
    };
    produccionModal.addEventListener('hidden.bs.modal', openOnHidden, { once: true });
    productionInstance.hide();
  };

  nodes.search.addEventListener('input', (event) => {
    state.search = event.target.value;
    renderList();
  });

  nodes.list.addEventListener('click', async (event) => {
    const openDraftBtn = event.target.closest('[data-open-draft]');
    if (openDraftBtn) {
      const draftId = openDraftBtn.dataset.openDraft;
      const draft = state.drafts[draftId];
      if (draft?.recipeId) {
        state.activeRecipeId = draft.recipeId;
        await renderEditor(draft.recipeId);
      }
      return;
    }

    const deleteDraftBtn = event.target.closest('[data-delete-draft]');
    if (deleteDraftBtn) {
      const draftId = deleteDraftBtn.dataset.deleteDraft;
      const next = { ...state.drafts };
      delete next[draftId];
      await window.dbLaJamoneraRest.write(DRAFTS_PATH, next);
      state.drafts = next;
      renderList();
      return;
    }

    const produceBtn = event.target.closest('[data-open-produccion]');
    if (produceBtn) {
      state.activeRecipeId = produceBtn.dataset.openProduccion;
      Swal.fire({
        title: 'Cargando producción...',
        html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando producción" class="meta-spinner-login"></div>',
        allowOutsideClick: false,
        showConfirmButton: false,
        customClass: {
          popup: 'ios-alert produccion-loading-alert',
          title: 'ios-alert-title',
          htmlContainer: 'ios-alert-text'
        }
      });
      try {
        await renderEditor(state.activeRecipeId);
      } finally {
        Swal.close();
      }
      return;
    }
    if (event.target.closest('[data-open-inventario]')) {
      openInventarioFromProduccion();
      return;
    }
    const minBtn = event.target.closest('[data-set-recipe-min]');
    if (minBtn) {
      await openRecipeMinConfig(minBtn.dataset.setRecipeMin);
    }
  });

  produccionModal.addEventListener('click', async (event) => {
    if (event.target.closest('#produccionGlobalMinBtn')) {
      await openGlobalMinConfig();
      return;
    }
    if (event.target.closest('#produccionHistoryBtn')) {
      await openHistory();
    }
  });

  produccionModal.addEventListener('show.bs.modal', async () => {
    try {
      await refreshData();
      renderList();
    } catch (error) {
      nodes.empty.querySelector('.ingredientes-empty-text').textContent = 'No se pudo cargar producción desde Firebase.';
      setStateView('empty');
    }
  });

  produccionModal.addEventListener('hidden.bs.modal', async () => {
    if (state.activeRecipeId) {
      await saveEditorDraft();
      await releaseReservation('modal_closed');
    }
    state.activeRecipeId = '';
    state.activeDraftId = '';
    nodes.search.value = '';
    state.search = '';
    nodes.editor.innerHTML = '';
    if (state.reservationTick) {
      clearInterval(state.reservationTick);
      state.reservationTick = null;
    }
  });
})();
