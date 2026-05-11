(function firebaseIndexesModule() {
  const INDEX_VERSION = 3;
  const INDEX_META_PATH = '/_index_meta';

  const safeObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const toFiniteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const normalizePath = (path = '') => {
    const clean = normalizeValue(path).replace(/^\/+/, '').replace(/\/+$/, '');
    return clean ? `/${clean}` : '/';
  };
  const truncate = (value, max = 180) => {
    const text = normalizeValue(value);
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
  };
  const bytesOf = (value) => {
    try {
      return new Blob([JSON.stringify(value ?? null)]).size;
    } catch (_) {
      return JSON.stringify(value ?? null).length;
    }
  };
  const formatKb = (bytes) => `${(Number(bytes || 0) / 1024).toFixed(1)} KB`;
  const stripUndefined = (value) => {
    if (Array.isArray(value)) return value.map(stripUndefined);
    if (!value || typeof value !== 'object') return value === undefined ? null : value;
    return Object.entries(value).reduce((acc, [key, item]) => {
      if (item !== undefined) acc[key] = stripUndefined(item);
      return acc;
    }, {});
  };

  const getUnitMeta = (unitRaw) => {
    const unit = normalizeLower(unitRaw);
    const mass = {
      kg: 1000, kilo: 1000, kilos: 1000, kilogramo: 1000, kilogramos: 1000,
      g: 1, gr: 1, gramo: 1, gramos: 1,
      mg: 0.001, miligramo: 0.001, miligramos: 0.001,
      onza: 28.3495, onzas: 28.3495, oz: 28.3495,
      cucharada: 15, cucharadas: 15, cda: 15,
      cucharadita: 5, cucharaditas: 5, cdita: 5,
      pizca: 1, pizcas: 1, pzc: 1
    };
    const volume = {
      l: 1000, lt: 1000, litro: 1000, litros: 1000,
      ml: 1, mililitro: 1, mililitros: 1, cc: 1,
      gota: 0.05, gotas: 0.05, gts: 0.05
    };
    const unitary = { u: 1, un: 1, unidad: 1, unidades: 1 };
    if (mass[unit]) return { category: 'peso', factor: mass[unit] };
    if (volume[unit]) return { category: 'volumen', factor: volume[unit] };
    if (unitary[unit]) return { category: 'unidad', factor: unitary[unit] };
    return { category: 'otro', factor: 1 };
  };
  const toBase = (qty, unit) => {
    const number = Number(qty);
    if (!Number.isFinite(number)) return 0;
    return number * getUnitMeta(unit).factor;
  };
  const getAvailableQty = (entry = {}) => {
    const available = Number(entry.availableQty);
    if (Number.isFinite(available) && available >= 0) return available;
    return toFiniteNumber(entry.qty, 0);
  };
  const getAvailableBase = (entry = {}) => {
    const availableBase = Number(entry.availableBase);
    if (Number.isFinite(availableBase) && availableBase >= 0) return availableBase;
    return toBase(getAvailableQty(entry), entry.unit || 'kilos');
  };
  const getAvailableKg = (entry = {}) => {
    const availableKg = Number(entry.availableKg);
    if (Number.isFinite(availableKg) && availableKg >= 0) return availableKg;
    const qtyKg = Number(entry.qtyKg);
    if (Number.isFinite(qtyKg) && qtyKg >= 0) return qtyKg;
    const meta = getUnitMeta(entry.unit || 'kilos');
    return meta.category === 'peso' ? getAvailableBase(entry) / 1000 : 0;
  };
  const entryImageUrls = (entry = {}) => {
    const urls = Array.isArray(entry.invoiceImageUrls) ? entry.invoiceImageUrls : [];
    const one = normalizeValue(entry.invoiceImageUrl);
    return [...new Set([...urls, one].map(normalizeValue).filter(Boolean))];
  };

  const summarizeFamily = (family = {}, id = '') => ({
    id: normalizeValue(family.id || id),
    name: normalizeLower(family.name),
    imageUrl: normalizeValue(family.imageUrl),
    order: toFiniteNumber(family.order, 0),
    createdAt: toFiniteNumber(family.createdAt, 0),
    updatedAt: toFiniteNumber(family.updatedAt, 0)
  });

  const summarizeIngredient = (item = {}, id = '') => ({
    id: normalizeValue(item.id || id),
    name: normalizeLower(item.name),
    familyId: normalizeValue(item.familyId),
    familyName: normalizeLower(item.familyName),
    measure: normalizeLower(item.measure),
    imageUrl: normalizeValue(item.imageUrl),
    description: truncate(item.description, 180),
    perishable: typeof item.perishable === 'boolean' ? item.perishable : null,
    createdAt: toFiniteNumber(item.createdAt, 0),
    updatedAt: toFiniteNumber(item.updatedAt, 0),
    __indexLite: true
  });

  const buildIngredientesIndex = (ingredientes = {}) => {
    const source = safeObject(ingredientes);
    const familias = {};
    const items = {};
    Object.entries(safeObject(source.familias)).forEach(([id, item]) => {
      const row = summarizeFamily(item, id);
      if (row.id) familias[row.id] = row;
    });
    Object.entries(safeObject(source.items)).forEach(([id, item]) => {
      const row = summarizeIngredient(item, id);
      if (row.id) items[row.id] = row;
    });
    const measures = Array.isArray(source.config?.measures) ? source.config.measures : [];
    return {
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      source: '/ingredientes',
      familias,
      items,
      config: { measures },
      counts: {
        familias: Object.keys(familias).length,
        items: Object.keys(items).length
      }
    };
  };

  const isEntryNoPerecedero = (entry = {}) => Boolean(entry.noPerecedero);
  const isEntryFrozen = (entry = {}) => Boolean(entry.isFrozen || entry.frozen);
  const normalizeIso = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(normalizeValue(value)) ? normalizeValue(value) : '');
  const todayIso = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date()).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const daysBetween = (fromIso, toIso) => Math.round((new Date(`${toIso}T00:00:00`).getTime() - new Date(`${fromIso}T00:00:00`).getTime()) / 86400000);

  const summarizeEntryLite = (entry = {}) => ({
    id: normalizeValue(entry.id),
    entryDate: normalizeIso(entry.entryDate),
    createdAt: toFiniteNumber(entry.createdAt, 0),
    expiryDate: normalizeIso(entry.expiryDate),
    noPerecedero: Boolean(entry.noPerecedero),
    usoInternoEmpresa: Boolean(entry.usoInternoEmpresa),
    isFrozen: isEntryFrozen(entry),
    frozenAt: normalizeIso(entry.frozenAt),
    unit: normalizeLower(entry.unit),
    qty: toFiniteNumber(entry.qty, 0),
    qtyBase: toFiniteNumber(entry.qtyBase, 0),
    qtyKg: toFiniteNumber(entry.qtyKg, 0),
    availableQty: getAvailableQty(entry),
    availableBase: getAvailableBase(entry),
    availableKg: getAvailableKg(entry),
    packageQty: Number.isFinite(Number(entry.packageQty)) ? Number(entry.packageQty) : null,
    invoiceNumber: normalizeValue(entry.invoiceNumber),
    lotNumber: normalizeValue(entry.lotNumber || entry.invoiceNumber || entry.id),
    provider: normalizeValue(entry.provider),
    invoiceImageUrl: entryImageUrls(entry)[0] || '',
    invoiceImageUrls: entryImageUrls(entry),
    status: normalizeValue(entry.status),
    expiryResolutionStatus: normalizeValue(entry.expiryResolutionStatus),
    __indexLite: true
  });

  const summarizeInventoryRecord = (record = {}, ingredientId = '') => {
    const entries = Array.isArray(record.entries) ? record.entries : [];
    const liteEntries = entries.map(summarizeEntryLite).filter((entry) => entry.id);
    const stockBase = Number.isFinite(Number(record.stockBase))
      ? Number(record.stockBase)
      : liteEntries.reduce((sum, entry) => sum + Number(entry.availableBase || 0), 0);
    const stockKg = Number.isFinite(Number(record.stockKg))
      ? Number(record.stockKg)
      : liteEntries.reduce((sum, entry) => sum + Number(entry.availableKg || 0), 0);
    const today = todayIso();
    const expiringDays = Number.isFinite(Number(record.expiringSoonDays)) ? Number(record.expiringSoonDays) : null;
    const expiryWindow = Number.isFinite(expiringDays) ? expiringDays : 2;
    const expiredEntries = liteEntries
      .filter((entry) => !isEntryNoPerecedero(entry) && entry.expiryDate && entry.expiryDate < today && Number(entry.availableQty || 0) > 0)
      .map((entry) => ({
        entryId: entry.id,
        qty: entry.availableQty,
        unit: entry.unit,
        diffDays: Math.abs(daysBetween(entry.expiryDate, today)),
        expiryDate: entry.expiryDate,
        lotNumber: entry.lotNumber,
        packageQty: entry.packageQty
      }));
    const expiringEntries = liteEntries
      .filter((entry) => {
        if (isEntryNoPerecedero(entry) || !entry.expiryDate || Number(entry.availableQty || 0) <= 0) return false;
        const diff = daysBetween(today, entry.expiryDate);
        return diff >= 0 && diff <= expiryWindow;
      })
      .map((entry) => ({
        entryId: entry.id,
        qty: entry.availableQty,
        unit: entry.unit,
        diffDays: daysBetween(today, entry.expiryDate),
        expiryDate: entry.expiryDate,
        lotNumber: entry.lotNumber,
        packageQty: entry.packageQty
      }));
    return {
      ingredientId: normalizeValue(record.ingredientId || ingredientId),
      stockKg: Number(stockKg.toFixed(4)),
      stockBase: Number(stockBase.toFixed(6)),
      stockUnit: normalizeLower(record.stockUnit),
      infiniteStock: Boolean(record.infiniteStock || record.stockInfinito),
      hasEntries: Boolean(record.hasEntries || liteEntries.length),
      entriesCount: liteEntries.length,
      expiredEntries,
      expiringEntries,
      hasFrozenEntries: liteEntries.some(isEntryFrozen),
      lowThresholdKg: record.lowThresholdKg ?? null,
      lowThresholdBase: record.lowThresholdBase ?? null,
      lowThresholdMode: normalizeValue(record.lowThresholdMode || 'global'),
      packageQty: Number.isFinite(Number(record.packageQty)) ? Number(record.packageQty) : null,
      expiringSoonDays: Number.isFinite(Number(record.expiringSoonDays)) ? Number(record.expiringSoonDays) : null,
      suggestedExpiryDays: Number.isFinite(Number(record.suggestedExpiryDays)) ? Number(record.suggestedExpiryDays) : null,
      lotConfig: safeObject(record.lotConfig),
      weeklySheetConfig: safeObject(record.weeklySheetConfig),
      flagPreferences: safeObject(record.flagPreferences),
      __indexLite: true
    };
  };

  const buildInventarioIndex = (inventario = {}) => {
    const source = safeObject(inventario);
    const items = {};
    Object.entries(safeObject(source.items)).forEach(([id, record]) => {
      const row = summarizeInventoryRecord(record, id);
      if (row.ingredientId) items[row.ingredientId] = row;
    });
    return {
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      source: '/inventario',
      config: {
        globalLowThresholdKg: source.config?.globalLowThresholdKg ?? null,
        globalLowThresholdUnits: source.config?.globalLowThresholdUnits ?? null,
        expiringSoonDays: source.config?.expiringSoonDays ?? null,
        providers: Array.isArray(source.config?.providers) ? source.config.providers : []
      },
      items,
      counts: {
        items: Object.keys(items).length,
        entries: Object.values(items).reduce((sum, item) => sum + Number(item.entriesCount || 0), 0)
      }
    };
  };

  const summarizeRecipeRow = (row = {}) => {
    if (normalizeValue(row.type) === 'monography') {
      return {
        id: normalizeValue(row.id),
        type: 'monography',
        manualUrl: normalizeValue(row.manualUrl),
        manualType: normalizeValue(row.manualType),
        manualName: normalizeValue(row.manualName)
      };
    }
    if (normalizeValue(row.type) !== 'ingredient') return null;
    return {
      id: normalizeValue(row.id),
      type: 'ingredient',
      ingredientId: normalizeValue(row.ingredientId),
      ingredientName: normalizeValue(row.ingredientName),
      quantity: normalizeValue(row.quantity),
      unit: normalizeLower(row.unit),
      relatedIngredients: (Array.isArray(row.relatedIngredients) ? row.relatedIngredients : [])
        .map((item) => ({
          ingredientId: normalizeValue(item.ingredientId),
          ingredientName: normalizeValue(item.ingredientName),
          maxPercent: normalizeValue(item.maxPercent)
        }))
        .filter((item) => item.ingredientId)
    };
  };

  const summarizeRecipe = (recipe = {}, id = '') => {
    const rows = (Array.isArray(recipe.rows) ? recipe.rows : []).map(summarizeRecipeRow).filter(Boolean);
    const rnpa = safeObject(recipe.rnpa);
    const nutritionAi = safeObject(recipe.nutrition?.ai);
    const frontLabels = Array.isArray(nutritionAi.frontLabels) ? nutritionAi.frontLabels : [];
    return {
      id: normalizeValue(recipe.id || id),
      title: normalizeValue(recipe.title),
      nombreComercial: normalizeValue(recipe.nombreComercial),
      description: truncate(recipe.description, 220),
      imageUrl: normalizeValue(recipe.imageUrl),
      recipeGroupId: normalizeValue(recipe.recipeGroupId),
      yieldQuantity: normalizeValue(recipe.yieldQuantity),
      yieldUnit: normalizeLower(recipe.yieldUnit),
      shelfLifeDays: toFiniteNumber(recipe.shelfLifeDays, 0),
      frozenShelfLifeExtension: Boolean(recipe.frozenShelfLifeExtension || recipe.freezingShelfLifeExtension || recipe.extendedByFreezing),
      agingDays: toFiniteNumber(recipe.agingDays, 0),
      packagingDelayType: normalizeValue(recipe.packagingDelayType),
      prePackagingFreeze: Boolean(recipe.prePackagingFreeze),
      orderMode: normalizeValue(recipe.orderMode),
      rows,
      rnpa: {
        number: normalizeValue(rnpa.number),
        expiryDate: normalizeIso(rnpa.expiryDate),
        attachmentUrl: normalizeValue(rnpa.attachmentUrl),
        exempt: Boolean(recipe.rnpaNotRequired || recipe.rnpaExempt || recipe.subproductNoRnpa)
      },
      rnpaNotRequired: Boolean(recipe.rnpaNotRequired),
      rnpaExempt: Boolean(recipe.rnpaExempt),
      rnpaExemptReason: normalizeValue(recipe.rnpaExemptReason),
      nutrition: {
        ai: {
          tableHtml: normalizeValue(nutritionAi.tableHtml) ? '__indexed__' : '',
          frontLabels
        }
      },
      planillaVersion: toFiniteNumber(recipe.planillaVersion, 0),
      createdAt: toFiniteNumber(recipe.createdAt, 0),
      updatedAt: toFiniteNumber(recipe.updatedAt, 0),
      __indexLite: true
    };
  };

  const buildRecetasIndex = (recetas = {}, recipeGroups = {}) => {
    const items = {};
    Object.entries(safeObject(recetas)).forEach(([id, recipe]) => {
      const row = summarizeRecipe(recipe, id);
      if (row.id) items[row.id] = row;
    });
    return {
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      source: '/recetas',
      items,
      groups: safeObject(recipeGroups),
      counts: {
        items: Object.keys(items).length
      }
    };
  };

  const summarizeProduction = (row = {}, id = '') => ({
    id: normalizeValue(row.id || id),
    recipeId: normalizeValue(row.recipeId),
    recipeTitle: normalizeValue(row.recipeTitle),
    quantityKg: toFiniteNumber(row.quantityKg, 0),
    productionDate: normalizeIso(row.productionDate),
    createdAt: toFiniteNumber(row.createdAt, 0),
    status: normalizeValue(row.status),
    managers: Array.isArray(row.managers) ? row.managers : [],
    observations: truncate(row.observations, 140),
    productExpiryDate: normalizeValue(row.productExpiryDate || row.expiryDate),
    planillaVersion: toFiniteNumber(row.planillaVersion, 0),
    traceCount: (Array.isArray(row.lots) ? row.lots : []).reduce((sum, plan) => sum + (Array.isArray(plan?.lots) ? plan.lots : []).filter((lot) => toFiniteNumber(lot?.takeQty, 0) > 0.0001).length, 0),
    __indexLite: true
  });

  const buildProduccionIndex = (registros = {}) => {
    const output = {};
    Object.entries(safeObject(registros)).forEach(([id, row]) => {
      const item = summarizeProduction(row, id);
      if (item.id) output[item.id] = item;
    });
    return {
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      source: '/produccion/registros',
      registros: output,
      counts: { registros: Object.keys(output).length }
    };
  };

  const summarizeReport = (report = {}, id = '', dateParts = {}) => ({
    id: normalizeValue(report.id || id),
    title: normalizeValue(report.title || report.name || 'Informe'),
    userId: normalizeValue(report.userId),
    userName: normalizeValue(report.userName),
    userPosition: normalizeValue(report.userPosition),
    createdAt: toFiniteNumber(report.createdAt, 0),
    updatedAt: toFiniteNumber(report.updatedAt, 0),
    commentsCount: Array.isArray(report.comments) ? report.comments.length : Object.keys(safeObject(report.comments)).length,
    year: dateParts.year,
    month: dateParts.month,
    day: dateParts.day,
    __indexLite: true
  });

  const buildInformesIndex = (informes = {}) => {
    const output = {};
    Object.entries(safeObject(informes)).forEach(([year, months]) => {
      Object.entries(safeObject(months)).forEach(([month, days]) => {
        Object.entries(safeObject(days)).forEach(([day, reports]) => {
          Object.entries(safeObject(reports)).forEach(([id, report]) => {
            const row = summarizeReport(report, id, { year, month, day });
            output[year] = output[year] || {};
            output[year][month] = output[year][month] || {};
            output[year][month][day] = output[year][month][day] || {};
            output[year][month][day][row.id] = row;
          });
        });
      });
    });
    return output;
  };

  const buildRepartoIndex = (reparto = {}) => {
    const source = safeObject(reparto);
    return {
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      source: '/Reparto',
      clients: safeObject(source.clients),
      localities: Array.isArray(source.localities) ? source.localities : [],
      vehicles: safeObject(source.vehicles),
      productIndex: safeObject(source.productIndex),
      sequenceByDate: safeObject(source.sequenceByDate),
      xlsxConfig: safeObject(source.xlsxConfig),
      counts: {
        clients: Object.keys(safeObject(source.clients)).length,
        vehicles: Object.keys(safeObject(source.vehicles)).length,
        productIndex: Object.keys(safeObject(source.productIndex)).length,
        registros: Object.keys(safeObject(source.registros)).length
      }
    };
  };

  const getDb = () => window.dbLaJamonera || window.firebase?.app?.('laJamonera')?.database?.();
  const setRaw = async (path, value) => {
    const db = getDb();
    if (!db?.ref) throw new Error('Firebase Database no disponible.');
    await db.ref(normalizePath(path)).set(stripUndefined(value));
  };
  const updateRawRoot = async (updates) => {
    const db = getDb();
    if (!db?.ref) throw new Error('Firebase Database no disponible.');
    await db.ref('/').update(stripUndefined(updates));
  };

  const syncAfterWrite = async ({ path, value, mode }) => {
    const key = normalizePath(path);
    const freshValue = async () => {
      if (mode !== 'update' || value == null) return value;
      try {
        const current = await window.dbLaJamoneraRest?.read?.(key);
        return current == null ? value : current;
      } catch (_) {
        return value;
      }
    };
    if (key === '/ingredientes') {
      await setRaw('/ingredientes_index', buildIngredientesIndex(value));
      return;
    }
    if (key.startsWith('/ingredientes/items/')) {
      const id = key.split('/')[3];
      const currentValue = await freshValue();
      await setRaw(`/ingredientes_index/items/${id}`, currentValue == null ? null : summarizeIngredient(currentValue, id));
      await setRaw(`${INDEX_META_PATH}/ingredientes_index`, { updatedAt: Date.now(), version: INDEX_VERSION });
      return;
    }
    if (key.startsWith('/ingredientes/familias/')) {
      const id = key.split('/')[3];
      const currentValue = await freshValue();
      await setRaw(`/ingredientes_index/familias/${id}`, currentValue == null ? null : summarizeFamily(currentValue, id));
      await setRaw(`${INDEX_META_PATH}/ingredientes_index`, { updatedAt: Date.now(), version: INDEX_VERSION });
      return;
    }
    if (key === '/ingredientes/config/measures') {
      await setRaw('/ingredientes_index/config/measures', Array.isArray(value) ? value : []);
      await setRaw(`${INDEX_META_PATH}/ingredientes_index`, { updatedAt: Date.now(), version: INDEX_VERSION });
      return;
    }
    if (key === '/inventario') {
      await setRaw('/inventario_index', buildInventarioIndex(value));
      return;
    }
    if (key.startsWith('/inventario/items/')) {
      const id = key.split('/')[3];
      const currentValue = await freshValue();
      await setRaw(`/inventario_index/items/${id}`, currentValue == null ? null : summarizeInventoryRecord(currentValue, id));
      await setRaw(`${INDEX_META_PATH}/inventario_index`, { updatedAt: Date.now(), version: INDEX_VERSION });
      return;
    }
    if (key === '/inventario/config') {
      await setRaw('/inventario_index/config', value || {});
      await setRaw(`${INDEX_META_PATH}/inventario_index`, { updatedAt: Date.now(), version: INDEX_VERSION });
      return;
    }
    if (key === '/recetas') {
      let groups = {};
      try { groups = await window.dbLaJamoneraRest?.read?.('/recetas_groups') || {}; } catch (_) {}
      await setRaw('/recetas_index', buildRecetasIndex(value, groups));
      return;
    }
    if (key.startsWith('/recetas/')) {
      const id = key.split('/')[2];
      const currentValue = await freshValue();
      await setRaw(`/recetas_index/items/${id}`, currentValue == null ? null : summarizeRecipe(currentValue, id));
      await setRaw(`${INDEX_META_PATH}/recetas_index`, { updatedAt: Date.now(), version: INDEX_VERSION });
      return;
    }
    if (key === '/recetas_groups') {
      await setRaw('/recetas_index/groups', safeObject(value));
      await setRaw(`${INDEX_META_PATH}/recetas_index`, { updatedAt: Date.now(), version: INDEX_VERSION });
      return;
    }
    if (key === '/produccion/registros') {
      await setRaw('/produccion_index', buildProduccionIndex(value));
      return;
    }
    if (key.startsWith('/produccion/registros/')) {
      const id = key.split('/')[3];
      const currentValue = await freshValue();
      await setRaw(`/produccion_index/registros/${id}`, currentValue == null ? null : summarizeProduction(currentValue, id));
      await setRaw(`${INDEX_META_PATH}/produccion_index`, { updatedAt: Date.now(), version: INDEX_VERSION });
      return;
    }
    if (key === '/informes') {
      await setRaw('/informes_index', buildInformesIndex(value));
      return;
    }
    if (key === '/Reparto') {
      await setRaw('/reparto_index', buildRepartoIndex(value));
      return;
    }
    if (key.startsWith('/Reparto/')) {
      const [, , section, ...rest] = key.split('/');
      const indexedSections = new Set(['clients', 'localities', 'vehicles', 'productIndex', 'sequenceByDate', 'xlsxConfig']);
      if (indexedSections.has(section)) {
        const suffix = [section, ...rest].filter(Boolean).join('/');
        await setRaw(`/reparto_index/${suffix}`, value == null ? null : value);
        await setRaw(`${INDEX_META_PATH}/reparto_index`, { updatedAt: Date.now(), version: INDEX_VERSION });
      }
    }
  };

  const readSafe = async (path, fallback = {}) => {
    try {
      const value = await window.dbLaJamoneraRest.read(path);
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  };

  const rebuildAll = async ({ log = () => {} } = {}) => {
    await window.laJamoneraReady;
    const startedAt = Date.now();
    log('Leyendo datos actuales completos para construir indices...');
    const [ingredientes, inventario, recetas, recipeGroups, registros, informes, reparto] = await Promise.all([
      readSafe('/ingredientes', {}),
      readSafe('/inventario', {}),
      readSafe('/recetas', {}),
      readSafe('/recetas_groups', {}),
      readSafe('/produccion/registros', {}),
      readSafe('/informes', {}),
      readSafe('/Reparto', {})
    ]);

    const indexes = {
      ingredientes_index: buildIngredientesIndex(ingredientes),
      inventario_index: buildInventarioIndex(inventario),
      recetas_index: buildRecetasIndex(recetas, recipeGroups),
      produccion_index: buildProduccionIndex(registros),
      informes_index: buildInformesIndex(informes),
      reparto_index: buildRepartoIndex(reparto)
    };
    indexes[INDEX_META_PATH.replace(/^\//, '')] = {
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      durationMs: Date.now() - startedAt
    };

    Object.entries({
      ingredientes,
      inventario,
      recetas,
      registros,
      informes,
      reparto
    }).forEach(([name, full]) => {
      const indexName = name === 'registros' ? 'produccion_index' : `${name}_index`;
      const indexed = indexes[indexName] || {};
      const fullBytes = bytesOf(full);
      const indexBytes = bytesOf(indexed);
      const saved = fullBytes > 0 ? Math.max(0, 100 - ((indexBytes / fullBytes) * 100)) : 0;
      log(`${name}: ${formatKb(fullBytes)} -> ${formatKb(indexBytes)} (${saved.toFixed(1)}% menos para lecturas de listado).`);
    });

    log('Escribiendo indices en Firebase por rutas exactas...');
    for (const [key, value] of Object.entries(indexes)) {
      await setRaw(`/${key}`, value);
    }
    log(`Listo. Indices actualizados en ${(Date.now() - startedAt) / 1000}s.`);
    return {
      ok: true,
      indexes,
      sizes: Object.fromEntries(Object.entries(indexes).map(([key, value]) => [key, bytesOf(value)]))
    };
  };

  window.laJamoneraIndexService = {
    version: INDEX_VERSION,
    buildIngredientesIndex,
    buildInventarioIndex,
    buildRecetasIndex,
    buildProduccionIndex,
    buildInformesIndex,
    buildRepartoIndex,
    summarizeIngredient,
    summarizeInventoryRecord,
    summarizeRecipe,
    summarizeProduction,
    syncAfterWrite,
    rebuildAll,
    bytesOf,
    formatKb
  };
})();
