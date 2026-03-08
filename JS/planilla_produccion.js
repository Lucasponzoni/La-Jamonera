(function planillaProduccionModule() {
  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
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

  const formatDateTime = (value) => {
    const d = new Date(Number(value));
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatQty = (value, unit = '') => `${Number(value || 0).toFixed(3)} ${unit}`.trim();
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

  const resolveManagerNames = (registro, usersMap = {}) => {
    const tokens = Array.isArray(registro?.managers) ? registro.managers : [];
    if (!tokens.length) return 'SIN RESPONSABLE';
    return tokens.map((token) => {
      const user = safeObject(usersMap[token]);
      const full = normalizeValue(user.fullName || user.name || token);
      const role = normalizeValue(user.role || user.position || 'RESPONSABLE');
      return `${full} (${role})`;
    }).join(', ');
  };

  const resolveIngredientRows = (registro) => {
    const plans = Array.isArray(registro?.lots) ? registro.lots : [];
    const traceIngredients = Array.isArray(registro?.traceability?.ingredients) ? registro.traceability.ingredients : [];
    const joinUnique = (items = []) => {
      const normalized = items.map((item) => normalizeValue(item)).filter(Boolean);
      const unique = [...new Set(normalized)];
      return unique.length ? unique.join(' | ') : '-';
    };
    return plans.map((plan) => {
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
          provider: normalizeValue(lot?.provider || '-'),
          qtyLabel: formatQty(usedQty, unit)
        };
      });
      const firstLot = lots[0] || {};
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
      return {
        ingredientName: plan?.ingredientName || traceIngredient?.ingredientName || 'INGREDIENTE',
        ingredientImage: normalizeValue(plan?.ingredientImageUrl || traceIngredient?.ingredientImageUrl),
        provider: joinUnique(providers),
        lotNumber: joinUnique(lotNumbers),
        expiryDate: firstLot?.expiryDate || '-',
        rne: joinUnique(rnes),
        qty: formatQty(plan?.neededQty ?? plan?.requiredQty, plan?.ingredientUnit || plan?.unit || ''),
        qtyKg: toKg(plan?.neededQty ?? plan?.requiredQty, plan?.ingredientUnit || plan?.unit || ''),
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

  const buildPlanillaHtml = (registro, context = {}) => {
    const rnpa = safeObject(registro?.traceability?.product?.rnpa);
    const ingredientRows = resolveIngredientRows(registro);
    const managerLabel = resolveManagerNames(registro, context.usersMap);
    const totalIngredients = ingredientRows.reduce((acc, row) => acc + Number(row.qtyKg || 0), 0);
    const merma = Math.max(0, totalIngredients - Number(registro?.quantityKg || 0));
    const autoObservations = ingredientRows
      .map((row) => normalizeValue(row.autoObservation))
      .filter(Boolean)
      .join(' ');
    const observations = [normalizeValue(registro?.observations), autoObservations]
      .filter(Boolean)
      .join(' · ') || 'SIN OBSERVACIONES';

    return `<div class="planilla-card planilla-print-a4" id="planillaProduccionPrintable">
      <header class="planilla-card-header"><h2>REGISTRO DE PROTOCOLO DE PRODUCCIÓN</h2><p>FRIGORIFICO • LA JAMONERA S.A.</p></header>
      <section class="planilla-summary-grid">
        <div class="planilla-summary-item"><strong>PERIODO DE ELABORACIÓN</strong><span>${escapeHtml(formatMonthYearEs(registro?.productionDate || ''))}</span></div>
        <div class="planilla-summary-item"><strong>RNE</strong><span>${escapeHtml(registro?.traceability?.company?.rne?.number || '-')}</span></div>
        <div class="planilla-summary-item"><strong>FECHA ELABORACIÓN</strong><span>${escapeHtml(formatIsoEs(registro?.productionDate || ''))}</span></div>
        <div class="planilla-summary-item"><strong>FECHA ENVASADO</strong><span>${escapeHtml(formatIsoEs(registro?.packagingDate || ''))}</span></div>
        <div class="planilla-summary-item"><strong>PRODUCTO</strong><span>${escapeHtml(registro?.recipeTitle || '-')}</span></div>
        <div class="planilla-summary-item"><strong>N° LOTE</strong><span>${escapeHtml(registro?.id || '-')}</span></div>
        <div class="planilla-summary-item"><strong>VENCIMIENTO</strong><span>${escapeHtml(formatIsoEs(registro?.productExpiryDate || ''))}</span></div>
        <div class="planilla-summary-item"><strong>RNPA PRODUCTO</strong><span>${escapeHtml(rnpa.number || '-')}</span></div>
      </section>
      <section class="planilla-product-hero planilla-product-hero-no-image"><div><h3>${escapeHtml(registro?.recipeTitle || '-')}</h3><p>${escapeHtml(registro?.id || '-')} • ${escapeHtml(formatDateTime(registro?.createdAt))}</p></div></section>
      <section class="planilla-formula-card"><h3>FÓRMULA</h3><div class="planilla-table-scroll"><table class="planilla-table"><thead><tr><th>MATERIA PRIMA</th><th>PROVEEDOR</th><th>LOTE</th><th>VENCIMIENTO</th><th>RNE</th><th>CANTIDAD</th></tr></thead><tbody>${ingredientRows.map((row) => `<tr><td><div class="planilla-ingredient-main"><span class="planilla-avatar">${row.ingredientImage ? `<img src="${escapeHtml(row.ingredientImage)}" alt="${escapeHtml(row.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span><strong>${escapeHtml(row.ingredientName)}</strong></div></td><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.lotNumber)}</td><td>${escapeHtml(formatIsoEs(row.expiryDate))}</td><td>${escapeHtml(row.rne)}</td><td>${escapeHtml(row.qty)}</td></tr>`).join('') || '<tr><td colspan="6">SIN INGREDIENTES CARGADOS.</td></tr>'}</tbody></table></div></section>
      <section class="planilla-kpis-grid"><p><strong>CANTIDAD TOTAL OBTENIDA:</strong> ${Number(registro?.quantityKg || 0).toFixed(2)} KG</p><p><strong>MERMA:</strong> ${merma.toFixed(3)} KG</p><p><strong>RESPONSABLE:</strong> ${escapeHtml(managerLabel)}</p><p><strong>OBSERVACIONES:</strong> ${escapeHtml(observations)}</p></section>
      <section class="planilla-footer-grid planilla-footer-grid-single"><article class="planilla-qr-card"><div id="planillaQrTarget"></div><p class="planilla-qr-note">Escaneá el <strong>QR</strong> con tu celular para acceder a la <strong>trazabilidad completa</strong> del producto.</p></article></section>
    </div>`;
  };

  const waitImages = async (root) => Promise.all([...(root?.querySelectorAll('img') || [])].map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  }))));

  const renderQr = (host, registro) => {
    if (!host || !window.QRCode) return;
    host.innerHTML = '';
    // eslint-disable-next-line no-new
    new window.QRCode(host, { text: getTraceUrl(registro), width: 130, height: 130, colorDark: '#111827', colorLight: '#ffffff' });
  };

  const printPlanilla = async (root, registro) => {
    const win = window.open('', '_blank', 'width=1240,height=900');
    if (!win) return;
    win.document.write(`<html><head><title>Planilla de producción</title><link rel="stylesheet" href="./CSS/style.css"></head><body style="padding:8px;background:#ffffff;">${root.outerHTML}</body></html>`);
    win.document.close();
    await new Promise((resolve) => setTimeout(resolve, 240));
    const printRoot = win.document.querySelector('#planillaProduccionPrintable');
    if (printRoot?.querySelector('.planilla-summary-grid')) printRoot.querySelector('.planilla-summary-grid').style.gridTemplateColumns = '1fr 1fr';
    const qrHost = win.document.querySelector('#planillaQrTarget');
    if (qrHost && window.QRCode) {
      renderQr(qrHost, registro);
    }
    await waitImages(win.document.body);
    win.focus();
    win.print();
  };

  const createPrintableNode = async (registro, context = {}) => {
    await ensureQrLib();
    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-99999px';
    wrapper.style.top = '0';
    wrapper.innerHTML = buildPlanillaHtml(registro, context);
    document.body.appendChild(wrapper);
    const printable = wrapper.querySelector('#planillaProduccionPrintable');
    renderQr(printable?.querySelector('#planillaQrTarget'), registro);
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
      onProgress?.(Math.round(((index + 1) / rows.length) * 100));
    }
    const win = window.open('', '_blank', 'width=1240,height=900');
    if (!win) return;
    win.document.write(`<html><head><title>Planillas masivas</title><link rel="stylesheet" href="./CSS/style.css"></head><body style="padding:8px;background:#ffffff;display:grid;gap:12px;">${printNodes.map((html, index) => `<section style="${index ? 'page-break-before:always;' : ''}">${html}</section>`).join('')}</body></html>`);
    win.document.close();
    await waitImages(win.document.body);
    win.focus();
    win.print();
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
