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
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => resolve(Boolean(window.QRCode)), { once: true });
      resolve(Boolean(window.QRCode));
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

  const getIngredientRows = (registro) => {
    const source = Array.isArray(registro?.lots) ? registro.lots : [];
    return source.map((item) => {
      const lot = Array.isArray(item?.lots) && item.lots[0] ? item.lots[0] : {};
      const providerRne = safeObject(lot?.providerRne);
      const ingredientImage = normalizeValue(item?.ingredientImageUrl) || normalizeValue(registro?.traceability?.ingredients?.find((i) => i.ingredientId === item.ingredientId)?.ingredientImageUrl);
      return {
        ingredientName: item?.ingredientName || 'Ingrediente',
        ingredientImage,
        provider: lot?.provider || '-',
        lotNumber: lot?.lotNumber || lot?.entryId || '-',
        expiryDate: lot?.expiryDate || '-',
        rne: providerRne?.number || '-',
        qty: formatQty(item?.neededQty ?? item?.requiredQty, item?.ingredientUnit || item?.unit || '')
      };
    });
  };

  const buildPlanillaHtml = (registro, options = {}) => {
    const companyLogo = normalizeValue(options.companyLogoUrl);
    const productImage = normalizeValue(registro?.traceability?.product?.imageUrl);
    const ingredientRows = getIngredientRows(registro);
    const managers = Array.isArray(registro?.managers) ? registro.managers.join(', ') : '-';
    return `<div class="planilla-produccion-wrap" id="planillaProduccionPrintable">
      <header class="planilla-head text-center">
        <h2>REGISTRO DE PROTOCOLO DE PRODUCCIÓN</h2>
        <p><strong>FRIGORIFICO • LA JAMONERA S.A.</strong></p>
      </header>
      <section class="planilla-meta-grid">
        <p><strong>PERIODO DE ELABORACION:</strong> ${escapeHtml(formatIsoEs(registro?.productionDate || ''))}</p>
        <p><strong>RNE:</strong> ${escapeHtml(registro?.traceability?.company?.rne?.number || '-')}</p>
        <p><strong>FECHA ELABORACION:</strong> ${escapeHtml(formatIsoEs(registro?.productionDate || ''))}</p>
        <p><strong>FECHA DE ENVASADO ROTULADO:</strong> ${escapeHtml(formatIsoEs(registro?.packagingDate || ''))}</p>
        <p><strong>PRODUCTO:</strong> ${escapeHtml(registro?.recipeTitle || '-')}</p>
        <p><strong>N DE LOTE ASIGNADO:</strong> ${escapeHtml(registro?.id || '-')}</p>
        <p><strong>FECHA DE VENCIMIENTO:</strong> ${escapeHtml(formatIsoEs(registro?.productExpiryDate || ''))}</p>
      </section>
      <section class="planilla-product-chip">
        <span class="planilla-circle">${productImage ? `<img src="${escapeHtml(productImage)}" alt="Producto">` : '<i class="fa-solid fa-drumstick-bite"></i>'}</span>
        <div><strong>${escapeHtml(registro?.recipeTitle || '-')}</strong><small>${escapeHtml(registro?.id || '-')} • ${escapeHtml(formatDateTime(registro?.createdAt))}</small></div>
      </section>
      <section class="planilla-formula-wrap">
        <h3>FORMULA</h3>
        <div class="planilla-table-scroll">
          <table class="planilla-table">
            <thead><tr><th>MATERIA PRIMA</th><th>PROVEEDOR</th><th>LOTE</th><th>VENCIMIENTO</th><th>RNE</th><th>CANTIDAD</th></tr></thead>
            <tbody>${ingredientRows.map((row) => `<tr><td><div class="planilla-ingredient-cell"><span class="planilla-circle planilla-circle-sm">${row.ingredientImage ? `<img src="${escapeHtml(row.ingredientImage)}" alt="${escapeHtml(row.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span><strong>${escapeHtml(row.ingredientName)}</strong></div></td><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.lotNumber)}</td><td>${escapeHtml(formatIsoEs(row.expiryDate))}</td><td>${escapeHtml(row.rne)}</td><td>${escapeHtml(row.qty)}</td></tr>`).join('') || '<tr><td colspan="6">Sin ingredientes.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
      <section class="planilla-notes-grid">
        <p><strong>CANTIDAD TOTAL OBTENIDA:</strong> ${Number(registro?.quantityKg || 0).toFixed(2)} kg</p>
        <p><strong>MERMA:</strong> ${Math.max(0, ingredientRows.reduce((acc, row) => acc + Number(String(row.qty).replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0, 0) - Number(registro?.quantityKg || 0)).toFixed(3)} kg</p>
        <p><strong>RESPONSIBLE:</strong> ${escapeHtml(managers || '-')}</p>
        <p><strong>OBSERVACIONES:</strong> ${escapeHtml(registro?.observations || '-')}</p>
      </section>
      <section class="planilla-sign-area"><span>FIRMA Y ACLARACION RESPONSIBLE</span></section>
      <section class="planilla-bottom">
        <div class="planilla-qr-block"><div id="planillaQrTarget"></div><small>ESCANEÁ EL <strong>QR CON TU CELULAR</strong> PARA ACCEDER A LA TRAZABILIDAD.</small></div>
        <div class="planilla-company-logo">${companyLogo ? `<img src="${escapeHtml(companyLogo)}" alt="Logo empresa">` : '<span>LOGO EMPRESA</span>'}</div>
      </section>
    </div>`;
  };

  const waitImages = async (root) => {
    const imgs = [...root.querySelectorAll('img')];
    if (!imgs.length) return;
    await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }))));
  };

  const printPlanilla = async (root) => {
    const win = window.open('', '_blank', 'width=1280,height=900');
    if (!win) return;
    win.document.write(`<html><head><title>Planilla de producción</title><link rel="stylesheet" href="./CSS/style.css"></head><body>${root.outerHTML}</body></html>`);
    win.document.close();
    await new Promise((r) => setTimeout(r, 200));
    const imgs = [...win.document.querySelectorAll('img')];
    await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => {
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
    pdf.addImage(img, 'PNG', (pageWidth - w) / 2, 6, w, h);
    pdf.save(`planilla_${normalizeValue(id) || Date.now()}.pdf`);
  };

  const openPlanillaByRegistro = async (registro, context = {}) => {
    if (!registro || typeof Swal === 'undefined') return;
    Swal.fire({
      title: 'Preparando planilla...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando planilla" class="meta-spinner-login"></div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' }
    });
    await ensureQrLib();
    const html = buildPlanillaHtml(registro, context);
    Swal.close();
    await Swal.fire({
      title: `Planilla ${escapeHtml(registro.id || '')}`,
      html: `<div class="planilla-actions"><button type="button" class="btn ios-btn ios-btn-secondary" id="planillaPdfBtn"><i class="fa-solid fa-file-pdf"></i><span>Descargar PDF</span></button><button type="button" class="btn ios-btn ios-btn-secondary" id="planillaPrintBtn"><i class="fa-solid fa-print"></i><span>Imprimir</span></button></div>${html}`,
      width: '95vw',
      confirmButtonText: 'Cerrar',
      customClass: { popup: 'produccion-trace-alert' },
      didOpen: async (popup) => {
        const printable = popup.querySelector('#planillaProduccionPrintable');
        const qrTarget = popup.querySelector('#planillaQrTarget');
        if (qrTarget && window.QRCode) {
          const url = getTraceUrl(registro);
          // eslint-disable-next-line no-new
          new window.QRCode(qrTarget, { text: url, width: 120, height: 120, colorDark: '#1f2a44', colorLight: '#ffffff' });
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
    const reg = await window.laJamoneraProduccionAPI?.getRegistroById?.(id);
    if (!reg) {
      await Swal.fire({ title: 'Sin datos', html: '<p>No se encontró la producción solicitada.</p>', icon: 'warning' });
      return;
    }
    await openPlanillaByRegistro(reg, context);
  };

  window.laJamoneraPlanillaProduccion = {
    openByRegistro: openPlanillaByRegistro,
    openById,
    getTraceUrl
  };
})();
