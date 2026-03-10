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
    initialized: false,
    range: [],
    reports: [],
    report: null,
    usersMap: {},
    recipesById: {},
    providers: [],
    recipes: [],
    vehicles: [],
    registros: []
  };

  const safeObject = (v) => (v && typeof v === 'object' ? v : {});
  const normalize = (v) => String(v || '').trim();
  const escapeHtml = (v) => normalize(v).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  const initials = (name) => normalize(name).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'PS';
  const formatDateTime = (ts) => new Date(Number(ts || Date.now())).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const commentsList = (report) => {
    if (Array.isArray(report?.comments)) return report.comments;
    if (report?.comments && typeof report.comments === 'object') return Object.values(report.comments);
    return [];
  };

  const dayDiff = (iso) => {
    const d = new Date(`${normalize(iso)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - now.getTime()) / 86400000);
  };

  const ago = (ts) => {
    const days = Math.floor((Date.now() - Number(ts || Date.now())) / 86400000);
    if (days <= 0) return 'HOY';
    if (days === 1) return 'HACE 1 DÍA';
    return `HACE ${days} DÍAS`;
  };

  const toneImportance = (value) => {
    const n = Math.max(0, Math.min(100, Number(value || 0)));
    if (n >= 90) return { tone: 'critical', label: 'Muy importante' };
    if (n >= 75) return { tone: 'high', label: 'Alta' };
    if (n >= 55) return { tone: 'warn', label: 'Atención' };
    if (n >= 30) return { tone: 'normal', label: 'Normal' };
    return { tone: 'ok', label: 'Baja' };
  };

  const spinner = (alt) => `<div class="panel-spinner-wrap"><img src="./IMG/Meta-ai-logo.webp" alt="${escapeHtml(alt)}" class="panel-spinner"></div>`;

  const flattenReports = (tree) => {
    const output = [];
    Object.entries(safeObject(tree)).forEach(([year, months]) => {
      Object.entries(safeObject(months)).forEach(([month, days]) => {
        Object.entries(safeObject(days)).forEach(([day, reports]) => {
          Object.entries(safeObject(reports)).forEach(([id, report]) => {
            if (!report || typeof report !== 'object') return;
            output.push({ ...report, id: report.id || id, year, month, day });
          });
        });
      });
    });
    return output.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  };

  const makeMarquee = (rows, minToAnimate = 3, rowSeconds = 6) => {
    const animate = rows.length >= minToAnimate;
    const clone = animate ? rows.concat(rows) : rows;
    const duration = Math.max(18, rows.length * rowSeconds);
    return `<div class="panel-marquee"><div class="panel-marquee-track ${animate ? 'is-animated' : ''}" style="--panel-marquee-duration:${duration}s;">${clone.join('')}</div></div>`;
  };

  const getReportUser = (report) => {
    const user = safeObject(state.usersMap[report?.userId]);
    return {
      name: normalize(user.fullName || report?.userName || 'Pablo Scalise'),
      position: normalize(user.position || report?.userPosition || 'Asesor Bromatológico'),
      photoUrl: normalize(user.photoUrl || '')
    };
  };

  const renderUserAvatar = (user) => {
    if (user.photoUrl) {
      return `<span class="user-avatar-thumb panel-user-avatar"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-panel-thumb" src="${escapeHtml(user.photoUrl)}" alt="${escapeHtml(user.name)}"></span>`;
    }
    return `<span class="user-avatar-thumb">${escapeHtml(initials(user.name))}</span>`;
  };

  const openReportViewerAlert = async (report) => {
    const user = getReportUser(report);
    const commentsCount = commentsList(report).length;
    const attachments = Array.isArray(report.attachments) ? report.attachments : [];
    const importance = toneImportance(report.importance);

    const result = await Swal.fire({
      title: 'Informe bromatológico',
      html: `
        <article class="informe-card panel-report-alert-card">
          <div class="informe-card-head">
            <span class="informe-card-date"><i class="fa-regular fa-calendar"></i> ${escapeHtml(formatDateTime(report.createdAt))}</span>
            <span class="informe-card-comments ${commentsCount ? 'has-comments' : 'no-comments'}"><i class="fa-solid ${commentsCount ? 'fa-comment-dots' : 'fa-comment-slash'}"></i> ${commentsCount ? `${commentsCount} comentario(s)` : 'Sin comentarios'}</span>
          </div>
          <div class="informe-card-preview">${report.html || '<p>Sin contenido</p>'}</div>
          <div class="informe-card-meta">
            <span class="informe-attach-chip"><i class="fa-regular fa-image"></i> ${attachments.filter((x) => x?.type === 'image').length}</span>
            <span class="informe-attach-chip"><i class="fa-regular fa-file-lines"></i> ${Math.max(0, attachments.length - attachments.filter((x) => x?.type === 'image').length)}</span>
            <span class="importance-chip importance-${importance.tone}">${Math.max(0, Math.min(100, Number(report.importance || 0)))}% · ${importance.label}</span>
          </div>
          <div class="informe-card-user">
            ${renderUserAvatar(user)}
            <div class="informe-card-user-text"><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.position)}</small></div>
          </div>
        </article>
      `,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Comentar',
      denyButtonText: 'Imprimir',
      cancelButtonText: 'Ver informe completo',
      reverseButtons: true,
      customClass: {
        popup: 'ios-alert panel-report-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text',
        confirmButton: 'ios-btn ios-btn-secondary',
        denyButton: 'ios-btn ios-btn-secondary',
        cancelButton: 'ios-btn ios-btn-primary'
      },
      buttonsStyling: false,
      didOpen: () => {
        document.querySelectorAll('.js-panel-thumb').forEach((img) => {
          img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
          img.addEventListener('error', () => img.closest('.panel-user-avatar')?.classList.add('is-fallback'), { once: true });
        });
      }
    });

    if (result.dismiss === Swal.DismissReason.cancel) {
      window.location.href = './informes.html';
      return;
    }

    if (result.isDenied) {
      window.open('./informes.html', '_blank', 'noopener,noreferrer');
      return;
    }

    if (result.isConfirmed) {
      const commentPrompt = await Swal.fire({
        title: 'Nuevo comentario',
        input: 'textarea',
        inputAttributes: { maxlength: 500, placeholder: 'Escribí un comentario' },
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        customClass: {
          popup: 'ios-alert',
          confirmButton: 'ios-btn ios-btn-primary',
          cancelButton: 'ios-btn ios-btn-secondary'
        },
        buttonsStyling: false
      });

      const text = normalize(commentPrompt.value);
      if (!commentPrompt.isConfirmed || !text) return;

      const path = `/informes/${report.year}/${report.month}/${report.day}/${report.id}`;
      const latest = safeObject(await window.dbLaJamoneraRest.read(path));
      const comments = commentsList(latest);
      comments.push({ id: `comment_${Date.now()}`, createdAt: Date.now(), userName: 'Panel', text });
      await window.dbLaJamoneraRest.update(path, { comments });
      await loadOnce();
    }
  };

  const renderLastReport = () => {
    const report = state.report;
    if (!report) {
      nodes.informe.innerHTML = '<div class="panel-empty">Todavía no hay informes cargados.</div>';
      nodes.informeAgo.classList.add('d-none');
      return;
    }

    const user = getReportUser(report);
    const commentsCount = commentsList(report).length;
    const attachments = Array.isArray(report.attachments) ? report.attachments : [];
    const importance = toneImportance(report.importance);

    nodes.informeAgo.classList.remove('d-none');
    nodes.informeAgo.textContent = ago(report.createdAt);

    nodes.informe.innerHTML = `
      <article class="informe-card panel-last-report-card" data-report-id="${escapeHtml(report.id)}">
        <div class="informe-card-head">
          <span class="informe-card-date"><i class="fa-regular fa-calendar"></i> ${escapeHtml(formatDateTime(report.createdAt))}</span>
          <span class="informe-card-comments ${commentsCount ? 'has-comments' : 'no-comments'}"><i class="fa-solid ${commentsCount ? 'fa-comment-dots' : 'fa-comment-slash'}"></i> ${commentsCount ? `${commentsCount} comentario(s)` : 'Sin comentarios'}</span>
        </div>

        <div class="informe-card-preview">${report.html || '<p>Sin contenido.</p>'}</div>

        <div class="informe-card-meta">
          <span class="informe-attach-chip"><i class="fa-regular fa-image"></i> ${attachments.filter((x) => x?.type === 'image').length}</span>
          <span class="informe-attach-chip"><i class="fa-regular fa-file-lines"></i> ${Math.max(0, attachments.length - attachments.filter((x) => x?.type === 'image').length)}</span>
          <span class="importance-chip importance-${importance.tone}">${Math.max(0, Math.min(100, Number(report.importance || 0)))}% · ${importance.label} 📌</span>
        </div>

        <div class="informe-card-user">
          ${renderUserAvatar(user)}
          <div class="informe-card-user-text">
            <strong>${escapeHtml(user.name)}</strong>
            <small>${escapeHtml(user.position)}</small>
          </div>
        </div>

        <div class="informe-card-actions panel-last-report-actions">
          <button id="panelOpenReportBtn" class="btn ios-btn ios-btn-primary" type="button">VER INFORME COMPLETO</button>
        </div>
      </article>
    `;

    document.querySelectorAll('.js-panel-thumb').forEach((img) => {
      img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
      img.addEventListener('error', () => img.closest('.panel-user-avatar')?.classList.add('is-fallback'), { once: true });
    });

    document.getElementById('panelOpenReportBtn')?.addEventListener('click', () => openReportViewerAlert(report));
  };

  const renderSummary = () => {
    const reminders = [];

    state.recipes.slice(0, 8).forEach((item) => {
      const days = dayDiff(item.rnpa?.expiryDate);
      reminders.push(`<article class="panel-reminder-card tone-orange"><div class="panel-reminder-icon"><i class="bi bi-exclamation-triangle-fill"></i></div><div class="panel-item-text"><strong>${escapeHtml(item.title || 'Receta')}</strong><small>RNPA ${days < 0 ? `vencido hace ${Math.abs(days)} día(s)` : `vence en ${days} día(s)`}</small></div></article>`);
    });

    state.vehicles.slice(0, 8).forEach((item) => {
      const days = dayDiff(item.expiryDate);
      reminders.push(`<article class="panel-reminder-card tone-red"><div class="panel-reminder-icon"><i class="bi bi-truck"></i></div><div class="panel-item-text"><strong>${escapeHtml(item.number || 'UTA/URA')}</strong><small>${days < 0 ? `Venció hace ${Math.abs(days)} día(s)` : `Vence en ${days} día(s)`}</small></div></article>`);
    });

    state.reports.slice(0, 4).forEach((item) => {
      reminders.push(`<article class="panel-reminder-card tone-blue"><div class="panel-reminder-icon"><i class="bi bi-journal-check"></i></div><div class="panel-item-text"><strong>Informe ${escapeHtml(formatDateTime(item.createdAt))}</strong><small>Usuario: ${escapeHtml(normalize(item.userName) || 'Sin nombre')}</small></div></article>`);
    });

    const metrics = `<div class="panel-mini-grid"><div class="panel-metric"><strong>${state.providers.length}</strong><span><i class="bi bi-clipboard2-pulse"></i> RNE pendientes</span></div><div class="panel-metric"><strong>${state.recipes.length}</strong><span><i class="bi bi-card-checklist"></i> RNPA críticos</span></div><div class="panel-metric"><strong>${state.vehicles.length}</strong><span><i class="bi bi-truck"></i> UTA/URA con alerta</span></div><div class="panel-metric"><strong>${state.reports.length}</strong><span><i class="bi bi-journal-medical"></i> Informes cargados</span></div></div>`;

    if (!reminders.length) {
      nodes.resumen.innerHTML = `${metrics}<div class="panel-empty">Sin recordatorios activos por el momento.</div>`;
      return;
    }

    nodes.resumen.innerHTML = `${metrics}${makeMarquee(reminders, 3, 7)}`;
  };

  const renderProviders = () => {
    const rows = state.providers.map((provider) => {
      const photo = normalize(provider.photoUrl);
      const avatar = photo
        ? `<div class="panel-avatar"><img src="${escapeHtml(photo)}" alt="${escapeHtml(provider.name)}" onload="this.classList.add('is-loaded')"><img src="./IMG/Meta-ai-logo.webp" class="panel-spinner" alt="cargando"></div>`
        : `<div class="panel-avatar">${escapeHtml(initials(provider.name))}</div>`;
      return `<article class="panel-list-card">${avatar}<div class="panel-item-text"><strong>${escapeHtml(provider.name || 'Proveedor')}</strong><small><i class="bi bi-patch-exclamation"></i> RNE pendiente</small><p class="panel-status is-danger">Completar registro del proveedor</p></div></article>`;
    });

    if (!rows.length) {
      nodes.wrapRne.classList.add('d-none');
      return;
    }

    nodes.wrapRne.classList.remove('d-none');
    nodes.rne.innerHTML = makeMarquee(rows, 3, 7);
  };

  const renderRnpa = () => {
    const rows = state.recipes.map((recipe) => {
      const days = dayDiff(recipe.rnpa?.expiryDate);
      const expired = Number(days) < 0;
      const photo = normalize(recipe.imageUrl);
      const avatar = photo
        ? `<div class="panel-avatar"><img src="${escapeHtml(photo)}" alt="${escapeHtml(recipe.title)}" onload="this.classList.add('is-loaded')"><img src="./IMG/Meta-ai-logo.webp" class="panel-spinner" alt="cargando"></div>`
        : `<div class="panel-avatar">${escapeHtml(initials(recipe.title))}</div>`;
      return `<article class="panel-list-card">${avatar}<div class="panel-item-text"><strong>${escapeHtml(recipe.title || 'Receta')}</strong><small><i class="bi bi-calendar2-week"></i> Vence: ${escapeHtml(recipe.rnpa?.expiryDate || '-')}</small><p class="panel-status ${expired ? 'is-danger' : 'is-warning'}">${expired ? `Venció hace ${Math.abs(days)} día(s)` : `Vence en ${days} día(s)`}</p></div></article>`;
    });

    if (!rows.length) {
      nodes.wrapRnpa.classList.add('d-none');
      return;
    }

    nodes.wrapRnpa.classList.remove('d-none');
    nodes.rnpa.innerHTML = makeMarquee(rows, 3, 7);
  };

  const renderTransport = () => {
    const rows = state.vehicles.map((vehicle) => {
      const days = dayDiff(vehicle.expiryDate);
      return `<article class="panel-list-card"><div class="panel-avatar"><i class="bi bi-truck"></i></div><div class="panel-item-text"><strong>${escapeHtml(vehicle.number || '-')} · ${escapeHtml(vehicle.patent || '-')}</strong><small>${escapeHtml(vehicle.brand || vehicle.type || 'Unidad')} · ${escapeHtml(vehicle.expiryDate || '-')}</small><p class="panel-status ${days < 0 ? 'is-danger' : 'is-warning'}">${days < 0 ? `Vencido hace ${Math.abs(days)} día(s)` : `Vence en ${days} día(s)`}</p></div></article>`;
    });

    if (!rows.length) {
      nodes.wrapTransporte.classList.add('d-none');
      return;
    }

    nodes.wrapTransporte.classList.remove('d-none');
    nodes.transporte.innerHTML = makeMarquee(rows, 99, 7);
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
    renderSummary();
    renderLastReport();
    renderProviders();
    renderRnpa();
    renderTransport();
    renderChart();
  };

  const applyData = (raw) => {
    state.reports = flattenReports(raw.reportsTree);
    state.report = state.reports[0] || null;
    state.usersMap = safeObject(raw.informesUsers);

    state.recipesById = safeObject(raw.recetas);
    state.providers = (Array.isArray(raw.inventario?.config?.providers) ? raw.inventario.config.providers : []).filter((p) => !normalize(p?.rne?.number));
    state.recipes = Object.values(state.recipesById).filter((r) => {
      const days = dayDiff(r?.rnpa?.expiryDate);
      return Number.isFinite(days) && days <= 60;
    });

    state.vehicles = Object.values(safeObject(raw.reparto?.vehicles)).filter((v) => v?.enabled !== false).filter((v) => {
      const days = dayDiff(v.expiryDate);
      return Number.isFinite(days) && days <= 60;
    });

    state.registros = Object.values(safeObject(raw.registros));
  };

  const setLoading = () => {
    nodes.informe.innerHTML = spinner('Cargando informe');
    nodes.resumen.innerHTML = spinner('Cargando métricas');
    nodes.rne.innerHTML = spinner('Cargando proveedores');
    nodes.rnpa.innerHTML = spinner('Cargando RNPA');
    nodes.transporte.innerHTML = spinner('Cargando transporte');
    nodes.produccion.innerHTML = spinner('Cargando producción');
  };

  const loadOnce = async () => {
    if (!state.initialized) setLoading();
    try {
      await window.laJamoneraReady;
      const [reportsTree, inventario, recetas, reparto, registros, informesUsers] = await Promise.all([
        window.dbLaJamoneraRest.read('/informes'),
        window.dbLaJamoneraRest.read('/inventario'),
        window.dbLaJamoneraRest.read('/recetas'),
        window.dbLaJamoneraRest.read('/Reparto'),
        window.dbLaJamoneraRest.read('/produccion/registros'),
        window.dbLaJamoneraRest.read('/informes/users')
      ]);
      applyData({ reportsTree, inventario, recetas, reparto, registros, informesUsers });
      renderAll();
      state.initialized = true;
    } catch (error) {
      const fallback = '<div class="panel-empty">No se pudieron cargar los datos del panel.</div>';
      [nodes.informe, nodes.resumen, nodes.rne, nodes.rnpa, nodes.transporte, nodes.produccion].forEach((n) => { if (n) n.innerHTML = fallback; });
    }
  };

  const attachRealtimeListeners = () => {
    const db = window.dbLaJamonera;
    if (!db?.ref) return;
    ['/informes', '/inventario', '/recetas', '/Reparto', '/produccion/registros', '/informes/users'].forEach((path) => {
      db.ref(path).on('value', () => loadOnce());
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
  loadOnce().then(attachRealtimeListeners);
})();
