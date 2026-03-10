(function panelControlModule() {
  const root = document.getElementById('panelDashboard');
  if (!root) return;

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

  const state = {
    report: null,
    reports: [],
    recipesById: {},
    providers: [],
    recipes: [],
    vehicles: [],
    registros: [],
    range: [],
    initialized: false
  };

  const safeObject = (v) => (v && typeof v === 'object' ? v : {});
  const normalize = (v) => String(v || '').trim();
  const escapeHtml = (v) => normalize(v).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  const formatEs = (ts) => new Date(Number(ts || Date.now())).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const formatDayEs = (ts) => new Date(Number(ts || Date.now())).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
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
    if (days <= 0) return 'HOY';
    if (days === 1) return 'HACE 1 DÍA';
    return `HACE ${days} DÍAS`;
  };

  const spinner = (alt) => `<div class="panel-spinner-wrap"><img src="./IMG/Meta-ai-logo.webp" alt="${escapeHtml(alt)}" class="panel-spinner"></div>`;

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

  const commentsList = (report) => {
    const raw = report?.comments;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') return Object.values(raw);
    return [];
  };

  const toneImportance = (value) => {
    const n = Math.max(0, Math.min(100, Number(value || 0)));
    if (n >= 90) return { tone: 'critical', label: 'Muy importante' };
    if (n >= 75) return { tone: 'high', label: 'Alta' };
    if (n >= 55) return { tone: 'warn', label: 'Atención' };
    if (n >= 30) return { tone: 'normal', label: 'Normal' };
    return { tone: 'ok', label: 'Baja' };
  };

  const renderLastReport = () => {
    const report = state.report;
    if (!report) {
      nodes.informe.innerHTML = '<div class="panel-empty">Todavía no hay informes cargados.</div>';
      nodes.informeAgo.classList.add('d-none');
      return;
    }

    const userName = normalize(report.userName) || 'Usuario';
    const userPos = normalize(report.userPosition) || 'Asesor Bromatológico';
    const commentsCount = commentsList(report).length;
    const attachments = Array.isArray(report.attachments) ? report.attachments : [];
    const importance = toneImportance(report.importance);

    nodes.informeAgo.classList.remove('d-none');
    nodes.informeAgo.textContent = relative(report.createdAt);

    nodes.informe.innerHTML = `
      <article class="informe-card panel-last-report-card" data-report-id="${escapeHtml(report.id)}">
        <div class="informe-card-head">
          <span class="informe-card-date"><i class="fa-regular fa-calendar"></i> ${escapeHtml(formatEs(report.createdAt))}</span>
          <span class="informe-card-comments ${commentsCount ? 'has-comments' : 'no-comments'}"><i class="fa-solid ${commentsCount ? 'fa-comment-dots' : 'fa-comment-slash'}"></i> ${commentsCount ? `${commentsCount} comentario(s)` : 'Sin comentarios'}</span>
        </div>

        <div class="informe-card-preview">${report.html || '<p>Sin contenido.</p>'}</div>

        <div class="informe-card-meta">
          <span class="informe-attach-chip"><i class="fa-regular fa-image"></i> ${attachments.filter((x) => x?.type === 'image').length}</span>
          <span class="informe-attach-chip"><i class="fa-regular fa-file-lines"></i> ${Math.max(0, attachments.length - attachments.filter((x) => x?.type === 'image').length)}</span>
          <span class="importance-chip importance-${importance.tone}">${Math.max(0, Math.min(100, Number(report.importance || 0)))}% · ${importance.label} 📌</span>
          <button id="panelPrintReport" class="btn informe-print-chip" type="button" title="Imprimir informe"><i class="fa-solid fa-print"></i></button>
        </div>

        <div class="informe-card-user">
          <span class="user-avatar-thumb">${escapeHtml(initials(userName))}</span>
          <div class="informe-card-user-text">
            <strong>${escapeHtml(userName)}</strong>
            <small>${escapeHtml(userPos)}</small>
          </div>
        </div>

        <div class="informe-card-actions">
          <a class="btn ios-btn ios-btn-primary" href="./informes.html">Ver informe completo</a>
          <button id="panelReportComment" class="btn ios-btn ios-btn-secondary" type="button" title="Comentar"><i class="fa-regular fa-message"></i></button>
          <button id="panelReportEdit" class="btn ios-btn ios-btn-secondary" type="button" title="Editar en informes"><i class="fa-solid fa-pen"></i></button>
        </div>
      </article>
    `;

    document.getElementById('panelPrintReport')?.addEventListener('click', () => {
      window.open('./informes.html', '_blank', 'noopener,noreferrer');
    });

    document.getElementById('panelReportEdit')?.addEventListener('click', () => {
      window.location.href = './informes.html';
    });

    document.getElementById('panelReportComment')?.addEventListener('click', async () => {
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
      const comments = commentsList(latest);
      comments.push({ id: `comment_${Date.now()}`, createdAt: Date.now(), userName: 'Panel', text });
      await window.dbLaJamoneraRest.update(path, { comments });
      await loadOnce();
    });
  };

  const makeMarquee = (rows, minToAnimate = 3) => {
    const animate = rows.length >= minToAnimate;
    const clone = animate ? rows.concat(rows) : rows;
    return `<div class="panel-marquee"><div class="panel-marquee-track ${animate ? 'is-animated' : ''}">${clone.join('')}</div></div>`;
  };

  const renderProviders = () => {
    const providers = state.providers;
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
    nodes.rne.innerHTML = makeMarquee(rows, 3);
  };

  const renderRnpa = () => {
    const recipes = state.recipes;
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
    nodes.rnpa.innerHTML = makeMarquee(rows, 3);
  };

  const renderTransport = () => {
    const vehicles = state.vehicles;
    if (!vehicles.length) {
      nodes.wrapTransporte.classList.add('d-none');
      return;
    }
    nodes.wrapTransporte.classList.remove('d-none');
    const rows = vehicles.map((vehicle) => {
      const days = dayDiff(vehicle.expiryDate);
      const status = Number.isFinite(days) ? (days < 0 ? `Vencido hace ${Math.abs(days)} día(s)` : `Vence en ${days} día(s)`) : 'Sin vencimiento';
      return `<article class="panel-list-card"><div class="panel-avatar"><i class="fa-solid fa-truck"></i></div><div class="panel-item-text"><strong>${escapeHtml(vehicle.number || '-')} · ${escapeHtml(vehicle.patent || '-')}</strong><small>${escapeHtml(vehicle.brand || vehicle.type || 'Unidad')} · Vence: ${escapeHtml(vehicle.expiryDate || '-')}</small><p class="panel-status ${days < 0 ? 'is-danger' : 'is-warning'}">${escapeHtml(status)}</p></div></article>`;
    });
    nodes.transporte.innerHTML = makeMarquee(rows, 3);
  };

  const renderSummary = () => {
    const alerts = [];

    state.providers.slice(0, 6).forEach((item) => {
      alerts.push(`<article class="panel-list-card"><div class="panel-item-text"><strong>${escapeHtml(item.name || 'Proveedor')}</strong><p class="panel-status is-danger">RNE pendiente</p></div></article>`);
    });

    state.recipes.slice(0, 6).forEach((item) => {
      const days = dayDiff(item.rnpa?.expiryDate);
      alerts.push(`<article class="panel-list-card"><div class="panel-item-text"><strong>${escapeHtml(item.title || 'Receta')}</strong><p class="panel-status ${days < 0 ? 'is-danger' : 'is-warning'}">RNPA ${days < 0 ? `vencido hace ${Math.abs(days)} día(s)` : `vence en ${days} día(s)`}</p></div></article>`);
    });

    state.vehicles.slice(0, 6).forEach((item) => {
      const days = dayDiff(item.expiryDate);
      alerts.push(`<article class="panel-list-card"><div class="panel-item-text"><strong>${escapeHtml(item.number || 'UTA/URA')}</strong><p class="panel-status ${days < 0 ? 'is-danger' : 'is-warning'}">${days < 0 ? `Venció hace ${Math.abs(days)} día(s)` : `Vence en ${days} día(s)`}</p></div></article>`);
    });

    const metrics = `<div class="panel-mini-grid"><div class="panel-metric"><strong>${state.providers.length}</strong><span>RNE pendientes</span></div><div class="panel-metric"><strong>${state.recipes.length}</strong><span>RNPA críticos (60 días)</span></div><div class="panel-metric"><strong>${state.vehicles.length}</strong><span>UTA/URA con alerta</span></div><div class="panel-metric"><strong>${state.reports.length}</strong><span>Informes cargados</span></div></div>`;

    if (!alerts.length) {
      nodes.resumen.innerHTML = `${metrics}<div class="panel-empty">Sin alertas activas por el momento.</div>`;
      return;
    }

    nodes.resumen.innerHTML = `${metrics}${makeMarquee(alerts, 3)}`;
  };

  const renderChart = () => {
    const [start, end] = state.range;
    const inRange = state.registros.filter((item) => {
      const ts = Number(item.createdAt || 0);
      if (!ts) return false;
      if (!start || !end) return true;
      return ts >= start.getTime() && ts <= end.getTime() + 86399999;
    });

    const map = {};
    inRange.forEach((item) => {
      const key = normalize(item.recipeId || item.recipeTitle || item.recipeName || 'sin_nombre');
      if (!map[key]) {
        map[key] = {
          id: normalize(item.recipeId),
          name: normalize(item.recipeTitle || item.recipeName || item.recipeId || 'Sin nombre'),
          kg: 0,
          imageUrl: normalize(item.recipeImageUrl)
        };
      }
      map[key].kg = Number((Number(map[key].kg || 0) + Number(item.quantityKg || 0)).toFixed(2));
    });

    const top = Object.values(map)
      .map((item) => {
        const recipe = safeObject(state.recipesById[item.id]);
        if (!item.imageUrl && normalize(recipe.imageUrl)) item.imageUrl = normalize(recipe.imageUrl);
        return item;
      })
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 10);

    if (!top.length) {
      nodes.produccion.innerHTML = '<div class="panel-empty">No hay producción en el rango seleccionado.</div>';
      return;
    }

    const max = Math.max(...top.map((x) => x.kg));
    nodes.produccion.innerHTML = `<div class="panel-chart-wrap">${top.map((item) => {
      const avatar = item.imageUrl
        ? `<span class="panel-chart-avatar"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" onload="this.classList.add('is-loaded')"><img src="./IMG/Meta-ai-logo.webp" class="panel-spinner" alt="cargando"></span>`
        : `<span class="panel-chart-avatar">${escapeHtml(initials(item.name))}</span>`;
      return `<div class="panel-chart-row"><div class="panel-chart-label">${avatar}<span>${escapeHtml(item.name)}</span></div><div class="panel-chart-bar"><div class="panel-chart-fill" style="width:${Math.max(8, (item.kg / max) * 100)}%"></div></div><div class="panel-chart-value">${item.kg.toFixed(2)} kg</div></div>`;
    }).join('')}</div>`;
  };

  const renderAll = () => {
    renderLastReport();
    renderSummary();
    renderProviders();
    renderRnpa();
    renderTransport();
    renderChart();
  };

  const applyData = (raw) => {
    const reports = flattenReports(raw.reportsTree);
    state.reports = reports;
    state.report = reports[0] || null;

    const recipesById = safeObject(raw.recetas);
    state.recipesById = recipesById;

    const providers = (Array.isArray(raw.inventario?.config?.providers) ? raw.inventario.config.providers : []).filter((p) => !normalize(p?.rne?.number));
    state.providers = providers;

    const recetasRows = Object.values(recipesById).filter((r) => {
      const days = dayDiff(r?.rnpa?.expiryDate);
      return Number.isFinite(days) && days <= 60;
    });
    state.recipes = recetasRows;

    const vehicleRows = Object.values(safeObject(raw.reparto?.vehicles))
      .filter((v) => v?.enabled !== false)
      .filter((v) => {
        const days = dayDiff(v.expiryDate);
        return Number.isFinite(days) && days <= 60;
      });
    state.vehicles = vehicleRows;

    state.registros = Object.values(safeObject(raw.registros));
  };

  const loadOnce = async () => {
    if (!state.initialized) {
      nodes.informe.innerHTML = spinner('Cargando informe');
      nodes.resumen.innerHTML = spinner('Cargando métricas');
      nodes.rne.innerHTML = spinner('Cargando proveedores');
      nodes.rnpa.innerHTML = spinner('Cargando RNPA');
      nodes.transporte.innerHTML = spinner('Cargando transporte');
      nodes.produccion.innerHTML = spinner('Cargando producción');
    }

    try {
      await window.laJamoneraReady;
      const [reportsTree, inventario, recetas, reparto, registros] = await Promise.all([
        window.dbLaJamoneraRest.read('/informes'),
        window.dbLaJamoneraRest.read('/inventario'),
        window.dbLaJamoneraRest.read('/recetas'),
        window.dbLaJamoneraRest.read('/Reparto'),
        window.dbLaJamoneraRest.read('/produccion/registros')
      ]);

      applyData({ reportsTree, inventario, recetas, reparto, registros });
      renderAll();
      state.initialized = true;
    } catch (error) {
      const fallback = '<div class="panel-empty">No se pudieron cargar los datos del panel.</div>';
      [nodes.informe, nodes.resumen, nodes.rne, nodes.rnpa, nodes.transporte, nodes.produccion].forEach((node) => {
        if (node) node.innerHTML = fallback;
      });
    }
  };

  const attachRealtimeListeners = () => {
    const db = window.dbLaJamonera;
    if (!db?.ref) return;
    const watched = ['/informes', '/inventario', '/recetas', '/Reparto', '/produccion/registros'];
    watched.forEach((path) => {
      db.ref(path).on('value', () => {
        loadOnce();
      });
    });
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
          renderChart();
        }
      }
    });
  };

  initRange();
  loadOnce().then(() => attachRealtimeListeners());
})();
