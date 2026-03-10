(function panelControlModule() {
  const root = document.getElementById('panelDashboard');
  if (!root) return;

  const REFRESH_MS = 60000;
  const nowChip = document.getElementById('panelNowChip');
  const rangeInput = document.getElementById('panelChartRange');

  const nodes = {
    informe: document.querySelector('#panelUltimoInforme .panel-card-body'),
    informeAgo: document.getElementById('panelInformeAgo'),
    resumen: document.querySelector('#panelResumen .panel-card-body'),
    rne: document.querySelector('#panelRne .panel-card-body'),
    rnpa: document.querySelector('#panelRnpa .panel-card-body'),
    transporte: document.querySelector('#panelTransporte .panel-card-body'),
    produccion: document.querySelector('#panelProduccion .panel-card-body'),
    wrapRne: document.getElementById('panelRne'),
    wrapRnpa: document.getElementById('panelRnpa'),
    wrapTransporte: document.getElementById('panelTransporte')
  };

  const state = { report: null, reports: [], range: [] };
  const safeObject = (v) => (v && typeof v === 'object' ? v : {});
  const normalize = (v) => String(v || '').trim();
  const escapeHtml = (v) => normalize(v).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  const formatEs = (ts) => new Date(Number(ts || Date.now())).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  const initials = (name) => normalize(name).split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || 'PR';
  const dayDiff = (iso) => {
    const date = new Date(`${normalize(iso)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((date.getTime() - now.getTime()) / 86400000);
  };
  const relative = (ts) => {
    const diff = Date.now() - Number(ts || Date.now());
    const days = Math.floor(diff / 86400000);
    if (days <= 0) return 'hoy';
    if (days === 1) return 'hace 1 día';
    return `hace ${days} días`;
  };

  const spinner = (alt) => `<div class="panel-spinner-wrap"><img src="./IMG/Meta-ai-logo.webp" alt="${escapeHtml(alt)}" class="panel-spinner"></div>`;
  const setNowChip = () => { if (nowChip) nowChip.textContent = `Actualizado ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`; };

  const flattenReports = (tree) => {
    const out = [];
    Object.entries(safeObject(tree)).forEach(([year, months]) => {
      Object.entries(safeObject(months)).forEach(([month, days]) => {
        Object.entries(safeObject(days)).forEach(([day, reports]) => {
          Object.entries(safeObject(reports)).forEach(([id, report]) => {
            if (!report || typeof report !== 'object') return;
            out.push({ ...report, id: report.id || id, year, month, day });
          });
        });
      });
    });
    return out.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  };

  const renderLastReport = () => {
    const report = state.report;
    if (!report) {
      nodes.informe.innerHTML = '<div class="panel-empty">Todavía no hay informes cargados.</div>';
      nodes.informeAgo.classList.add('d-none');
      return;
    }
    nodes.informeAgo.classList.remove('d-none');
    nodes.informeAgo.textContent = relative(report.createdAt);
    nodes.informe.innerHTML = `<div class="panel-report-preview"><small><strong>Fecha:</strong> ${escapeHtml(formatEs(report.createdAt))}</small><div class="panel-report-html">${report.html || '<p>Sin contenido.</p>'}</div><div class="panel-report-actions"><a class="btn ios-btn ios-btn-secondary" href="./informes.html"><i class="fa-solid fa-expand"></i><span>Ampliar</span></a><button id="panelReportComment" class="btn ios-btn ios-btn-primary" type="button"><i class="fa-solid fa-comment-dots"></i><span>Comentar</span></button></div></div>`;
    const btn = document.getElementById('panelReportComment');
    btn?.addEventListener('click', async () => {
      const res = await Swal.fire({
        title: 'Nuevo comentario',
        input: 'textarea',
        inputAttributes: { maxlength: 500, placeholder: 'Escribí un comentario' },
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        customClass: { popup: 'ios-alert', confirmButton: 'ios-btn ios-btn-primary', cancelButton: 'ios-btn ios-btn-secondary' },
        buttonsStyling: false
      });
      const text = normalize(res.value);
      if (!res.isConfirmed || !text) return;
      const path = `/informes/${report.year}/${report.month}/${report.day}/${report.id}`;
      const latest = safeObject(await window.dbLaJamoneraRest.read(path));
      const comments = Array.isArray(latest.comments) ? latest.comments : Object.values(safeObject(latest.comments));
      comments.push({ id: `comment_${Date.now()}`, createdAt: Date.now(), userName: 'Panel', text });
      await window.dbLaJamoneraRest.update(path, { comments });
      Swal.fire({ title: 'Comentario guardado', icon: 'success', timer: 1200, showConfirmButton: false, customClass: { popup: 'ios-alert' } });
    });
  };

  const makeMarquee = (rows) => {
    const clone = rows.length > 2 ? rows.concat(rows) : rows;
    return `<div class="panel-marquee"><div class="panel-marquee-track">${clone.join('')}</div></div>`;
  };

  const renderProviders = (providers = []) => {
    if (!providers.length) {
      nodes.wrapRne.classList.add('d-none');
      return;
    }
    nodes.wrapRne.classList.remove('d-none');
    const rows = providers.map((provider) => {
      const photo = normalize(provider.photoUrl);
      const avatar = photo
        ? `<div class="panel-avatar"><img src="${escapeHtml(photo)}" alt="${escapeHtml(provider.name)}" onload="this.classList.add('is-loaded')"><img src="./IMG/Meta-ai-logo.webp" class="panel-spinner" alt="cargando"></div>`
        : `<div class="panel-avatar">${escapeHtml(initials(provider.name))}</div>`;
      return `<article class="panel-list-card">${avatar}<div class="panel-item-text"><strong>${escapeHtml(provider.name || 'Proveedor')}</strong><small>${escapeHtml(provider.rne?.number || 'Sin número RNE')}</small><p class="panel-status is-danger">RNE pendiente</p></div></article>`;
    });
    nodes.rne.innerHTML = makeMarquee(rows);
  };

  const renderRnpa = (recipes = []) => {
    if (!recipes.length) {
      nodes.wrapRnpa.classList.add('d-none');
      return;
    }
    nodes.wrapRnpa.classList.remove('d-none');
    const rows = recipes.map((recipe) => {
      const days = dayDiff(recipe.rnpa?.expiryDate);
      const isExpired = Number(days) < 0;
      const msg = isExpired ? `Venció hace ${Math.abs(days)} día(s) · Se debe reemplazar el RNPA` : `Vence en ${days} día(s)`;
      const avatar = normalize(recipe.imageUrl)
        ? `<div class="panel-avatar"><img src="${escapeHtml(recipe.imageUrl)}" alt="${escapeHtml(recipe.title)}" onload="this.classList.add('is-loaded')"><img src="./IMG/Meta-ai-logo.webp" class="panel-spinner" alt="cargando"></div>`
        : `<div class="panel-avatar">${escapeHtml(initials(recipe.title))}</div>`;
      return `<article class="panel-list-card">${avatar}<div class="panel-item-text"><strong>${escapeHtml(recipe.title || 'Receta')}</strong><small>Vence: ${escapeHtml(recipe.rnpa?.expiryDate || '-')}</small><p class="panel-status ${isExpired ? 'is-danger' : 'is-warning'}">${escapeHtml(msg)}</p></div></article>`;
    });
    nodes.rnpa.innerHTML = makeMarquee(rows);
  };

  const renderTransport = (vehicles = []) => {
    if (!vehicles.length) {
      nodes.wrapTransporte.classList.add('d-none');
      return;
    }
    nodes.wrapTransporte.classList.remove('d-none');
    const rows = vehicles.map((vehicle) => {
      const days = dayDiff(vehicle.expiryDate);
      const status = Number.isFinite(days) ? (days < 0 ? `Vencido hace ${Math.abs(days)} día(s)` : `Vence en ${days} día(s)`) : 'Sin vencimiento';
      return `<article class="panel-list-card"><div class="panel-avatar"><i class="fa-solid fa-truck"></i></div><div class="panel-item-text"><strong>${escapeHtml(vehicle.number || '-')} · ${escapeHtml(vehicle.patent || '-')}</strong><small>${escapeHtml(vehicle.brand || vehicle.type || 'Unidad')}</small><p class="panel-status ${days < 0 ? 'is-danger' : 'is-warning'}">${escapeHtml(status)}</p></div></article>`;
    });
    nodes.transporte.innerHTML = makeMarquee(rows);
  };

  const renderSummary = (data) => {
    nodes.resumen.innerHTML = `<div class="panel-mini-grid"><div class="panel-metric"><strong>${data.pendingProviders}</strong><span>RNE pendientes</span></div><div class="panel-metric"><strong>${data.rnpaAlerts}</strong><span>RNPA críticos (60 días)</span></div><div class="panel-metric"><strong>${data.transportAlerts}</strong><span>UTA/URA con alerta</span></div><div class="panel-metric"><strong>${data.reports}</strong><span>Informes cargados</span></div></div>`;
  };

  const renderChart = (registros = []) => {
    const [start, end] = state.range;
    const inRange = registros.filter((item) => {
      const ts = Number(item.createdAt || 0);
      if (!ts) return false;
      if (!start || !end) return true;
      return ts >= start.getTime() && ts <= end.getTime() + 86399999;
    });

    const map = {};
    inRange.forEach((item) => {
      const key = normalize(item.recipeTitle || item.recipeName || item.recipeId || 'Sin nombre');
      map[key] = Number((Number(map[key] || 0) + Number(item.quantityKg || 0)).toFixed(2));
    });

    const top = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!top.length) {
      nodes.produccion.innerHTML = '<div class="panel-empty">No hay producción en el rango seleccionado.</div>';
      return;
    }
    const max = Math.max(...top.map((x) => x[1]));
    nodes.produccion.innerHTML = `<div class="panel-chart-wrap">${top.map(([name, kg]) => `<div class="panel-chart-row"><div class="panel-chart-label"><i class="fa-solid fa-drumstick-bite"></i><span>${escapeHtml(name)}</span></div><div class="panel-chart-bar"><div class="panel-chart-fill" style="width:${Math.max(8, (kg / max) * 100)}%"></div></div><div class="panel-chart-value">${kg.toFixed(2)} kg</div></div>`).join('')}</div>`;
  };

  const initRange = () => {
    if (!window.flatpickr || !rangeInput) return;
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 14);
    state.range = [start, end];
    window.flatpickr(rangeInput, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      locale: window.flatpickr?.l10ns?.es || 'es',
      defaultDate: [start, end],
      onChange: (dates) => {
        if (dates.length === 2) {
          state.range = dates;
          loadPanel();
        }
      }
    });
  };

  const loadPanel = async () => {
    nodes.informe.innerHTML = spinner('Cargando informe');
    nodes.resumen.innerHTML = spinner('Cargando métricas');
    nodes.rne.innerHTML = spinner('Cargando proveedores');
    nodes.rnpa.innerHTML = spinner('Cargando RNPA');
    nodes.transporte.innerHTML = spinner('Cargando transporte');
    nodes.produccion.innerHTML = spinner('Cargando producción');

    try {
      await window.laJamoneraReady;
      const [reportsTree, inventario, recetas, reparto, registros] = await Promise.all([
        window.dbLaJamoneraRest.read('/informes'),
        window.dbLaJamoneraRest.read('/inventario'),
        window.dbLaJamoneraRest.read('/recetas'),
        window.dbLaJamoneraRest.read('/Reparto'),
        window.dbLaJamoneraRest.read('/produccion/registros')
      ]);

      const reports = flattenReports(reportsTree);
      state.reports = reports;
      state.report = reports[0] || null;
      renderLastReport();

      const providers = (Array.isArray(inventario?.config?.providers) ? inventario.config.providers : []).filter((p) => !normalize(p?.rne?.number));
      renderProviders(providers);

      const recetasRows = Object.values(safeObject(recetas)).filter((r) => {
        const days = dayDiff(r?.rnpa?.expiryDate);
        return Number.isFinite(days) && days <= 60;
      });
      renderRnpa(recetasRows);

      const vehicleRows = Object.values(safeObject(reparto?.vehicles)).filter((v) => v?.enabled !== false).filter((v) => {
        const days = dayDiff(v.expiryDate);
        return Number.isFinite(days) && days <= 60;
      });
      renderTransport(vehicleRows);

      renderSummary({
        pendingProviders: providers.length,
        rnpaAlerts: recetasRows.length,
        transportAlerts: vehicleRows.length,
        reports: reports.length
      });

      renderChart(Object.values(safeObject(registros)));
      setNowChip();
    } catch (error) {
      const fallback = '<div class="panel-empty">No se pudieron cargar los datos del panel.</div>';
      Object.values(nodes).forEach((node) => {
        if (node?.classList?.contains('panel-card-body')) node.innerHTML = fallback;
      });
    }
  };

  initRange();
  loadPanel();
  setInterval(loadPanel, REFRESH_MS);
})();
