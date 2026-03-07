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
  const CORS_PROXY_URL = normalizeValue(window.CORS_PROXY_URL) || 'https://proxy.cors.sh/';
  const CORS_PROXY_KEY = normalizeValue(window.CORS_PROXY_KEY) || 'live_36d58f4c13cb7d838833506e8f6450623bf2605859ac089fa008cfeddd29d8dd';

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
    return plans.map((plan) => {
      const lot = (Array.isArray(plan?.lots) ? plan.lots : [])[0] || {};
      const traceIngredient = traceIngredients.find((row) => normalizeValue(row?.ingredientId) === normalizeValue(plan?.ingredientId));
      const traceLot = ((Array.isArray(traceIngredient?.lots) ? traceIngredient.lots : [])[0]) || {};
      const takeQty = Number(lot?.takeQty || traceLot?.takeQty || 0);
      const availableQty = Number(lot?.availableQty || traceLot?.availableQty || 0);
      const remainingQty = Math.max(0, availableQty - takeQty);
      return {
        ingredientName: plan?.ingredientName || traceIngredient?.ingredientName || 'INGREDIENTE',
        ingredientImage: normalizeValue(plan?.ingredientImageUrl || traceIngredient?.ingredientImageUrl),
        provider: lot?.provider || traceLot?.provider || '-',
        lotNumber: lot?.lotNumber || lot?.entryId || traceLot?.lotNumber || traceLot?.entryId || '-',
        expiryDate: lot?.expiryDate || traceLot?.expiryDate || '-',
        rne: normalizeValue(lot?.providerRne?.number || traceLot?.providerRne?.number || '-'),
        qty: formatQty(plan?.neededQty ?? plan?.requiredQty, plan?.ingredientUnit || plan?.unit || ''),
        available: formatQty(availableQty, lot?.unit || plan?.ingredientUnit || plan?.unit || ''),
        remaining: formatQty(remainingQty, lot?.unit || plan?.ingredientUnit || plan?.unit || ''),
        invoiceNumber: normalizeValue(lot?.invoiceNumber || traceLot?.invoiceNumber || '-'),
        entryDate: formatIsoEs(lot?.entryDate || traceLot?.entryDate || '-')
      };
    });
  };

  const buildPlanillaHtml = (registro, context = {}) => {
    const rnpa = safeObject(registro?.traceability?.product?.rnpa);
    const ingredientRows = resolveIngredientRows(registro);
    const managerLabel = resolveManagerNames(registro, context.usersMap);
    const totalIngredients = ingredientRows.reduce((acc, row) => acc + (Number(String(row.qty || '').replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0), 0);
    const merma = Math.max(0, totalIngredients - Number(registro?.quantityKg || 0));
    const observations = normalizeValue(registro?.observations) || 'SIN OBSERVACIONES';

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

  const blobToDataUrl = (blob) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result || '');
    reader.readAsDataURL(blob);
  });

  const showProgress = (title, value, text = '') => {
    const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
    return Swal.fire({
      title,
      html: `<div class="planilla-progress-wrap"><div class="planilla-progress-bar"><span style="width:${safeValue}%;"></span></div><p class="planilla-progress-text">${safeValue}% ${escapeHtml(text)}</p></div>`,
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert produccion-loading-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' }
    });
  };

  const fetchImageAsDataUrl = async (src) => {
    if (!src || /^data:/i.test(src)) return src;
    const proxyUrl = `${CORS_PROXY_URL}${encodeURIComponent(src)}`;
    const response = await fetch(proxyUrl, { headers: { 'x-cors-api-key': CORS_PROXY_KEY } });
    if (!response.ok) return '';
    return blobToDataUrl(await response.blob());
  };

  const makePdfSafeClone = async (root, onProgress) => {
    const clone = root.cloneNode(true);
    const images = [...clone.querySelectorAll('img')];
    for (let index = 0; index < images.length; index += 1) {
      const img = images[index];
      const src = normalizeValue(img.getAttribute('src'));
      if (src && !/^data:/i.test(src)) {
        try {
          const dataUrl = await fetchImageAsDataUrl(src);
          if (dataUrl) img.setAttribute('src', dataUrl);
        } catch (error) {
        }
      }
      onProgress?.(20 + Math.round(((index + 1) / Math.max(1, images.length)) * 40));
    }
    return clone;
  };

  const printPlanilla = async (root) => {
    const win = window.open('', '_blank', 'width=1240,height=900');
    if (!win) return;
    win.document.write(`<html><head><title>Planilla de producción</title><link rel="stylesheet" href="./CSS/style.css"></head><body style="padding:8px;background:#ffffff;">${root.outerHTML}</body></html>`);
    win.document.close();
    await new Promise((resolve) => setTimeout(resolve, 240));
    const printRoot = win.document.querySelector('#planillaProduccionPrintable');
    if (printRoot?.querySelector('.planilla-summary-grid')) printRoot.querySelector('.planilla-summary-grid').style.gridTemplateColumns = '1fr 1fr';
    await waitImages(win.document.body);
    win.focus();
    win.print();
  };

  const createPrintableNode = async (registro, context = {}) => {
    await ensureQrLib();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildPlanillaHtml(registro, context);
    const printable = wrapper.querySelector('#planillaProduccionPrintable');
    if (!printable) return null;
    const qrTarget = printable.querySelector('#planillaQrTarget');
    if (qrTarget && window.QRCode) {
      // eslint-disable-next-line no-new
      new window.QRCode(qrTarget, { text: getTraceUrl(registro), width: 130, height: 130, colorDark: '#111827', colorLight: '#ffffff' });
    }
    return printable;
  };

  const downloadPdf = async (root, id) => {
    if (!window.html2canvas || !window.jspdf?.jsPDF) return;
    await showProgress('Generando PDF...', 5, 'Iniciando');
    const clone = await makePdfSafeClone(root, (value) => showProgress('Generando PDF...', value, 'Procesando adjuntos'));
    clone.style.position = 'fixed';
    clone.style.left = '-99999px';
    clone.style.top = '0';
    document.body.appendChild(clone);
    await waitImages(clone);
    await showProgress('Generando PDF...', 70, 'Renderizando');
    const canvas = await window.html2canvas(clone, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    clone.remove();
    const pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pageWidth - (canvas.width * ratio)) / 2, 4, canvas.width * ratio, canvas.height * ratio);
    await showProgress('Generando PDF...', 100, 'Listo');
    pdf.save(`planilla_${normalizeValue(id) || Date.now()}.pdf`);
    Swal.close();
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

    if (window.matchMedia('(max-width: 768px)').matches) {
      await printPlanilla(printable);
      return;
    }

    await Swal.fire({
      title: `Planilla ${escapeHtml(registro.id || '')}`,
      html: `<div class="planilla-toolbar"><button type="button" class="btn ios-btn ios-btn-secondary" id="planillaPrintBtn"><i class="fa-solid fa-print"></i><span>Imprimir</span></button><button type="button" class="btn ios-btn ios-btn-primary" id="planillaPdfBtn"><i class="fa-solid fa-file-pdf"></i><span>Descargar PDF</span></button></div>${printable.outerHTML}`,
      width: '98vw',
      confirmButtonText: 'Cerrar',
      customClass: { popup: 'produccion-trace-alert planilla-modal', confirmButton: 'ios-btn ios-btn-secondary' },
      didOpen: async (popup) => {
        const node = popup.querySelector('#planillaProduccionPrintable');
        if (!node) return;
        await waitImages(node);
        popup.querySelector('#planillaPrintBtn')?.addEventListener('click', async () => printPlanilla(node));
        popup.querySelector('#planillaPdfBtn')?.addEventListener('click', async () => downloadPdf(node, registro.id));
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
