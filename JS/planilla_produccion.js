(function planillaProduccionModule() {
  const TRACE_BASE_URL = 'https://lucasponzoni.github.io/La-Jamonera/';

  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const formatIsoEs = (iso) => {
    const text = normalizeValue(iso);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return text || '-';
    return `${match[3]}-${match[2]}-${match[1]}`;
  };

  const formatDateTime = (value) => {
    const d = new Date(Number(value));
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatQty = (value, unit = '') => `${Number(value || 0).toFixed(3)} ${unit}`.trim();

  const loadScript = (src, id) => new Promise((resolve) => {
    const existing = document.getElementById(id);
    if (existing) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  const ensureQrLib = async () => {
    if (window.QRCode) return true;
    return loadScript('https://cdn.jsdelivr.net/npm/qrcodejs2@0.0.2/qrcode.min.js', 'la-jamonera-qrcode');
  };

  const getTraceUrl = (registro) => normalizeValue(registro?.publicTraceUrl) || `${TRACE_BASE_URL}${encodeURIComponent(normalizeValue(registro?.id))}`;

  const resolveManagerNames = (registro, usersMap = {}) => {
    const tokens = Array.isArray(registro?.managers) ? registro.managers : [];
    if (!tokens.length) return 'SIN RESPONSABLE';
    const users = safeObject(usersMap);
    const labels = tokens.map((token) => {
      const user = safeObject(users[token]);
      const full = normalizeValue(user.fullName || user.name || token);
      const role = normalizeValue(user.role || user.position || 'RESPONSABLE');
      return `${full} (${role})`;
    });
    return labels.join(', ');
  };

  const resolveIngredientRows = (registro) => {
    const plans = Array.isArray(registro?.lots) ? registro.lots : [];
    const traceIngredients = Array.isArray(registro?.traceability?.ingredients) ? registro.traceability.ingredients : [];
    return plans.map((plan) => {
      const lot = Array.isArray(plan?.lots) && plan.lots[0] ? plan.lots[0] : {};
      const traceIngredient = traceIngredients.find((row) => normalizeValue(row?.ingredientId) === normalizeValue(plan?.ingredientId));
      const traceLot = Array.isArray(traceIngredient?.lots) && traceIngredient.lots[0] ? traceIngredient.lots[0] : {};
      const providerRne = normalizeValue(lot?.providerRne?.number || traceLot?.providerRne?.number || '-');
      return {
        ingredientName: plan?.ingredientName || traceIngredient?.ingredientName || 'INGREDIENTE',
        ingredientImage: normalizeValue(plan?.ingredientImageUrl || traceIngredient?.ingredientImageUrl),
        provider: lot?.provider || traceLot?.provider || '-',
        lotNumber: lot?.lotNumber || lot?.entryId || traceLot?.lotNumber || traceLot?.entryId || '-',
        expiryDate: lot?.expiryDate || traceLot?.expiryDate || '-',
        rne: providerRne,
        qty: formatQty(plan?.neededQty ?? plan?.requiredQty, plan?.ingredientUnit || plan?.unit || '')
      };
    });
  };

  const buildPlanillaHtml = (registro, context = {}) => {
    const productImage = normalizeValue(registro?.traceability?.product?.imageUrl);
    const rnpa = safeObject(registro?.traceability?.product?.rnpa);
    const ingredientRows = resolveIngredientRows(registro);
    const managerLabel = resolveManagerNames(registro, context.usersMap);
    const totalIngredients = ingredientRows.reduce((acc, row) => {
      const numeric = Number(String(row.qty || '').replace(/[^0-9.,-]/g, '').replace(',', '.'));
      return acc + (Number.isFinite(numeric) ? numeric : 0);
    }, 0);
    const merma = Math.max(0, totalIngredients - Number(registro?.quantityKg || 0));
    const observations = normalizeValue(registro?.observations) || 'SIN OBSERVACIONES';

    return `<div class="planilla-card planilla-print-a4" id="planillaProduccionPrintable">
      <header class="planilla-card-header">
        <h2>REGISTRO DE PROTOCOLO DE PRODUCCIÓN</h2>
        <p>FRIGORIFICO • LA JAMONERA S.A.</p>
      </header>

      <section class="planilla-summary-grid">
        <div class="planilla-summary-item"><strong>PERIODO DE ELABORACIÓN</strong><span>${escapeHtml(formatIsoEs(registro?.productionDate || ''))}</span></div>
        <div class="planilla-summary-item"><strong>RNE</strong><span>${escapeHtml(registro?.traceability?.company?.rne?.number || '-')}</span></div>
        <div class="planilla-summary-item"><strong>FECHA ELABORACIÓN</strong><span>${escapeHtml(formatIsoEs(registro?.productionDate || ''))}</span></div>
        <div class="planilla-summary-item"><strong>FECHA ENVASADO</strong><span>${escapeHtml(formatIsoEs(registro?.packagingDate || ''))}</span></div>
        <div class="planilla-summary-item"><strong>PRODUCTO</strong><span>${escapeHtml(registro?.recipeTitle || '-')}</span></div>
        <div class="planilla-summary-item"><strong>N° LOTE</strong><span>${escapeHtml(registro?.id || '-')}</span></div>
        <div class="planilla-summary-item"><strong>VENCIMIENTO</strong><span>${escapeHtml(formatIsoEs(registro?.productExpiryDate || ''))}</span></div>
        <div class="planilla-summary-item"><strong>RNPA PRODUCTO</strong><span>${escapeHtml(rnpa.number || '-')}</span></div>
      </section>

      <section class="planilla-product-hero">
        <span class="planilla-avatar planilla-avatar-lg">${productImage ? `<img src="${escapeHtml(productImage)}" alt="PRODUCTO">` : '<i class="fa-solid fa-drumstick-bite"></i>'}</span>
        <div>
          <h3>${escapeHtml(registro?.recipeTitle || '-')}</h3>
          <p>${escapeHtml(registro?.id || '-')} • ${escapeHtml(formatDateTime(registro?.createdAt))}</p>
        </div>
      </section>

      <section class="planilla-formula-card">
        <h3>FÓRMULA</h3>
        <div class="planilla-table-scroll">
          <table class="planilla-table">
            <thead><tr><th>MATERIA PRIMA</th><th>PROVEEDOR</th><th>LOTE</th><th>VENCIMIENTO</th><th>RNE</th><th>CANTIDAD</th></tr></thead>
            <tbody>
              ${ingredientRows.map((row) => `<tr><td><div class="planilla-ingredient-main"><span class="planilla-avatar">${row.ingredientImage ? `<img src="${escapeHtml(row.ingredientImage)}" alt="${escapeHtml(row.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span><strong>${escapeHtml(row.ingredientName)}</strong></div></td><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.lotNumber)}</td><td>${escapeHtml(formatIsoEs(row.expiryDate))}</td><td>${escapeHtml(row.rne)}</td><td>${escapeHtml(row.qty)}</td></tr>`).join('') || '<tr><td colspan="6">SIN INGREDIENTES CARGADOS.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      <section class="planilla-kpis-grid">
        <p><strong>CANTIDAD TOTAL OBTENIDA:</strong> ${Number(registro?.quantityKg || 0).toFixed(2)} KG</p>
        <p><strong>MERMA:</strong> ${merma.toFixed(3)} KG</p>
        <p><strong>RESPONSABLE:</strong> ${escapeHtml(managerLabel)}</p>
        <p><strong>OBSERVACIONES:</strong> ${escapeHtml(observations)}</p>
      </section>

      <section class="planilla-footer-grid planilla-footer-grid-single">
        <article class="planilla-qr-card">
          <div id="planillaQrTarget"></div>
          <p class="planilla-qr-note">ESCANEÁ EL QR CON TU CELULAR PARA ACCEDER A LA TRAZABILIDAD COMPLETA DEL PRODUCTO.</p>
        </article>
      </section>
    </div>`;
  };

  const waitImages = async (root) => {
    const images = [...root.querySelectorAll('img')];
    if (!images.length) return;
    await Promise.all(images.map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }))));
  };

  const printPlanilla = async (root) => {
    const win = window.open('', '_blank', 'width=1240,height=900');
    if (!win) return;
    win.document.write(`<html><head><title>Planilla de producción</title><link rel="stylesheet" href="./CSS/style.css"></head><body style="padding:8px;background:#ffffff;">${root.outerHTML}</body></html>`);
    win.document.close();
    await new Promise((resolve) => setTimeout(resolve, 220));
    const images = [...win.document.querySelectorAll('img')];
    await Promise.all(images.map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }))));
    win.focus();
    win.print();
  };

  const downloadPdf = async (root, id) => {
    if (!window.html2canvas || !window.jspdf?.jsPDF) return;
    await waitImages(root);
    const canvas = await window.html2canvas(root, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const img = canvas.toDataURL('image/png');
    const pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    pdf.addImage(img, 'PNG', (pageWidth - w) / 2, 4, w, h);
    pdf.save(`planilla_${normalizeValue(id) || Date.now()}.pdf`);
  };

  const openByRegistro = async (registro, context = {}) => {
    if (!registro || typeof Swal === 'undefined') return;
    Swal.fire({
      title: 'Generando planilla...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando planilla" class="meta-spinner-login"></div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert produccion-loading-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' }
    });

    await ensureQrLib();
    const html = buildPlanillaHtml(registro, context);
    Swal.close();

    await Swal.fire({
      title: `Planilla ${escapeHtml(registro.id || '')}`,
      html: `<div class="planilla-toolbar"><button type="button" class="btn ios-btn ios-btn-secondary" id="planillaPrintBtn"><i class="fa-solid fa-print"></i><span>IMPRIMIR</span></button><button type="button" class="btn ios-btn ios-btn-primary" id="planillaPdfBtn"><i class="fa-solid fa-file-pdf"></i><span>DESCARGAR PDF</span></button></div>${html}`,
      width: '96vw',
      confirmButtonText: 'Cerrar',
      customClass: { popup: 'produccion-trace-alert', confirmButton: 'ios-btn ios-btn-secondary' },
      didOpen: async (popup) => {
        const printable = popup.querySelector('#planillaProduccionPrintable');
        const qrTarget = popup.querySelector('#planillaQrTarget');
        if (qrTarget && window.QRCode) {
          // eslint-disable-next-line no-new
          new window.QRCode(qrTarget, { text: getTraceUrl(registro), width: 170, height: 170, colorDark: '#111827', colorLight: '#ffffff' });
        }
        if (printable) {
          await waitImages(printable);
          popup.querySelector('#planillaPrintBtn')?.addEventListener('click', async () => printPlanilla(printable));
          popup.querySelector('#planillaPdfBtn')?.addEventListener('click', async () => downloadPdf(printable, registro.id));
        }
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

  window.laJamoneraPlanillaProduccion = {
    openByRegistro,
    openById,
    getTraceUrl
  };
})();
