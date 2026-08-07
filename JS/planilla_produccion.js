(function planillaProduccionModule() {
  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const normalizeUpper = (value) => normalizeValue(value).toUpperCase();
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const TRACE_BASE_URL = normalizeValue(window.TRACE_BASE_URL) || 'https://lucasponzoni.github.io/La-Jamonera/';

  const formatIsoEs = (iso) => {
    const text = normalizeValue(iso);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return text || '-';
    return `${match[3]}-${match[2]}-${match[1]}`;
  };

  const formatMonthYearEs = (iso) => {
    const text = normalizeValue(iso);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(Number(text));
    if (Number.isNaN(date.getTime())) return text || '-';
    const month = date.toLocaleDateString('es-AR', { month: 'long' }).toUpperCase();
    return `${month} ${date.getFullYear()}`;
  };

  // Mes abreviado (ENE..DIC) para el encabezado del protocolo: se usa la fecha
  // real de elaboracion de la produccion, no un valor fijo.
  const MONTHS_SHORT_ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const formatMonthShortYearEs = (value) => {
    const text = normalizeValue(value);
    if (!text) return '-';
    const date = /^\d{4}-\d{2}-\d{2}/.test(text) ? new Date(`${text.slice(0, 10)}T00:00:00`) : new Date(Number(text));
    if (Number.isNaN(date.getTime())) return '-';
    return `${MONTHS_SHORT_ES[date.getMonth()]} ${date.getFullYear()}`;
  };
  const addDaysToIso = (isoDate, days) => {
    const text = normalizeValue(isoDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    const date = new Date(`${text}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  };

  const formatDateTime = (value) => {
    const d = new Date(Number(value));
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const sanitizeFileNamePart = (value, fallback = 'sin-dato') => {
    const cleaned = normalizeValue(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || fallback;
  };

  const getPlanillaDocumentTitle = (registro = {}) => {
    const product = sanitizeFileNamePart(registro?.recipeTitle || 'producto');
    const production = sanitizeFileNamePart(registro?.id || 'produccion');
    const date = sanitizeFileNamePart(registro?.productionDate || new Date().toISOString().slice(0, 10), 'fecha');
    return `${production} - ${product} - ${date}`;
  };

  const formatQty = (value, unit = '') => `${Number(value || 0).toFixed(3)} ${normalizeUpper(unit)}`.trim();
  const getUnitFactor = (unitRaw) => {
    const unit = normalizeValue(unitRaw).toLowerCase();
    const massMap = {
      kg: 1000, kilo: 1000, kilos: 1000, kilogramo: 1000, kilogramos: 1000,
      g: 1, gr: 1, gramo: 1, gramos: 1,
      mg: 0.001, miligramo: 0.001, miligramos: 0.001
    };
    const volumeMap = {
      l: 1000, lt: 1000, litro: 1000, litros: 1000,
      ml: 1, mililitro: 1, mililitros: 1, cc: 1
    };
    if (massMap[unit]) return massMap[unit];
    if (volumeMap[unit]) return volumeMap[unit];
    return 1;
  };
  const toKg = (qty, unit) => {
    const amount = Number(qty || 0);
    if (!Number.isFinite(amount)) return 0;
    return Number(((amount * getUnitFactor(unit)) / 1000).toFixed(6));
  };
  const getPlanUsedQty = (plan, { hasSiblingSubstitute = false } = {}) => {
    const lots = Array.isArray(plan?.lots) ? plan.lots : [];
    const usedFromLots = lots.reduce((sum, lot) => sum + Number(lot?.takeQty || 0), 0);
    if (usedFromLots > 0.0001) return Number(usedFromLots.toFixed(4));
    if (plan?.infiniteStock || plan?.noTraceability) return Number(((plan?.neededQty ?? plan?.requiredQty) || 0).toFixed(4));
    if (plan?.isSubstitute || hasSiblingSubstitute) return 0;
    return Number(((plan?.neededQty ?? plan?.requiredQty) || 0).toFixed(4));
  };
  const hasSubstituteSibling = (plans = [], plan = {}) => {
    const sourceId = normalizeValue(plan?.sourceIngredientId || plan?.ingredientId);
    return (Array.isArray(plans) ? plans : []).some((candidate) => candidate?.isSubstitute && normalizeValue(candidate?.sourceIngredientId || candidate?.ingredientId) === sourceId);
  };

  const loadScript = (src, id) => new Promise((resolve) => {
    const existing = document.getElementById(id);
    if (existing) return resolve(true);
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  const ensureQrLib = async () => (window.QRCode ? true : loadScript('https://cdn.jsdelivr.net/npm/qrcodejs2@0.0.2/qrcode.min.js', 'la-jamonera-qrcode'));
  const getTraceUrl = (registro) => normalizeValue(registro?.publicTraceUrl) || `${TRACE_BASE_URL}${encodeURIComponent(normalizeValue(registro?.id))}`;
  const getPackagingLabel = (registro = {}) => {
    const type = normalizeValue(registro?.packagingDelayTypeAtProduction || registro?.packagingDelayType || registro?.traceability?.product?.packagingDelayType);
    return type === 'freeze_before_packaging' ? 'CONGELADO PREVIO A ENVASADO' : 'ENVASADO';
  };
  const getPackagingDateDisplay = (registro = {}) => normalizeValue(registro?.packagingDate)
    ? formatIsoEs(registro.packagingDate)
    : 'Al producir';
  const getInitialsToken = (value = '') => {
    const words = normalizeUpper(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    return words.map((word) => word[0]).join('') || 'PROD';
  };
  const getProductionLotDisplay = (registro = {}) => {
    const explicit = normalizeValue(registro?.lotNumber || registro?.productLotNumber);
    if (explicit) return normalizeUpper(explicit);
    const dateToken = normalizeValue(registro?.productionDate || '').replaceAll('-', '');
    const productToken = getInitialsToken(registro?.recipeTitle || registro?.traceability?.product?.title || 'Producto');
    return `LJ-${dateToken || 'SFECHA'}-${productToken}`;
  };
  const isMissingPlanillaValue = (value = '') => {
    const text = normalizeValue(value);
    return !text || text === '-';
  };
  const getFallbackLotDisplay = (registro = {}, name = '') => {
    const dateToken = normalizeValue(registro?.productionDate || '').replaceAll('-', '');
    return `LJ-${dateToken || 'SFECHA'}-${getInitialsToken(name || registro?.recipeTitle || 'Producto')}`;
  };
  const getIngredientExpiryValue = (registro = {}, expiry = '') => {
    const text = normalizeValue(expiry);
    if (text && text !== '-') return text;
    return addDaysToIso(registro?.productionDate, 5) || '-';
  };
  const getProductExpiryDisplay = (registro = {}) => {
    const explicit = normalizeValue(registro?.productExpiryDate);
    if (explicit) return formatIsoEs(explicit);
    const fallback = addDaysToIso(registro?.productionDate, 5);
    return fallback ? formatIsoEs(fallback) : '-';
  };

  let recipesSnapshotCache = null;
  const getRecipesSnapshot = async (context = {}) => {
    const provided = safeObject(context.recetas || context.recipes);
    if (Object.keys(provided).length) return provided;
    if (recipesSnapshotCache) return recipesSnapshotCache;
    try {
      await window.laJamoneraReady;
      recipesSnapshotCache = safeObject(await window.dbLaJamoneraRest?.read?.('/recetas'));
    } catch (error) {
      recipesSnapshotCache = {};
    }
    return recipesSnapshotCache;
  };

  const findRecipeForRegistro = async (registro = {}, context = {}) => {
    const recipes = await getRecipesSnapshot(context);
    const recipeId = normalizeValue(registro?.recipeId || registro?.traceability?.product?.id);
    if (recipeId && recipes[recipeId]) return safeObject(recipes[recipeId]);
    const title = normalizeUpper(registro?.recipeTitle || registro?.traceability?.product?.title);
    return safeObject(Object.values(recipes).find((recipe) => normalizeUpper(recipe?.title) === title));
  };
  const formatRnpaExemptReason = (value = '') => {
    const reason = normalizeValue(value);
    return reason === 'solo_mostrador' ? 'Venta mostrador' : reason;
  };

  const enrichRegistroForPlanilla = async (registro = {}, context = {}) => {
    const recipe = await findRecipeForRegistro(registro, context);
    if (!Object.keys(recipe).length) return registro;
    const recipeRnpa = safeObject(recipe.rnpa);
    const existingProduct = safeObject(registro?.traceability?.product);
    const existingRnpa = safeObject(existingProduct.rnpa);
    const rnpaExempt = Boolean(recipe?.rnpaNotRequired || recipe?.rnpaExempt || recipe?.subproductNoRnpa || existingRnpa.exempt);
    const rnpaNumber = normalizeValue(existingRnpa.number) || normalizeValue(recipeRnpa.number);
    const currentCommercialName = normalizeValue(recipe.nombreComercial);
    // Vencimiento de respaldo: si el registro no lo trae persistido, lo calculamos
    // como envasado + caducidad (no producción + caducidad). envasado = producción
    // + estacionado (agingDays). Respeta el snapshot si ya existe.
    let productExpiryDate = normalizeValue(registro.productExpiryDate);
    if (!productExpiryDate) {
      const prod = normalizeValue(registro.productionDate);
      const shelfLifeDays = Number(registro.shelfLifeDaysAtProduction ?? recipe.shelfLifeDays);
      const agingDays = Number(registro.agingDaysAtProduction ?? recipe.agingDays) || 0;
      if (prod && Number.isFinite(shelfLifeDays) && shelfLifeDays > 0) {
        const packagingDate = normalizeValue(registro.packagingDate) || (agingDays > 0 ? addDaysToIso(prod, agingDays) : prod);
        productExpiryDate = addDaysToIso(packagingDate, shelfLifeDays);
      }
    }
    return {
      ...registro,
      productExpiryDate,
      recipeNombreComercial: currentCommercialName,
      // Datos de receta para la planilla protocolo: base de cálculo y vida útil.
      recipeYieldQuantity: recipe.yieldQuantity,
      recipeYieldUnit: normalizeValue(recipe.yieldUnit),
      recipeShelfLifeDays: Number(registro.shelfLifeDaysAtProduction ?? recipe.shelfLifeDays) || 0,
      traceability: {
        ...safeObject(registro.traceability),
        product: {
          ...existingProduct,
          nombreComercial: currentCommercialName,
          rnpa: {
            ...existingRnpa,
            number: rnpaNumber,
            exempt: rnpaExempt,
            exemptReason: rnpaExempt ? formatRnpaExemptReason(recipe.rnpaExemptReason || existingRnpa.exemptReason) || 'Venta mostrador' : normalizeValue(existingRnpa.exemptReason)
          }
        }
      }
    };
  };

  const resolveManagerNames = (registro, usersMap = {}) => {
    const tokens = Array.isArray(registro?.managers) ? registro.managers : [];
    if (!tokens.length) return 'SIN RESPONSABLE';
    return tokens.map((token) => {
      const user = safeObject(usersMap[token]);
      const full = normalizeUpper(user.fullName || user.name || token);
      const role = normalizeUpper(user.role || user.position || 'RESPONSABLE');
      return `${full} (${role})`;
    }).join(', ');
  };

  const resolveIngredientRows = (registro) => {
    const plans = Array.isArray(registro?.lots) ? registro.lots : [];
    const traceIngredients = Array.isArray(registro?.traceability?.ingredients) ? registro.traceability.ingredients : [];
    const joinUnique = (items = []) => {
      const normalized = items.map((item) => normalizeValue(item)).filter(Boolean);
      const unique = [...new Set(normalized)];
      return unique.length ? unique.map((item) => normalizeUpper(item)).join(' | ') : '-';
    };
    const sourceMeta = plans.reduce((acc, plan, index) => {
      const ingredientId = normalizeValue(plan?.ingredientId || `ing_${index}`);
      const sourceIngredientId = normalizeValue(plan?.sourceIngredientId || ingredientId);
      if (!acc[sourceIngredientId]) {
        acc[sourceIngredientId] = {
          sourceIngredientId,
          sourceIngredientName: normalizeUpper(plan?.sourceIngredientName || plan?.ingredientName || 'INGREDIENTE'),
          requiredQty: 0,
          unit: normalizeValue(plan?.ingredientUnit || plan?.unit || '')
        };
      }
      if (!plan?.isSubstitute) {
        acc[sourceIngredientId].requiredQty = Number((Number(acc[sourceIngredientId].requiredQty || 0) + Number(plan?.neededQty ?? plan?.requiredQty ?? 0)).toFixed(4));
      }
      if (!acc[sourceIngredientId].unit) acc[sourceIngredientId].unit = normalizeValue(plan?.ingredientUnit || plan?.unit || '');
      return acc;
    }, {});
    const groupedPlans = Object.values(plans.reduce((acc, plan, index) => {
      const hasSiblingSubstitute = hasSubstituteSibling(plans, plan);
      const usedQty = getPlanUsedQty(plan, { hasSiblingSubstitute });
      if (usedQty <= 0.0001) return acc;
      const ingredientId = normalizeValue(plan?.ingredientId || `ing_${index}`);
      const sourceIngredientId = normalizeValue(plan?.sourceIngredientId || ingredientId);
      const key = `${ingredientId}::${sourceIngredientId}`;
      if (!acc[key]) {
        acc[key] = {
          ...safeObject(plan),
          ingredientId,
          sourceIngredientId,
          sourceIngredientName: normalizeUpper(plan?.sourceIngredientName),
          ingredientName: normalizeUpper(plan?.ingredientName || 'INGREDIENTE'),
          ingredientImageUrl: normalizeValue(plan?.ingredientImageUrl || ''),
          isSubstitute: Boolean(plan?.isSubstitute),
          neededQty: 0,
          requiredQty: 0,
          lots: []
        };
      }
      acc[key].neededQty = Number((Number(acc[key].neededQty || 0) + usedQty).toFixed(4));
      acc[key].requiredQty = acc[key].neededQty;
      acc[key].lots.push(...(Array.isArray(plan?.lots) ? plan.lots.filter((lot) => Number(lot?.takeQty || 0) > 0.0001) : []));
      if (!acc[key].ingredientImageUrl) acc[key].ingredientImageUrl = normalizeValue(plan?.ingredientImageUrl || '');
      return acc;
    }, {}));

    return groupedPlans.map((plan) => {
      const traceIngredient = traceIngredients.find((row) => normalizeValue(row?.ingredientId) === normalizeValue(plan?.ingredientId));
      const planLots = Array.isArray(plan?.lots) ? plan.lots : [];
      const traceLots = Array.isArray(traceIngredient?.lots) ? traceIngredient.lots : [];
      const mergedLots = planLots.length ? planLots : traceLots;
      const lots = (mergedLots.length ? mergedLots : [{}]).map((lot, index) => ({
        ...safeObject(traceLots[index]),
        ...safeObject(lot)
      }));
      const lotNumbers = lots.map((lot) => lot?.lotNumber || lot?.entryId || '-');
      const providers = lots.map((lot) => lot?.provider || '-');
      const rnes = lots.map((lot) => lot?.providerRne?.number || '-');
      const observationLots = lots.map((lot, lotIndex) => {
        const usedQty = Number(lot?.takeQty || 0);
        const unit = lot?.unit || plan?.ingredientUnit || plan?.unit || '';
        return {
          index: lotIndex + 1,
          lotNumber: normalizeValue(lot?.lotNumber || lot?.entryId || '-'),
          provider: normalizeUpper(lot?.provider || '-'),
          qtyLabel: formatQty(usedQty, unit),
          isFrozen: Boolean(lot?.isFrozen || lot?.frozen),
          frozenAt: normalizeValue(lot?.frozenAt || ''),
          entryDate: normalizeValue(lot?.entryDate || ''),
          expiryDate: normalizeValue(lot?.expiryDate || '')
        };
      });
      const firstLot = lots[0] || {};
      const displayName = normalizeUpper(plan?.ingredientName || traceIngredient?.ingredientName || 'INGREDIENTE');
      const lotNumberDisplay = joinUnique(lotNumbers);
      const expiryValue = getIngredientExpiryValue(registro, firstLot?.expiryDate || '');
      const takeQty = Number(firstLot?.takeQty || 0);
      const availableQty = Number(firstLot?.availableQty || 0);
      const remainingQty = Math.max(0, availableQty - takeQty);
      const hasMultiProvider = [...new Set(providers.map((item) => normalizeValue(item)).filter(Boolean))].length > 1;
      const lotUsageSummary = observationLots.map((lot, lotIdx) => {
        const exp = formatIsoEs(lots[lotIdx]?.expiryDate || '-');
        return `${lot.qtyLabel} de lote ${lot.index} ${lot.lotNumber} (vence ${exp})`;
      }).join(', ');
      const providersSummary = hasMultiProvider
        ? `El proveedor es ${observationLots.map((lot) => `${lot.provider} para lote ${lot.index}`).join(' y ')}`
        : `El proveedor es ${normalizeValue(providers[0] || '-')}`;
      const meta = sourceMeta[normalizeValue(plan?.sourceIngredientId || plan?.ingredientId)] || {};
      const qtyRaw = Number(plan?.neededQty ?? plan?.requiredQty ?? 0);
      const qtyUnit = normalizeValue(plan?.ingredientUnit || plan?.unit || '');
      return {
        ingredientName: displayName,
        relation: plan?.isSubstitute && normalizeValue(plan?.sourceIngredientName) ? `SUSTITUYE A ${normalizeUpper(plan.sourceIngredientName)}` : '',
        isSubstitute: Boolean(plan?.isSubstitute),
        sourceIngredientId: normalizeValue(plan?.sourceIngredientId || plan?.ingredientId),
        sourceIngredientName: normalizeUpper(meta.sourceIngredientName || plan?.sourceIngredientName || plan?.ingredientName || 'INGREDIENTE'),
        sourceRequiredQty: Number(meta.requiredQty || qtyRaw || 0),
        sourceUnit: normalizeValue(meta.unit || qtyUnit),
        ingredientImage: normalizeValue(plan?.ingredientImageUrl || traceIngredient?.ingredientImageUrl),
        provider: joinUnique(providers),
        lotNumber: isMissingPlanillaValue(lotNumberDisplay) ? getFallbackLotDisplay(registro, displayName) : lotNumberDisplay,
        expiryDate: expiryValue,
        rne: joinUnique(rnes),
        qtyRaw,
        qtyUnit,
        qty: formatQty(qtyRaw, qtyUnit),
        qtyKg: toKg(qtyRaw, qtyUnit),
        available: formatQty(availableQty, firstLot?.unit || plan?.ingredientUnit || plan?.unit || ''),
        remaining: formatQty(remainingQty, firstLot?.unit || plan?.ingredientUnit || plan?.unit || ''),
        invoiceNumber: normalizeValue(firstLot?.invoiceNumber || '-'),
        entryDate: formatIsoEs(firstLot?.entryDate || '-'),
        autoObservation: lots.length > 1
          ? `${plan?.ingredientName || traceIngredient?.ingredientName || 'Ingrediente'}, se usó ${lotUsageSummary}. ${providersSummary}.`
          : ''
      };
    });
  };

  const buildFormulaRows = (ingredientRows = []) => {
    const groups = Object.values((Array.isArray(ingredientRows) ? ingredientRows : []).reduce((acc, row, index) => {
      const key = normalizeValue(row?.sourceIngredientId || row?.ingredientName || `ing_${index}`);
      if (!acc[key]) {
        acc[key] = {
          sourceIngredientName: normalizeUpper(row?.sourceIngredientName || row?.ingredientName || 'INGREDIENTE'),
          sourceRequiredQty: Number(row?.sourceRequiredQty || 0),
          sourceUnit: normalizeValue(row?.sourceUnit || row?.qtyUnit || ''),
          rows: []
        };
      }
      acc[key].rows.push(row);
      if (!acc[key].sourceRequiredQty && Number(row?.sourceRequiredQty || 0)) acc[key].sourceRequiredQty = Number(row.sourceRequiredQty || 0);
      if (!acc[key].sourceUnit) acc[key].sourceUnit = normalizeValue(row?.sourceUnit || row?.qtyUnit || '');
      return acc;
    }, {}));

    // Formato protocolo: sin avatar/foto del producto. Cantidad expresada en KG
    // como pide el registro oficial; si la unidad no es de peso se muestra tal cual.
    const renderQtyKg = (row) => {
      const kg = Number(row.qtyKg || 0);
      if (kg > 0.000001) return kg.toFixed(3);
      return normalizeValue(row.qty) || '-';
    };

    const renderDataRow = (row, className = '') => `<tr class="${className}">
      <td class="planilla-proto-ing"><strong>${escapeHtml(row.ingredientName)}</strong>${row.relation ? `<small class="planilla-substitute-note"><i class="fa-solid fa-link"></i> ${escapeHtml(row.relation)}</small>` : ''}</td>
      <td>${escapeHtml(row.provider)}</td>
      <td>${escapeHtml(row.lotNumber)}</td>
      <td>${escapeHtml(formatIsoEs(row.expiryDate))}</td>
      <td class="planilla-qty-cell">${escapeHtml(renderQtyKg(row))}</td>
    </tr>`;

    return groups.map((group) => {
      const hasSubstitutes = group.rows.some((row) => row.isSubstitute);
      const totalUsed = group.rows.reduce((sum, row) => sum + Number(row.qtyRaw || 0), 0);
      const directUsed = group.rows.filter((row) => !row.isSubstitute).reduce((sum, row) => sum + Number(row.qtyRaw || 0), 0);
      if (!hasSubstitutes) return group.rows.map((row) => renderDataRow(row)).join('');
      const badge = directUsed > 0.0001 ? 'COMBINADO CON SUSTITUTOS' : 'CUBIERTO CON SUSTITUTOS';
      const directText = directUsed > 0.0001 ? `ORIGINAL USADO: ${formatQty(directUsed, group.sourceUnit)}` : 'INGREDIENTE ORIGINAL SIN CONSUMO DIRECTO';
      const sourceRequiredLabel = escapeHtml(formatQty(group.sourceRequiredQty || totalUsed, group.sourceUnit));
      const totalUsedLabel = escapeHtml(formatQty(totalUsed, group.sourceUnit));
      return `<tr class="planilla-source-row"><td colspan="5">
        <div class="planilla-source-head">
          <strong>${escapeHtml(normalizeUpper(group.sourceIngredientName))}</strong>
          <span><i class="fa-solid fa-link"></i> ${badge}</span>
        </div>
        <div class="planilla-source-meta">REQUERIDO: <b>${sourceRequiredLabel}</b> <span aria-hidden="true">|</span> TOTAL USADO: <b>${totalUsedLabel}</b> <span aria-hidden="true">|</span> ${escapeHtml(directText)}</div>
      </td></tr>${group.rows.map((row) => renderDataRow(row, row.isSubstitute ? 'planilla-substitute-row' : '')).join('')}`;
    }).join('') || '<tr><td colspan="5">SIN INGREDIENTES CARGADOS.</td></tr>';
  };

  const buildPlanillaHtml = (registro, context = {}) => {
    const rnpa = safeObject(registro?.traceability?.product?.rnpa);
    const rnpaDisplay = rnpa.exempt
      ? `NO REQUIERE RNPA${normalizeValue(rnpa.exemptReason) ? ` - ${normalizeUpper(rnpa.exemptReason)}` : ''}`
      : normalizeUpper(rnpa.number || '-');
    const commercialName = normalizeValue(registro?.recipeNombreComercial || registro?.traceability?.product?.nombreComercial);
    const ingredientRows = resolveIngredientRows(registro);
    const formulaRows = buildFormulaRows(ingredientRows);
    const managerLabel = resolveManagerNames(registro, context.usersMap);
    const totalIngredients = ingredientRows.reduce((acc, row) => acc + Number(row.qtyKg || 0), 0);
    const merma = Math.max(0, totalIngredients - Number(registro?.quantityKg || 0));
    const autoObservations = ingredientRows
      .map((row) => normalizeValue(row.autoObservation))
      .filter(Boolean)
      .join(' ');
    const observations = [
      normalizeValue(registro?.observations),
      autoObservations
    ].filter(Boolean).join(' · ') || 'SIN OBSERVACIONES';

    const observationsLabel = normalizeUpper(observations.replace(/\u00c2\u00b7/g, '|'));

    // Base de c\u00e1lculo: kilos sobre los que est\u00e1 calculada la receta (desde recetas).
    const yieldQty = Number(registro?.recipeYieldQuantity || 0);
    const yieldUnit = normalizeUpper(registro?.recipeYieldUnit || 'KG');
    const baseCalculoLabel = yieldQty > 0 ? `${yieldQty % 1 ? yieldQty.toFixed(2) : yieldQty} ${yieldUnit} DE PRODUCCI\u00d3N` : '-';
    const shelfLifeDays = Number(registro?.recipeShelfLifeDays || 0);
    const lapsoAptitudLabel = shelfLifeDays > 0
      ? `LAPSO DE APTITUD: ${shelfLifeDays} D\u00cdAS A PARTIR DE LA FECHA DE ENVASADO / ROTULADO`
      : '';
    // Ingredientes del r\u00f3tulo: nombres de las materias primas usadas en la producci\u00f3n.
    const rotuloIngredients = [...new Set(ingredientRows.map((row) => normalizeValue(row.ingredientName).toLowerCase()).filter(Boolean))].join(', ');
    // Encabezado "F. Elaboracion": mes/anio real de la produccion (fallback: alta del registro).
    const elaborationMonthLabel = formatMonthShortYearEs(registro?.productionDate || registro?.createdAt || '');

    return `<div class="planilla-card planilla-print-a4 planilla-proto" id="planillaProduccionPrintable">
      <table class="planilla-proto-head-table">
        <tbody>
          <tr>
            <td class="planilla-proto-brand">Frigor\u00edfico<br><strong>La Jamonera</strong></td>
            <td class="planilla-proto-doc-title">REGISTRO PROTOCOLO DE PRODUCCI\u00d3N</td>
            <td class="planilla-proto-version"><span>Versi\u00f3n <strong>004</strong></span><span>F. Elaboraci\u00f3n <strong>${escapeHtml(elaborationMonthLabel)}</strong></span></td>
          </tr>
          <tr>
            <td class="planilla-proto-format-label">FORMATO</td>
            <td colspan="2" class="planilla-proto-format-value">${escapeHtml(registro?.id || '-')} &bull; EMITIDO: ${escapeHtml(formatDateTime(registro?.createdAt))} &bull; RNE EMPRESA ${escapeHtml(registro?.traceability?.company?.rne?.number || '-')}</td>
          </tr>
        </tbody>
      </table>
      <table class="planilla-proto-fields-table">
        <tbody>
          <tr><th>FECHA DE ELABORACI\u00d3N</th><td>${escapeHtml(formatIsoEs(registro?.productionDate || '') || '-')}</td></tr>
          <tr><th>FECHA DE ${escapeHtml(getPackagingLabel(registro))} / ROTULADO</th><td>${escapeHtml(getPackagingDateDisplay(registro))}</td></tr>
          <tr><th>PRODUCTO</th><td><strong>${escapeHtml(normalizeUpper(registro?.recipeTitle || '-'))}</strong>${commercialName ? ` <small>(${escapeHtml(normalizeUpper(commercialName))})</small>` : ''}</td></tr>
          <tr><th>N\u00b0 LOTE ASIGNADO</th><td>${escapeHtml(getProductionLotDisplay(registro))}</td></tr>
          <tr><th>FECHA DE VENCIMIENTO</th><td>${escapeHtml(normalizeUpper(getProductExpiryDisplay(registro)))}</td></tr>
          <tr><th>BASE DE C\u00c1LCULO</th><td>${escapeHtml(baseCalculoLabel)}</td></tr>
          <tr><th>RNPA</th><td>${escapeHtml(rnpaDisplay)}</td></tr>
        </tbody>
      </table>
      <div class="planilla-table-scroll"><table class="planilla-table planilla-formula-table planilla-proto-formula">
        <thead><tr><th>MATERIA PRIMA</th><th>MARCA</th><th>N\u00b0 DE LOTE</th><th>VENCIMIENTO</th><th>CANTIDAD KG</th></tr></thead>
        <tbody>${formulaRows}
          <tr class="planilla-proto-total-row"><td colspan="4"><strong>TOTAL</strong></td><td class="planilla-qty-cell"><strong>${totalIngredients.toFixed(3)}</strong></td></tr>
        </tbody>
      </table></div>
      <p class="planilla-proto-aptitud">N/A: No Aplica${lapsoAptitudLabel ? `<br>${escapeHtml(lapsoAptitudLabel)}` : ''}</p>
      <table class="planilla-proto-fields-table">
        <tbody>
          <tr><th>CANTIDAD OBTENIDA DEL PRODUCTO EN KILOS</th><td>${escapeHtml(`${Number(registro?.quantityKg || 0).toFixed(2)} KG`)}${merma > 0.0005 ? ` <small>(MERMA ${merma.toFixed(3)} KG)</small>` : ''}</td></tr>
          <tr><th>FIRMA RESPONSABLE</th><td>${escapeHtml(normalizeUpper(managerLabel))}</td></tr>
        </tbody>
      </table>
      <section class="planilla-proto-bottom">
        <div class="planilla-proto-observations">
          <p><strong>OBSERVACIONES:</strong> ${escapeHtml(observationsLabel)}</p>
          ${rotuloIngredients ? `<p><strong>Ingredientes (r\u00f3tulo):</strong> ${escapeHtml(rotuloIngredients)}.</p>` : ''}
        </div>
        <article class="planilla-qr-card"><div id="planillaQrTarget"></div><p class="planilla-qr-note">QR trazabilidad</p></article>
      </section>
    </div>`;
  };

  const waitImages = async (root) => Promise.all([...(root?.querySelectorAll('img') || [])].map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  }))));

  const waitWindowLoad = (win) => new Promise((resolve) => {
    const finish = () => (win.document?.fonts ? win.document.fonts.ready.then(resolve, resolve) : resolve());
    if (!win || win.document.readyState === 'complete') { finish(); return; }
    win.addEventListener('load', finish, { once: true });
    setTimeout(resolve, 5000);
  });

  // Espera explícita de las hojas de estilo del popup de impresión: el readyState
  // puede quedar "complete" antes de que el CSS externo termine de bajar y la
  // impresora se abre con la planilla sin estilos. Cada <link> resuelve por load,
  // error o timeout de 4s.
  const waitStylesheets = (win) => Promise.all(
    [...(win?.document?.querySelectorAll('link[rel="stylesheet"]') || [])].map((link) => new Promise((resolve) => {
      if (link.sheet) return resolve();
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 4000);
    }))
  ).then(() => (win.document?.fonts ? win.document.fonts.ready.catch(() => {}) : null));

  const renderQr = (host, registro) => {
    if (!host || !window.QRCode) return;
    host.innerHTML = '';
    // eslint-disable-next-line no-new
    new window.QRCode(host, { text: getTraceUrl(registro), width: 130, height: 130, colorDark: '#111827', colorLight: '#ffffff' });
  };

  const buildPlanillaHeadHtml = (title) => `<title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css" integrity="sha512-Evv84Mr4kqVGRNSgIGL/F/aIDqQb7xQ2vcrdIwxfjThSH8CSR7PBEakCr51Ck+w+/U6swU2Im1vVX0SVk9ABhg==" crossorigin="anonymous" referrerpolicy="no-referrer">
    <link rel="stylesheet" href="./CSS/style.css">
    <style>body{font-family:"Inter","Segoe UI",Arial,sans-serif;padding:8px;background:#ffffff;}</style>`;

  const printPlanilla = async (root, registro) => {
    const win = window.open('', '_blank', 'width=1240,height=900');
    if (!win) return;
    const documentTitle = escapeHtml(getPlanillaDocumentTitle(registro));
    win.document.write(`<html><head>${buildPlanillaHeadHtml(documentTitle)}</head><body>${root.outerHTML}</body></html>`);
    win.document.close();
    await waitWindowLoad(win);
    // CSS primero, después la impresora: sin esto el diálogo podía abrirse con
    // la planilla sin estilos.
    try { await waitStylesheets(win); } catch (e) {}
    const printRoot = win.document.querySelector('#planillaProduccionPrintable');
    if (printRoot?.querySelector('.planilla-summary-grid')) printRoot.querySelector('.planilla-summary-grid').style.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
    const qrHost = win.document.querySelector('#planillaQrTarget');
    if (qrHost && window.QRCode) {
      renderQr(qrHost, registro);
    }
    try { await waitImages(win.document.body); } catch (e) {}
    await new Promise((resolve) => win.requestAnimationFrame ? win.requestAnimationFrame(() => resolve()) : setTimeout(resolve, 50));
    win.focus();
    win.print();
  };

  const createPrintableNode = async (registro, context = {}) => {
    await ensureQrLib();
    const enrichedRegistro = await enrichRegistroForPlanilla(registro, context);
    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-99999px';
    wrapper.style.top = '0';
    wrapper.innerHTML = buildPlanillaHtml(enrichedRegistro, context);
    document.body.appendChild(wrapper);
    const printable = wrapper.querySelector('#planillaProduccionPrintable');
    renderQr(printable?.querySelector('#planillaQrTarget'), enrichedRegistro);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const clone = printable ? printable.cloneNode(true) : null;
    wrapper.remove();
    return clone;
  };

  const printBatch = async (registros, context = {}, onProgress) => {
    const rows = Array.isArray(registros) ? registros : [];
    if (!rows.length) return;
    const printNodes = [];
    for (let index = 0; index < rows.length; index += 1) {
      const node = await createPrintableNode(rows[index], context);
      if (node) printNodes.push(node.outerHTML);
      const value = Math.min(95, Math.round(((index + 1) / rows.length) * 95));
      onProgress?.(value);
    }
    const win = window.open('', '_blank', 'width=1240,height=900');
    if (!win) return;
    win.document.write(`<html><head>${buildPlanillaHeadHtml('Planillas masivas')}<script>window.addEventListener('load',function(){(document.fonts?document.fonts.ready:Promise.resolve()).then(function(){window.print();});});<\/script></head><body style="display:grid;gap:12px;">${printNodes.map((html, index) => `<section style="${index ? 'page-break-before:always;' : ''}">${html}</section>`).join('')}</body></html>`);
    win.document.close();
    onProgress?.(100);
    win.focus();
  };

  const openByRegistro = async (registro, context = {}) => {
    if (!registro || typeof Swal === 'undefined') return;
    Swal.fire({ title: 'Generando planilla...', html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando planilla" class="meta-spinner-login"></div>', allowOutsideClick: false, showConfirmButton: false, customClass: { popup: 'ios-alert produccion-loading-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' } });
    const printable = await createPrintableNode(registro, context);
    Swal.close();
    if (!printable) return;

    if (window.matchMedia('(max-width: 768px)').matches && !context.forceModalOnMobile) {
      await printPlanilla(printable, registro);
      return;
    }

    await Swal.fire({
      title: `Planilla ${escapeHtml(registro.id || '')}`,
      html: `<div class="planilla-toolbar"><button type="button" class="btn ios-btn ios-btn-secondary" id="planillaPrintBtn"><i class="fa-solid fa-print"></i><span>Imprimir</span></button></div>${printable.outerHTML}`,
      width: '98vw',
      confirmButtonText: 'Cerrar',
      customClass: { popup: 'produccion-trace-alert planilla-modal', confirmButton: 'ios-btn ios-btn-secondary' },
      didOpen: async (popup) => {
        const node = popup.querySelector('#planillaProduccionPrintable');
        if (!node) return;
        renderQr(node.querySelector('#planillaQrTarget'), registro);
        await waitImages(node);
        popup.querySelector('#planillaPrintBtn')?.addEventListener('click', async () => printPlanilla(node, registro));
      }
    });
  };

  const openById = async (productionId, context = {}) => {
    const id = normalizeValue(productionId);
    if (!id) return;
    const registro = await window.laJamoneraProduccionAPI?.getRegistroById?.(id);
    if (!registro) {
      await Swal.fire({ title: 'Sin datos', html: '<p>No se encontró la producción solicitada.</p>', icon: 'warning' });
      return;
    }
    await openByRegistro(registro, context);
  };

  window.laJamoneraPlanillaProduccion = { openByRegistro, openById, getTraceUrl, printBatch };
})();
