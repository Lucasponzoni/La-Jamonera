(function panelControlModule() {
  const root = document.getElementById('panelDashboard');
  if (!root) return;

  const rangeInput = document.getElementById('panelChartRange');
  const nodes = {
    informe: document.querySelector('#panelUltimoInforme .panel-card-body'),
    resumen: document.querySelector('#panelResumen .panel-card-body'),
    pendientes: document.querySelector('#panelPendientes .panel-card-body'),
    pendientesCount: document.getElementById('panelPendientesCount'),
    produccion: document.querySelector('#panelProduccion .panel-card-body'),
    greetingTitle: document.getElementById('panelGreetingTitle'),
    greetingSub: document.getElementById('panelGreetingSub'),
    homeNav: document.getElementById('panelHomeNav')
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
    registros: [],
    userName: ''
  };

  const safeObject = (v) => (v && typeof v === 'object' ? v : {});
  const normalize = (v) => String(v || '').trim();
  const escapeHtml = (v) => normalize(v).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  const initials = (name) => normalize(name).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'PS';
  const formatDateTime = (ts) => new Date(Number(ts || Date.now())).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const getDateLabel = formatDateTime;
  const openIosSwal = (options) => Swal.fire({
    ...options,
    customClass: {
      popup: `ios-alert informes-alert ${options?.customClass?.popup || ''}`.trim(),
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text',
      confirmButton: 'primary',
      denyButton: 'secondary',
      cancelButton: 'secondary',
      ...options.customClass
    }
  });

  const commentsList = (report) => {
    if (Array.isArray(report?.comments)) return report.comments;
    if (report?.comments && typeof report.comments === 'object') return Object.values(report.comments);
    return [];
  };
  const commentAccentFromUserId = (userId) => {
    const seed = String(userId || 'anon');
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 46%)`;
  };

  const toneImportance = (value) => {
    const n = Math.max(0, Math.min(100, Number(value || 0)));
    // Mismos niveles e íconos que en Informes (sin emojis).
    if (n <= 14) return { tone: 'ok', label: 'Excelente', icon: 'fa-circle-check' };
    if (n <= 28) return { tone: 'ok', label: 'Muy bueno', icon: 'fa-thumbs-up' };
    if (n <= 42) return { tone: 'normal', label: 'Bueno', icon: 'fa-thumbs-up' };
    if (n <= 56) return { tone: 'normal', label: 'Normal', icon: 'fa-circle-minus' };
    if (n <= 70) return { tone: 'warn', label: 'Atención', icon: 'fa-circle-exclamation' };
    if (n <= 84) return { tone: 'high', label: 'Importante', icon: 'fa-triangle-exclamation' };
    return { tone: 'critical', label: 'Muy importante', icon: 'fa-bell' };
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

  // Esqueletos de carga (en lugar de spinners) con la forma de cada bloque.
  const SKELETONS = {
    resumen: '<div class="panel-kpi-row" aria-busy="true" aria-label="Cargando métricas"><article class="panel-metric is-skeleton"><div class="panel-metric-top"><sl-skeleton effect="sheen" class="sk-icon"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text" style="width:62%"></sl-skeleton></div><sl-skeleton effect="sheen" class="sk-value"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:78%"></sl-skeleton></article><article class="panel-metric is-skeleton"><div class="panel-metric-top"><sl-skeleton effect="sheen" class="sk-icon"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text" style="width:55%"></sl-skeleton></div><sl-skeleton effect="sheen" class="sk-value"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:52%"></sl-skeleton></article><article class="panel-metric is-skeleton"><div class="panel-metric-top"><sl-skeleton effect="sheen" class="sk-icon"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text" style="width:40%"></sl-skeleton></div><sl-skeleton effect="sheen" class="sk-value"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:64%"></sl-skeleton></article><article class="panel-metric is-skeleton"><div class="panel-metric-top"><sl-skeleton effect="sheen" class="sk-icon"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text" style="width:48%"></sl-skeleton></div><sl-skeleton effect="sheen" class="sk-value"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:82%"></sl-skeleton></article></div>',
    informe: '<div class="panel-informe-row is-skeleton" aria-busy="true" aria-label="Cargando informe"><sl-skeleton effect="sheen" class="sk-icon-lg"></sl-skeleton><span class="panel-informe-text"><sl-skeleton effect="sheen" class="sk-text" style="width:46%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:32%"></sl-skeleton></span><span class="panel-sk-tags sk-tags-group"><sl-skeleton effect="sheen" class="sk-tag"></sl-skeleton><sl-skeleton effect="sheen" class="sk-tag" style="width:76px"></sl-skeleton></span><span class="panel-sk-tags sk-actions-group"><sl-skeleton effect="sheen" class="sk-btn"></sl-skeleton><sl-skeleton effect="sheen" class="sk-icon-btn"></sl-skeleton></span></div>',
    produccion: '<div class="panel-chart-canvas-wrap panel-sk-chart" aria-busy="true" aria-label="Cargando producción"><div class="panel-sk-bar"><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:70%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-bar" style="width:92%"></sl-skeleton></div><div class="panel-sk-bar"><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:84%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-bar" style="width:40%"></sl-skeleton></div><div class="panel-sk-bar"><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:70%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-bar" style="width:31%"></sl-skeleton></div><div class="panel-sk-bar"><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:90%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-bar" style="width:22%"></sl-skeleton></div><div class="panel-sk-bar"><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:56%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-bar" style="width:18%"></sl-skeleton></div><div class="panel-sk-bar"><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:96%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-bar" style="width:14%"></sl-skeleton></div><div class="panel-sk-bar"><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:80%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-bar" style="width:12%"></sl-skeleton></div><div class="panel-sk-bar"><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:84%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-bar" style="width:6%"></sl-skeleton></div><div class="panel-sk-bar"><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:98%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-bar" style="width:4%"></sl-skeleton></div><div class="panel-sk-bar"><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:76%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-bar" style="width:2%"></sl-skeleton></div><div class="panel-sk-axis"></div></div>',
    pendientes: '<div class="panel-pend-list" aria-busy="true" aria-label="Cargando pendientes"><div class="panel-pend-row is-skeleton"><sl-skeleton effect="sheen" class="sk-avatar-static"></sl-skeleton><span class="panel-pend-text"><sl-skeleton effect="sheen" class="sk-text" style="width:58%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:76%"></sl-skeleton></span><sl-skeleton effect="sheen" class="sk-tag" style="width:44px"></sl-skeleton></div><div class="panel-pend-row is-skeleton"><sl-skeleton effect="sheen" class="sk-avatar-static"></sl-skeleton><span class="panel-pend-text"><sl-skeleton effect="sheen" class="sk-text" style="width:48%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:70%"></sl-skeleton></span><sl-skeleton effect="sheen" class="sk-tag" style="width:44px"></sl-skeleton></div><div class="panel-pend-row is-skeleton"><sl-skeleton effect="sheen" class="sk-avatar-static"></sl-skeleton><span class="panel-pend-text"><sl-skeleton effect="sheen" class="sk-text" style="width:72%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:66%"></sl-skeleton></span><sl-skeleton effect="sheen" class="sk-tag" style="width:44px"></sl-skeleton></div><div class="panel-pend-row is-skeleton"><sl-skeleton effect="sheen" class="sk-avatar-static"></sl-skeleton><span class="panel-pend-text"><sl-skeleton effect="sheen" class="sk-text" style="width:60%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:72%"></sl-skeleton></span><sl-skeleton effect="sheen" class="sk-tag" style="width:44px"></sl-skeleton></div><div class="panel-pend-row is-skeleton"><sl-skeleton effect="sheen" class="sk-avatar-static"></sl-skeleton><span class="panel-pend-text"><sl-skeleton effect="sheen" class="sk-text" style="width:52%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:64%"></sl-skeleton></span><sl-skeleton effect="sheen" class="sk-tag" style="width:44px"></sl-skeleton></div><div class="panel-pend-row is-skeleton"><sl-skeleton effect="sheen" class="sk-avatar-static"></sl-skeleton><span class="panel-pend-text"><sl-skeleton effect="sheen" class="sk-text" style="width:78%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:80%"></sl-skeleton></span><sl-skeleton effect="sheen" class="sk-tag" style="width:44px"></sl-skeleton></div><div class="panel-pend-row is-skeleton"><sl-skeleton effect="sheen" class="sk-avatar-static"></sl-skeleton><span class="panel-pend-text"><sl-skeleton effect="sheen" class="sk-text" style="width:56%"></sl-skeleton><sl-skeleton effect="sheen" class="sk-text sk-small" style="width:74%"></sl-skeleton></span><sl-skeleton effect="sheen" class="sk-tag" style="width:44px"></sl-skeleton></div></div>'
  };
  const AVATAR_SKELETON = '<sl-skeleton effect="sheen" class="sk-avatar"></sl-skeleton>';

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

  const findReportById = (id) => (state.reports || []).find((item) => item.id === id);

  const reportPath = (report) => `/informes/${report.year}/${report.month}/${report.day}/${report.id}`;

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
      return `<span class="user-avatar-thumb panel-user-avatar"><span class="thumb-loading">${AVATAR_SKELETON}</span><img class="thumb-image js-panel-thumb" src="${escapeHtml(user.photoUrl)}" alt="${escapeHtml(user.name)}"></span>`;
    }
    return `<span class="user-avatar-thumb">${escapeHtml(initials(user.name))}</span>`;
  };

  const bindThumbs = () => {
    document.querySelectorAll('.js-panel-thumb').forEach((img) => {
      const wrapper = img.closest('.user-avatar-thumb, .panel-avatar, .panel-chart-avatar') || img.parentElement;
      const spinner = wrapper?.querySelector('.thumb-loading');
      const stopThumbLoading = () => {
        img.classList.add('is-loaded');
        spinner?.classList.add('d-none');
      };
      img.addEventListener('load', stopThumbLoading, { once: true });
      img.addEventListener('error', () => {
        stopThumbLoading();
        img.closest('.panel-user-avatar')?.classList.add('is-fallback');
      }, { once: true });
      if (img.complete && img.naturalWidth > 0) {
        stopThumbLoading();
      } else if (typeof img.decode === 'function') {
        img.decode().then(stopThumbLoading).catch(() => {});
      }
      setTimeout(() => {
        if (!img.classList.contains('is-loaded')) stopThumbLoading();
      }, 7000);
    });

    document.querySelectorAll('.js-report-attachment-image').forEach((img) => {
      const stop = () => {
        img.classList.add('is-loaded');
        img.closest('.attachment-card')?.querySelector('.attachment-loader')?.classList.add('d-none');
      };
      img.addEventListener('load', stop, { once: true });
      img.addEventListener('error', stop, { once: true });
      if (img.complete) stop();
    });
  };

  const sortComments = (list = []) => [...list].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  const getCommentList = (report) => sortComments(commentsList(report));
  const renderCommentTree = (comments = [], level = 0) => sortComments(comments).map((comment) => `
    <article class="report-comment-item ${level > 0 ? 'is-reply' : ''}" style="--comment-accent:${commentAccentFromUserId(comment.userId || comment.userName || 'anon')};" data-comment-id="${escapeHtml(comment.id || '')}" data-comment-level="${level}">
      <header class="report-comment-head"><strong>${escapeHtml(comment.userName || 'Usuario')}</strong><small>${escapeHtml(getDateLabel(comment.createdAt))}</small></header>
      <p class="report-comment-text">${escapeHtml(comment.text || '').replaceAll('\n', '<br>')}</p>
      <div class="report-comment-actions"><sl-button variant="text" size="small" type="button" class="report-comment-reply-btn" data-reply-comment="${escapeHtml(comment.id || '')}">Responder</sl-button></div>
      ${Array.isArray(comment.replies) && comment.replies.length ? `<div class="report-comment-replies">${renderCommentTree(comment.replies, level + 1)}</div>` : ''}
    </article>
  `).join('');

  const insertReplyInTree = (comments, targetId, payload) => {
    const source = Array.isArray(comments) ? comments : [];
    return source.map((item) => {
      if (item.id === targetId) {
        const replies = Array.isArray(item.replies) ? [...item.replies, payload] : [payload];
        return { ...item, replies };
      }
      return { ...item, replies: insertReplyInTree(item.replies, targetId, payload) };
    });
  };

  const openProcessingAlert = (message) => openIosSwal({
    title: 'Procesando',
    html: `
      <div class="informes-saving-spinner" style="
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:12px;
        text-align:center;
      ">
        <sl-spinner class="meta-spinner-login" aria-label="Procesando"></sl-spinner>
        <p style="margin:0;">
          ${escapeHtml(message || 'Estamos trabajando...')}
        </p>
      </div>
    `,
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false
  });

  const fetchLatestReportData = async (report) => {
    await window.laJamoneraReady;
    const latest = safeObject(await window.dbLaJamoneraRest.read(reportPath(report)));
    return { ...report, ...latest };
  };

  const waitPrintWindowAssets = async (printWindow) => {
    const images = [...(printWindow?.document?.images || [])];
    if (!images.length) return;
    await Promise.all(images.map((img) => new Promise((resolve) => {
      if (img.complete) { resolve(); return; }
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    })));
  };

  const printReportDirect = async (report, includeAttachments) => {
    const attachments = Array.isArray(report?.attachments) ? report.attachments : [];
    const images = attachments.filter((item) => item?.type === 'image' && item?.url);
    const docs = attachments.filter((item) => item?.type !== 'image' && item?.url);
    const printWindow = window.open('', '_blank', 'width=1300,height=900');
    if (!printWindow) return;
    const attachmentsHtml = includeAttachments
      ? `<section style="margin-top:18px;"><h2 style="margin:0 0 10px;font-size:18px;">Imágenes adjuntas</h2>${images.length ? `<div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));">${images.map((item, idx) => `<figure style="margin:0;border:1px solid #d7def2;border-radius:12px;padding:10px;background:#fff;"><img src="${escapeHtml(item.url)}" style="width:100%;max-height:320px;object-fit:contain;border-radius:10px;"><figcaption style="font-size:12px;color:#4b5f8e;margin-top:6px;">${escapeHtml(item.name || `Adjunto ${idx + 1}`)}</figcaption></figure>`).join('')}</div>` : '<p style="margin:0;color:#5a6482;">Sin imágenes adjuntas.</p>'}</section><section style="margin-top:16px;"><h2 style="margin:0 0 8px;font-size:18px;">Otros adjuntos</h2>${docs.length ? `<ul style="margin:0;padding-left:18px;">${docs.map((item) => `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.name || 'Archivo adjunto')}</a></li>`).join('')}</ul>` : '<p style="margin:0;color:#5a6482;">Sin archivos adjuntos.</p>'}</section>`
      : '<p style="margin-top:14px;color:#5a6482;">Adjuntos no incluidos en esta impresión.</p>';
    printWindow.document.write(`<html><head><title>Informe ${escapeHtml(report.id || '')}</title><style>body{font-family:Inter,Arial,sans-serif;padding:24px;color:#1f2a44}h1{font-size:24px;margin:0 0 10px}.meta{margin:0 0 16px;color:#55607f;font-size:14px}.content{border:1px solid #d7def2;border-radius:12px;padding:12px;background:#fff}</style></head><body><h1>Informe bromatológico</h1><p class="meta"><strong>Usuario:</strong> ${escapeHtml(report.userName || '-')} · <strong>Puesto:</strong> ${escapeHtml(report.userPosition || '-')} · <strong>Fecha:</strong> ${escapeHtml(getDateLabel(report.createdAt))}</p><section class="content">${report.html || '<p>Sin contenido</p>'}</section>${attachmentsHtml}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    await waitPrintWindowAssets(printWindow);
    printWindow.print();
  };

const printReport = async (report) => {
  const choice = await openIosSwal({
    title: 'Imprimir informe',
    html: '<p>Elegí cómo querés generar el informe.</p>',
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: 'Imprimir directo',
    denyButtonText: 'Descargar PDF',
    cancelButtonText: 'Cancelar'
  });

  if (!choice.isConfirmed && !choice.isDenied) return;

  const attachmentsChoice = await openIosSwal({
    title: 'Imprimir período',
    html: '<p>¿Querés incluir imágenes adjuntas?</p>',
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: 'Incluir',
    denyButtonText: 'No incluir',
    cancelButtonText: 'Cancelar',
    customClass: {
      confirmButton: 'success',
      denyButton: 'danger deny-critical',
      cancelButton: 'secondary'
    }
  });

  if (!attachmentsChoice.isConfirmed && !attachmentsChoice.isDenied) return;

  const includeAttachments = attachmentsChoice.isConfirmed;

  try {
    openProcessingAlert(
      choice.isConfirmed
        ? 'Leyendo informe y preparando impresión...'
        : 'Leyendo informe desde Firebase y generando PDF...'
    );

    const latestReport = await fetchLatestReportData(report);

    if (choice.isConfirmed) {
      await printReportDirect(latestReport, includeAttachments);
    } else if (window.pdfMake && window.htmlToPdfmake) {
      const htmlContent = window.htmlToPdfmake(
        latestReport.html || '<p>Sin contenido</p>',
        { window }
      );

      const docDefinition = {
        pageMargins: [28, 28, 28, 28],
        content: [
          { text: 'Informe bromatológico', style: 'header' },
          {
            text: `Usuario: ${latestReport.userName || '-'} · Fecha: ${getDateLabel(latestReport.createdAt)}`,
            style: 'meta'
          },
          htmlContent
        ],
        styles: {
          header: { fontSize: 18, bold: true, margin: [0, 0, 0, 8] },
          meta: { fontSize: 10, color: '#4f5f86', margin: [0, 0, 0, 10] }
        }
      };

      window.pdfMake.createPdf(docDefinition).download(`informe_${latestReport.id || Date.now()}.pdf`);
    } else {
      await openIosSwal({
        title: 'Error al generar PDF',
        html: '<p>No pudimos cargar la librería PDF (pdfmake/html-to-pdfmake). Reintentá en unos segundos.</p>',
        icon: 'error',
        confirmButtonText: 'Entendido'
      });
    }
  } finally {
    Swal.close();
  }
};

  const buildReportEmailHtml = (report, attachments = []) => {
    const imageBlocks = attachments.filter((item) => item?.type === 'image' && item?.url).map((item) => `<figure style="margin:0;border:1px solid #d8e3fb;border-radius:12px;overflow:hidden;"><img src="${escapeHtml(item.url)}" style="width:100%;max-height:420px;object-fit:contain;background:#f6f9ff;"><figcaption style="padding:8px 10px;font-size:12px;color:#526a97;">${escapeHtml(item.name || 'Imagen adjunta')}</figcaption></figure>`).join('') || '<p style="margin:0;color:#5f729b;">Sin imágenes adjuntas.</p>';
    const attachmentItems = attachments.length ? attachments.map((item) => `<li>${item?.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.name || 'Adjunto')}</a>` : escapeHtml(item?.name || 'Adjunto')}</li>`).join('') : '<li>Sin adjuntos.</li>';
    return `<div style="font-family:Inter,Arial,sans-serif;background:#f4f7ff;padding:18px;"><div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #dbe4fb;border-radius:18px;padding:18px;"><h2 style="margin:0 0 6px;color:#2351a0;">Nuevo informe bromatológico</h2><p style="margin:0 0 14px;color:#4f638c;">Creador: <strong>${escapeHtml(report.userName || 'La Jamonera')}</strong> · Fecha: ${getDateLabel(report.createdAt)}</p><div style="border:1px solid #e2e8fb;border-radius:14px;padding:12px;background:#fbfdff;">${report.html || '<p>Sin contenido</p>'}</div><h3 style="margin:14px 0 8px;color:#2d4f91;font-size:15px;">Imágenes adjuntas</h3><div style="display:grid;gap:10px;">${imageBlocks}</div><h3 style="margin:14px 0 6px;color:#2d4f91;font-size:15px;">Documentos y enlaces</h3><ul style="margin:0;padding-left:18px;color:#4b5f89;">${attachmentItems}</ul></div></div>`;
  };

  const openResendReportEmailPrompt = async (report) => {
    const usersWithEmail = Object.values(state.usersMap || {}).filter((user) => normalize(user.email)).sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || '')));
    const usersHtml = usersWithEmail.length ? usersWithEmail.map((user) => `<label class="notify-user-card"><div class="notify-user-main">${renderUserAvatar(user)}<div class="notify-user-text"><strong>${escapeHtml(user.fullName || 'Usuario')}</strong><small>${escapeHtml(user.email || '')}</small></div></div><sl-checkbox data-resend-user-email="${escapeHtml(user.email || '')}" data-resend-user-name="${escapeHtml(user.fullName || '')}" aria-label="${escapeHtml(user.fullName || user.email || 'Usuario')}"></sl-checkbox></label>`).join('') : '<div class="informes-empty">No hay usuarios con email cargado.</div>';
    const response = await openIosSwal({ title: 'Reenviar informe por email', width: 760, showCancelButton: true, confirmButtonText: 'Reenviar', cancelButtonText: 'Cancelar', html: `<div class="text-start report-resend-wrap"><p class="mb-2">Seleccioná usuarios del listado o escribí emails nuevos (separados por coma).</p><div id="resendUsersList" class="notify-specific-users-list">${usersHtml}</div><label class="lj-label mt-3" for="resendExtraEmails">Emails adicionales</label><sl-textarea id="resendExtraEmails" class="swal2-textarea" resize="auto" placeholder="ejemplo@dominio.com, otro@dominio.com"></sl-textarea></div>`, didOpen: (popup) => {
      bindThumbs();
      // sl-checkbox no es "labelable": el click en el resto de la tarjeta lo alterna a mano.
      popup.querySelector('#resendUsersList')?.addEventListener('click', (event) => {
        const card = event.target.closest('.notify-user-card');
        if (!card || event.target.closest('sl-checkbox')) return;
        event.preventDefault();
        const box = card.querySelector('sl-checkbox[data-resend-user-email]');
        if (box) box.checked = !box.checked;
      });
    }, preConfirm: () => {
      const selectedNodes = [...document.querySelectorAll('sl-checkbox[data-resend-user-email]')].filter((node) => node.checked);
      const selected = selectedNodes.map((node) => ({ email: normalize(node.dataset.resendUserEmail), name: normalize(node.dataset.resendUserName) || 'Usuario' })).filter((item) => item.email);
      const extraRaw = normalize(document.getElementById('resendExtraEmails')?.value || '');
      const extraEmails = extraRaw ? extraRaw.split(',').map((item) => normalize(item)).filter(Boolean) : [];
      const invalid = extraEmails.find((item) => !/^\S+@\S+\.\S+$/.test(item));
      if (invalid) { Swal.showValidationMessage(`Email inválido: ${invalid}`); return false; }
      const recipientsByEmail = new Map();
      selected.forEach((item) => recipientsByEmail.set(item.email.toLowerCase(), item));
      extraEmails.forEach((email) => { if (!recipientsByEmail.has(email.toLowerCase())) recipientsByEmail.set(email.toLowerCase(), { email, name: email }); });
      const recipients = Array.from(recipientsByEmail.values());
      if (!recipients.length) { Swal.showValidationMessage('Seleccioná al menos un destinatario o escribí un email.'); return false; }
      return recipients;
    } });
    if (!response.isConfirmed) return;
    if (!window.laJamoneraEmailSender) {
      await openIosSwal({ title: 'Email no disponible', html: '<p>No está cargado el módulo de envío en esta pantalla.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }
    await window.laJamoneraEmailSender.ensureConfigLoaded();
    const latestReport = findReportById(report.id) || report;
    const emailHtml = buildReportEmailHtml(latestReport, latestReport.attachments || []);
    for (const target of (response.value || [])) {
      const sendResponse = await window.laJamoneraEmailSender.sendEmail('La Jamonera', `Reenvío de informe bromatológico · ${latestReport.userName || 'La Jamonera'}`, emailHtml, target.name || target.email, target.email);
      if (sendResponse?.ok) {
        window.laJamoneraNotify?.show({ type: 'success', title: 'Email enviado', message: `Se notificó a ${target.name || target.email}.` });
      } else {
        window.laJamoneraNotify?.show({ type: 'error', title: 'Error de email', message: `No se pudo notificar a ${target.name || target.email}.` });
      }
    }
  };

  const getCommentsCount = (report) => commentsList(report).length;

  const verifyReportCreatorPin = async (report) => {
    const user = safeObject(state.usersMap[report?.userId]);
    if (!user?.pin) return true;
    const result = await openIosSwal({
      title: 'Clave de usuario',
      html: '<sl-input id="panelCreatorPin" class="swal2-input" type="password" inputmode="numeric" maxlength="4" placeholder="Clave de 4 dígitos"></sl-input>',
      showCancelButton: true,
      confirmButtonText: 'Validar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => normalize(document.getElementById('panelCreatorPin')?.value)
    });
    if (!result.isConfirmed) return false;
    if (String(result.value || '') !== String(user.pin || '')) {
      await openIosSwal({ title: 'Clave incorrecta', html: '<p>La clave no coincide con el creador del informe.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      return false;
    }
    return true;
  };

  // Visor del informe en un modal (sl-dialog), no en una alerta. Se crea una sola vez y se reutiliza.
  const ensureReportModal = () => {
    let dialog = document.getElementById('ultimoInformeModal');
    if (dialog) return dialog;
    dialog = document.createElement('sl-dialog');
    dialog.id = 'ultimoInformeModal';
    dialog.className = 'lj-modal panel-informe-modal';
    dialog.setAttribute('label', 'Informe');
    dialog.innerHTML = `
      <div slot="label" class="lj-dialog-title">
        <h5 class="lj-dialog-heading" data-ri="title">Informe</h5>
        <span class="panel-tag is-info" data-ri="date"></span>
        <span class="panel-tag" data-ri="age"></span>
      </div>
      <div class="lj-dialog-body" data-ri="body"></div>
      <div slot="footer" class="panel-informe-modal-footer">
        <sl-button variant="default" type="button" data-lj-close>Cerrar</sl-button>
        <sl-button variant="default" type="button" data-ri="print"><i slot="prefix" class="fa-solid fa-print"></i>Imprimir</sl-button>
        <sl-button variant="primary" href="./informes.html"><i slot="prefix" class="fa-solid fa-arrow-up-right-from-square"></i>Abrir en Informes</sl-button>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('[data-ri="print"]').addEventListener('click', async () => {
      if (dialog.ljReport) await printReport(dialog.ljReport);
    });
    return dialog;
  };

  const openViewer = async (report) => {
    const dialog = ensureReportModal();
    dialog.ljReport = report;
    const user = getReportUser(report);
    const attachments = Array.isArray(report.attachments) ? report.attachments : [];
    const date = new Date(Number(report.createdAt || Date.now())).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    dialog.querySelector('[data-ri="title"]').textContent = reportTitle(report);
    dialog.querySelector('[data-ri="date"]').textContent = date;
    const ageTag = dialog.querySelector('[data-ri="age"]');
    ageTag.className = `panel-tag is-${ageTone(report.createdAt)}`;
    ageTag.textContent = `${ago(report.createdAt).charAt(0)}${ago(report.createdAt).slice(1).toLowerCase()}`;

    const attachmentHtml = attachments.length
      ? `<section class="panel-informe-modal-section"><h6 class="panel-informe-modal-subtitle">Adjuntos</h6><div class="attachments-grid">${attachments.map((item, index) => {
        if (item?.type === 'image') {
          return `<button type="button" class="lj-tile attachment-card" data-open-report-image="${index}"><span class="attachment-loader"><sl-skeleton effect="sheen" class="sk-fill"></sl-skeleton></span><img src="${escapeHtml(item.url || '')}" alt="${escapeHtml(item.name || 'Adjunto')}" class="attachment-image js-report-attachment-image"></button>`;
        }
        return `<a href="${escapeHtml(item?.url || '#')}" target="_blank" rel="noopener noreferrer" class="attachment-card attachment-doc"><sl-icon name="file-earmark"></sl-icon><span>${escapeHtml(item?.name || 'Documento')}</span></a>`;
      }).join('')}</div></section>`
      : '';
    const users = Object.values(state.usersMap || {}).sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || '')));
    const commentUserOptions = users.map((item) => `<sl-option value="${ljOptionValue(item.id || '')}">${escapeHtml(item.fullName || 'Usuario')}</sl-option>`).join('');
    const comments = getCommentList(report);
    const commentsHtml = comments.length
      ? `<div class="report-comments-thread">${renderCommentTree(comments)}</div>`
      : '<div class="informes-empty report-comments-empty">Sin comentarios todavía.</div>';

    const body = dialog.querySelector('[data-ri="body"]');
    body.innerHTML = `
      <div class="panel-informe-modal-inner">
        <header class="panel-informe-modal-author">
          ${renderUserAvatar(user)}
          <div class="panel-informe-modal-author-text"><strong>${escapeHtml(user.name || '-')}</strong><small>${escapeHtml(user.position || '-')} · Actualizado ${escapeHtml(getDateLabel(report.updatedAt || report.createdAt))}</small></div>
          <sl-button variant="default" size="small" type="button" data-resend-report-email="1"><i slot="prefix" class="fa-regular fa-paper-plane"></i>Reenviar email</sl-button>
        </header>
        <article class="report-viewer-content panel-informe-modal-content">${report.html || '<p>Sin contenido.</p>'}</article>
        ${attachmentHtml}
        <section class="report-comments-wrap panel-informe-modal-section">
          <h6 class="panel-informe-modal-subtitle"><i class="fa-regular fa-comments" aria-hidden="true"></i><span>Comentarios</span></h6>
          <div class="report-inline-comment-form">
            <div class="report-inline-comment-reply d-none" id="inlineReplyLabel"></div>
            <div class="panel-informe-comment-grid">
              <sl-select id="inlineCommentUser" placeholder="Seleccioná un usuario" hoist>${commentUserOptions}</sl-select>
              <sl-input id="inlineCommentPin" type="password" inputmode="numeric" maxlength="4" placeholder="Clave de 4 dígitos"></sl-input>
            </div>
            <sl-textarea id="inlineCommentText" resize="auto" rows="2" placeholder="Escribí un comentario"></sl-textarea>
            <div class="panel-informe-comment-actions"><sl-button variant="default" type="button" class="d-none" id="inlineCancelReplyBtn">Cancelar respuesta</sl-button><sl-button variant="primary" type="button" id="inlineSendCommentBtn"><i slot="prefix" class="fa-solid fa-paper-plane"></i>Enviar comentario</sl-button></div>
          </div>
          <div id="reportCommentsBody">${commentsHtml}</div>
        </section>
      </div>`;
    body.scrollTop = 0;
    bindThumbs();

    let replyToId = '';
    const commentsBody = body.querySelector('#reportCommentsBody');
    const replyLabel = body.querySelector('#inlineReplyLabel');
    const cancelReplyBtn = body.querySelector('#inlineCancelReplyBtn');
    const sendBtn = body.querySelector('#inlineSendCommentBtn');

    body.querySelectorAll('.attachment-card[data-open-report-image]').forEach((node) => {
      node.addEventListener('click', async (event) => {
        event.preventDefault();
        const index = Number(node.dataset.openReportImage || 0);
        const imageAttachments = attachments.filter((item) => item?.type === 'image').map((item) => item?.url).filter(Boolean);
        if (!imageAttachments.length) return;
        if (typeof window.laJamoneraOpenImageViewer === 'function') {
          await window.laJamoneraOpenImageViewer([{ invoiceImageUrls: imageAttachments }], Math.max(0, index), 'Adjuntos del informe');
        }
      });
    });

    body.querySelector('[data-resend-report-email]')?.addEventListener('click', async () => {
      await openResendReportEmailPrompt(report);
    });

    commentsBody?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-reply-comment]');
      if (!btn) return;
      replyToId = btn.dataset.replyComment || '';
      const author = btn.closest('.report-comment-item')?.querySelector('.report-comment-head strong')?.textContent || 'usuario';
      replyLabel.textContent = `Respondiendo a ${author}`;
      replyLabel.classList.remove('d-none');
      cancelReplyBtn.classList.remove('d-none');
    });

    cancelReplyBtn?.addEventListener('click', () => {
      replyToId = '';
      replyLabel.classList.add('d-none');
      replyLabel.textContent = '';
      cancelReplyBtn.classList.add('d-none');
    });

    sendBtn?.addEventListener('click', async () => {
      const userId = normalize(ljSelectValue(body.querySelector('#inlineCommentUser')));
      const text = normalize(body.querySelector('#inlineCommentText')?.value);
      const pin = normalize(body.querySelector('#inlineCommentPin')?.value);
      if (!userId || !text) return;
      const author = safeObject(state.usersMap[userId]);
      const authorId = normalize(author.id || userId);
      if (!authorId || String(author.pin || '') !== String(pin || '')) {
        await openIosSwal({ title: 'Clave incorrecta', html: '<p>La clave no coincide con el usuario seleccionado.</p>', icon: 'error', confirmButtonText: 'Entendido' });
        return;
      }
      const latest = safeObject(await window.dbLaJamoneraRest.read(reportPath(report)));
      const list = getCommentList(latest);
      const payload = { id: `comment_${Date.now()}`, createdAt: Date.now(), userId: authorId, userName: author.fullName || 'Usuario', text, replies: [] };
      const nextComments = replyToId ? insertReplyInTree(list, replyToId, payload) : [...list, payload];
      await window.dbLaJamoneraRest.update(reportPath(report), { comments: nextComments });
      await window.dbLaJamoneraRest.update(`/informes_index/${report.year}/${report.month}/${report.day}/${report.id}`, { commentsCount: nextComments.length, updatedAt: Date.now() });
      const refreshed = safeObject(await window.dbLaJamoneraRest.read(reportPath(report)));
      commentsBody.innerHTML = `<div class="report-comments-thread">${renderCommentTree(getCommentList(refreshed))}</div>`;
      body.querySelector('#inlineCommentText').value = '';
      body.querySelector('#inlineCommentPin').value = '';
      replyToId = '';
      replyLabel.classList.add('d-none');
      cancelReplyBtn.classList.add('d-none');
      await loadOnce();
    });

    await customElements.whenDefined('sl-dialog');
    window.LJModal.open(dialog);
  };

  const promptComment = async (report) => {
    const users = Object.values(state.usersMap || {}).sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || '')));
    const options = users.map((user) => `<sl-option value="${ljOptionValue(user.id)}">${escapeHtml(user.fullName || 'Usuario')}</sl-option>`).join('');
    const result = await openIosSwal({
      title: 'Agregar comentario',
      html: `<sl-select id="panelCommentUser" class="mb-2" placeholder="Seleccioná un usuario" hoist>${options}</sl-select><sl-textarea id="panelCommentText" class="swal2-textarea mb-2" resize="auto" maxlength="500" placeholder="Escribí un comentario"></sl-textarea><sl-input id="panelCommentPin" class="swal2-input" type="password" inputmode="numeric" maxlength="4" placeholder="Clave de 4 dígitos"></sl-input>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => ({
        userId: normalize(ljSelectValue(document.getElementById('panelCommentUser'))),
        text: normalize(document.getElementById('panelCommentText')?.value),
        pin: normalize(document.getElementById('panelCommentPin')?.value)
      })
    });
    if (!result.isConfirmed) return;
    const payload = safeObject(result.value);
    if (!payload.userId || !payload.text) return;
    const author = safeObject(state.usersMap[payload.userId]);
    const authorId = normalize(author.id || payload.userId);
    if (!authorId || String(author.pin || '') !== String(payload.pin || '')) {
      await openIosSwal({ title: 'Clave incorrecta', html: '<p>La clave no coincide con el usuario seleccionado.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      return;
    }
    const path = reportPath(report);
    const latest = safeObject(await window.dbLaJamoneraRest.read(path));
    const comments = commentsList(latest);
    comments.push({ id: `comment_${Date.now()}`, createdAt: Date.now(), userId: authorId, userName: author.fullName || 'Usuario', text: payload.text });
    await window.dbLaJamoneraRest.update(path, { comments });
    await window.dbLaJamoneraRest.write(`/informes_index/${report.year}/${report.month}/${report.day}/${report.id}`, {
      id: report.id,
      reportDate: report.reportDate,
      userId: report.userId,
      userName: report.userName,
      importance: Math.max(0, Math.min(100, Number(report.importance || 50))),
      createdAt: Number(report.createdAt || Date.now()),
      attachmentsCount: Array.isArray(report.attachments) ? report.attachments.length : 0,
      commentsCount: comments.length,
      updatedAt: Date.now()
    });
    await loadOnce();
  };

  const promptEdit = async (report) => {
    const allowed = await verifyReportCreatorPin(report);
    if (!allowed) return;

    const result = await openIosSwal({
      title: 'Editar informe',
      html: `<sl-textarea id="panelEditReportHtml" class="swal2-textarea" rows="10" resize="auto" value="${(report.html || '').replace(/<[^>]+>/g, '').replace(/"/g, '&quot;')}"></sl-textarea>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar cambios',
      cancelButtonText: 'Cancelar',
      preConfirm: () => normalize(document.getElementById('panelEditReportHtml')?.value)
    });
    const text = normalize(result.value);
    if (!result.isConfirmed || !text) return;
    const updatedAt = Date.now();
    await window.dbLaJamoneraRest.update(reportPath(report), { html: `<p>${escapeHtml(text).replace(/\n/g, '</p><p>')}</p>`, updatedAt });
    await window.dbLaJamoneraRest.update(`/informes_index/${report.year}/${report.month}/${report.day}/${report.id}`, { updatedAt });
    await loadOnce();
  };

  const deleteReport = async (report) => {
    const allowed = await verifyReportCreatorPin(report);
    if (!allowed) return;

    const ask = await openIosSwal({
      title: 'Borrar informe',
      html: '<p>Esta acción eliminará el informe de forma definitiva.</p>',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Borrar',
      cancelButtonText: 'Cancelar'
    });
    if (!ask.isConfirmed) return;
    await window.dbLaJamoneraRest.write(reportPath(report), null);
    await window.dbLaJamoneraRest.write(`/informes_index/${report.year}/${report.month}/${report.day}/${report.id}`, null);
    await loadOnce();
  };

  // Título del informe: primer encabezado del HTML (en mayúsculas se pasa a tipo oración).
  const reportTitle = (report) => {
    let title = '';
    try {
      const doc = new DOMParser().parseFromString(String(report?.html || ''), 'text/html');
      title = normalize(doc.querySelector('h1, h2, h3, h4, h5, h6, strong, p')?.textContent).replace(/\s+/g, ' ');
    } catch (error) {}
    if (!title) return 'Informe bromatológico';
    if (title === title.toUpperCase()) title = title.toLowerCase().replace(/^./, (c) => c.toUpperCase());
    return title.length > 90 ? `${title.slice(0, 88)}…` : title;
  };

  const ageTone = (ts) => {
    const days = Math.floor((Date.now() - Number(ts || Date.now())) / 86400000);
    if (days > 30) return 'danger';
    return days > 7 ? 'warning' : 'info';
  };

  // Último informe en una fila compacta; "Ver informe" abre el visor completo de siempre.
  const renderLastReport = () => {
    const report = state.report;
    if (!report) {
      nodes.informe.innerHTML = '<div class="panel-informe-row is-empty"><span class="panel-informe-icon" aria-hidden="true"><i class="fa-solid fa-file-medical"></i></span><span class="panel-informe-text"><strong>Último informe</strong><small>Todavía no hay informes cargados.</small></span></div>';
      return;
    }

    const user = getReportUser(report);
    const attachments = Array.isArray(report.attachments) ? report.attachments : [];
    const images = attachments.filter((x) => x?.type === 'image').length;
    const docs = Math.max(0, attachments.length - images);
    const comments = commentsList(report).length;
    const importance = toneImportance(report.importance);
    const scoreLabel = importance.label;
    const scoreTone = { ok: 'success', normal: 'info', warn: 'warning', high: 'warning', critical: 'danger' }[importance.tone] || 'info';
    const date = new Date(Number(report.createdAt || Date.now())).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const avatar = user.photoUrl
      ? `<span class="panel-informe-avatar"><img class="js-panel-thumb" src="${escapeHtml(user.photoUrl)}" alt=""></span>`
      : `<span class="panel-informe-avatar">${escapeHtml(initials(user.name))}</span>`;
    const countTag = (n, icon, label) => (n > 0 ? `<span class="panel-tag" title="${label}"><i class="fa-regular ${icon}" aria-hidden="true"></i>${n}</span>` : '');

    nodes.informe.innerHTML = `
      <div class="panel-informe-row" data-report-id="${escapeHtml(report.id)}">
        <span class="panel-informe-icon" aria-hidden="true"><i class="fa-solid fa-file-medical"></i></span>
        <span class="panel-informe-text">
          <strong title="${escapeHtml(reportTitle(report))}"><span class="panel-informe-kicker">Último informe</span>${escapeHtml(reportTitle(report))}</strong>
          <small>${avatar}<span>${escapeHtml(date)} · ${escapeHtml(user.name)} · ${escapeHtml(user.position)}</span></small>
        </span>
        <span class="panel-informe-tags">
          <span class="panel-tag is-${scoreTone}"><i class="fa-solid ${importance.icon}" aria-hidden="true"></i>${Math.max(0, Math.min(100, Number(report.importance || 0)))}% · ${escapeHtml(scoreLabel)}</span>
          <span class="panel-tag is-${ageTone(report.createdAt)}">${escapeHtml(ago(report.createdAt).charAt(0))}${escapeHtml(ago(report.createdAt).slice(1).toLowerCase())}</span>
          ${countTag(images, 'fa-image', 'Imágenes adjuntas')}${countTag(docs, 'fa-file-lines', 'Documentos adjuntos')}${countTag(comments, 'fa-comment', 'Comentarios')}
        </span>
        <span class="panel-informe-actions">
          <sl-button variant="default" size="small" type="button" data-view-report="1"><i slot="prefix" class="fa-regular fa-eye"></i>Ver informe</sl-button>
          <sl-button variant="default" size="small" type="button" class="lj-icon-btn" data-print-report="1" title="Imprimir informe" aria-label="Imprimir informe"><i class="fa-solid fa-print"></i></sl-button>
        </span>
      </div>`;
    bindThumbs();
  };

  nodes.informe?.addEventListener('click', async (event) => {
    if (!state.report) return;
    if (event.target.closest('[data-print-report]')) await printReport(state.report);
    else if (event.target.closest('[data-view-report]')) await openViewer(state.report);
  });

  const renderSummary = () => {
    const cards = [
      { key: 'rne', icon: 'shield-exclamation', value: state.providers.length, title: 'RNE pendientes', note: 'proveedores sin completar' },
      { key: 'rnpa', icon: 'clipboard2-check', value: state.recipes.length, title: 'RNPA críticos', note: 'recetas a revisar' },
      { key: 'transport', icon: 'truck-front', value: state.vehicles.length, title: 'UTA/URA', note: 'unidades por vencer' },
      { key: 'reports', icon: 'file-earmark-medical', value: state.reports.length, title: 'Informes', note: state.report ? `cargados · último ${ago(state.report.createdAt).toLowerCase()}` : 'cargados' }
    ];
    nodes.resumen.innerHTML = `<div class="panel-kpi-row">${cards.map((card) => `<article class="panel-metric panel-metric-${card.key}"><div class="panel-metric-top"><span class="panel-metric-icon"><sl-icon name="${card.icon}"></sl-icon></span><strong class="panel-metric-title">${escapeHtml(card.title)}</strong></div><span class="panel-metric-value">${card.value}</span><small class="panel-metric-note">${escapeHtml(card.note)}</small></article>`).join('')}</div>`;
  };

  // Saludo con la hora y la fecha de Argentina.
  const TZ = 'America/Argentina/Buenos_Aires';
  const pendingCount = () => state.providers.length + state.recipes.length + state.vehicles.length;
  const renderGreeting = () => {
    if (!nodes.greetingTitle) return;
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('es-AR', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(now));
    const hello = hour >= 5 && hour < 13 ? 'Buen día' : (hour >= 13 && hour < 20 ? 'Buenas tardes' : 'Buenas noches');
    const date = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(now).replace(',', '');
    const n = pendingCount();
    nodes.greetingTitle.textContent = `${hello}, ${state.userName || 'La Jamonera'}`;
    const status = !state.initialized && !state.reports.length && !n ? '' : (n ? ` · ${n} ${n === 1 ? 'tema' : 'temas'} para revisar` : ' · Todo en orden');
    nodes.greetingSub.textContent = `${date.charAt(0).toUpperCase()}${date.slice(1)}${status}`;
  };

  const daysText = (days, past, future) => {
    if (days === 0) return `${future} hoy`;
    const n = Math.abs(days);
    return days < 0 ? `${past} hace ${n} ${n === 1 ? 'día' : 'días'}` : `${future} en ${n} ${n === 1 ? 'día' : 'días'}`;
  };

  // Lista única de pendientes por urgencia: vencidos, RNE sin completar, por vencer; el último informe al final.
  const buildPendingItems = () => {
    const items = [];
    state.recipes.forEach((recipe) => {
      const days = dayDiff(recipe.rnpa?.expiryDate);
      items.push({ rank: days < 0 ? 0 : 2, days, title: recipe.title || 'Receta', sub: `RNPA ${daysText(days, 'venció', 'vence')}`, tag: 'RNPA', tone: days < 0 ? 'danger' : 'warning', photo: recipe.imageUrl, icon: 'fa-clipboard-check', open: '#recetasModal' });
    });
    state.vehicles.forEach((vehicle) => {
      const days = dayDiff(vehicle.expiryDate);
      items.push({ rank: days < 0 ? 0 : 2, days, title: `${vehicle.number || '-'} · ${vehicle.patent || '-'}`, sub: `${vehicle.brand || vehicle.type || 'Unidad'} · ${daysText(days, 'venció', 'vence')}`, tag: 'UTA/URA', tone: days < 0 ? 'danger' : 'warning', icon: 'fa-truck', open: '#produccionModal' });
    });
    state.providers.forEach((provider) => {
      items.push({ rank: 1, days: 0, title: provider.name || 'Proveedor', sub: 'Completar el RNE del proveedor', tag: 'RNE', tone: 'danger', photo: provider.photoUrl, icon: 'fa-shield-halved', open: '#inventarioModal' });
    });
    return items.sort((a, b) => (a.rank - b.rank) || (a.days - b.days) || String(a.title).localeCompare(String(b.title)));
  };

  const pendingAvatar = (item) => {
    const photo = normalize(item.photo);
    if (photo) return `<span class="panel-avatar"><span class="thumb-loading">${AVATAR_SKELETON}</span><img class="js-panel-thumb" src="${escapeHtml(photo)}" alt=""></span>`;
    return `<span class="panel-avatar is-icon is-${item.tone}"><i class="fa-solid ${item.icon}" aria-hidden="true"></i></span>`;
  };

  const renderPendientes = () => {
    const items = buildPendingItems();
    const n = pendingCount();
    nodes.pendientesCount.hidden = !n;
    nodes.pendientesCount.textContent = String(n);
    if (!items.length) {
      nodes.pendientes.innerHTML = '<div class="panel-empty"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>No hay pendientes.</span></div>';
      return;
    }
    nodes.pendientes.innerHTML = `<div class="panel-pend-list">${items.map((item) => `<button type="button" class="lj-tile panel-pend-row" data-lj-open="${item.open}" title="Abrir módulo">${pendingAvatar(item)}<span class="panel-pend-text"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.sub)}</small></span><span class="panel-tag is-${item.tone}">${escapeHtml(item.tag)}</span></button>`).join('')}</div>`;
  };

  nodes.homeNav?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // Gráfico de producción con Apache ECharts 5. Colores tomados de los tokens --lj-* (claro/oscuro).
  // Color por receta en todos los tipos (pedido del dueño): paleta categórica de 10 (cubre el top 10 sin repetir),
  // en orden fijo. Validada con el validador del skill dataviz (pares adyacentes):
  //   claro vs #ffffff: banda/croma OK, CVD peor 16.3, visión normal peor 19.6 (3 tonos < 3:1 → hay etiquetas y tabla oculta).
  //   oscuro vs #161e2e: banda/croma OK, CVD peor 13.2, visión normal peor 19.3, contraste ≥ 3:1.
  // La posición 4 (azul) en claro es el valor de --lj-accent.
  const CATEGORICAL = {
    light: ['#eb6834', '#a43fbf', '#1baf7a', '#1f5fbf', '#e87ba4', '#eda100', '#0a8fb3', '#008300', '#4a3aa7', '#e34948'],
    dark: ['#d95926', '#b866d6', '#199e70', '#3987e5', '#d55181', '#c98500', '#1aa3c9', '#2f9a2f', '#9085e9', '#e66767']
  };
  const DONUT_MAX_SLICES = CATEGORICAL.light.length;

  const chartState = { instance: null, type: 'horizontalBar', lastSignature: '', lastTop: null, observer: null };

  const readChartTheme = () => {
    const rootStyle = getComputedStyle(document.documentElement);
    const token = (name, fallback) => rootStyle.getPropertyValue(name).trim() || fallback;
    const dark = document.documentElement.classList.contains('sl-theme-dark');
    const accent = token('--lj-accent', dark ? '#6ea0ff' : '#1f5fbf');
    const categorical = (dark ? CATEGORICAL.dark : CATEGORICAL.light).slice();
    return {
      dark,
      accent,
      categorical,
      surface: token('--lj-surface', dark ? '#161e2e' : '#ffffff'),
      surface2: token('--lj-surface-2', dark ? '#1c2638' : '#f2f5fb'),
      text: token('--lj-text', dark ? '#e3e9f5' : '#1f2a44'),
      muted: token('--lj-muted', dark ? '#93a0bb' : '#55607f'),
      border: token('--lj-border', dark ? '#26324a' : '#dfe5f0'),
      borderStrong: token('--lj-border-strong', dark ? '#334262' : '#cfd8e8'),
      font: getComputedStyle(document.body).fontFamily || 'Inter, system-ui, sans-serif'
    };
  };

  const formatKg = (value) => `${Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg`;
  const formatAxis = (value) => Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });

  // Tooltip: el valor manda (fuerte), el nombre acompaña. Textos escapados (vienen de la base).
  const tooltipHtml = (theme, name, value, color, extra = '') => `<div style="display:grid;gap:2px;min-width:120px;">
      <strong style="font-size:14px;color:${theme.text};font-variant-numeric:tabular-nums;">${escapeHtml(formatKg(value))}${extra ? ` <span style="font-weight:500;color:${theme.muted};">· ${escapeHtml(extra)}</span>` : ''}</strong>
      <span style="display:flex;align-items:center;gap:6px;font-size:12px;color:${theme.muted};"><span style="width:12px;height:2px;background:${color};border-radius:1px;flex:0 0 auto;"></span>${escapeHtml(name)}</span>
    </div>`;

  const ensureChartDom = () => {
    let el = nodes.produccion.querySelector('#produccionChart');
    if (el) return el;
    nodes.produccion.innerHTML = '<div class="panel-chart-canvas-wrap"><div id="produccionChart" class="panel-chart" role="img" aria-label="Producción en kilos"></div><table class="visually-hidden" id="produccionChartTable"><caption>Producción en kilos por receta</caption><thead><tr><th scope="col">Receta</th><th scope="col">Kilos</th></tr></thead><tbody></tbody></table></div>';
    el = nodes.produccion.querySelector('#produccionChart');
    return el;
  };

  const fillChartTable = (top) => {
    const body = nodes.produccion.querySelector('#produccionChartTable tbody');
    if (!body) return;
    body.innerHTML = top.map((item) => `<tr><td>${escapeHtml(String(item.name || '').toUpperCase())}</td><td>${escapeHtml(formatKg(item.kg))}</td></tr>`).join('');
  };

  // Ancho máximo de las etiquetas de categoría según el ancho disponible (truncadas con "…").
  const categoryLabelWidth = (el, type) => {
    const width = el?.clientWidth || 600;
    if (type === 'horizontalBar') return Math.max(90, Math.min(230, Math.round(width * 0.3)));
    const count = Math.max(1, chartState.lastTop?.length || 1);
    const slot = Math.round((width - 70) / count) - 6;
    if (width < 520) return 96;
    return slot < 130 ? 140 : Math.min(160, slot);
  };

  // Etiquetas de barras verticales/línea: rotadas cuando no entran derechas (más en pantallas angostas).
  const verticalRotate = (el) => {
    const width = el?.clientWidth || 600;
    if (width < 520) return 45;
    return width / Math.max(1, chartState.lastTop?.length || 1) < 136 ? 30 : 0;
  };

  const buildChartOption = (top, type, theme, el) => {
    const labels = top.map((x) => String(x.name || '').toUpperCase());
    const values = top.map((x) => Number(Number(x.kg || 0).toFixed(2)));
    const base = {
      animationDuration: 450,
      animationDurationUpdate: 300,
      textStyle: { fontFamily: theme.font, color: theme.muted },
      tooltip: {
        confine: true,
        backgroundColor: theme.surface,
        borderColor: theme.border,
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: theme.text, fontFamily: theme.font, fontSize: 12 },
        extraCssText: `border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,${theme.dark ? 0.4 : 0.12});`
      }
    };

    if (type === 'doughnut') {
      // Nombres repetidos (dos recetas homónimas) se desambiguan con espacios de ancho cero: ECharts agrupa leyenda y color por nombre.
      const seen = {};
      const items = top.map((item, index) => {
        const label = labels[index];
        seen[label] = (seen[label] || 0) + 1;
        return { name: seen[label] > 1 ? label + String.fromCharCode(0x200b).repeat(seen[label] - 1) : label, value: values[index] };
      });
      let slices = items;
      if (items.length > DONUT_MAX_SLICES) {
        const head = items.slice(0, DONUT_MAX_SLICES - 1);
        const rest = items.slice(DONUT_MAX_SLICES - 1);
        const restValue = Number(rest.reduce((sum, item) => sum + item.value, 0).toFixed(2));
        slices = [...head, { name: `OTROS (${rest.length})`, value: restValue, others: rest.map((item) => item.name).join(', ') }];
      }
      const colors = slices.map((slice, index) => (slice.others ? theme.muted : theme.categorical[index % theme.categorical.length]));
      const total = values.reduce((sum, v) => sum + v, 0) || 1;
      // Estimación de filas de leyenda (texto ~7 px por carácter + muestra) para dejarle lugar abajo.
      const legendWidth = slices.reduce((sum, slice) => sum + slice.name.length * 7 + 30, 0);
      const legendRows = Math.ceil(legendWidth / Math.max(200, (el?.clientWidth || 600) * 0.94 - 20));
      return {
        ...base,
        color: colors,
        tooltip: {
          ...base.tooltip,
          trigger: 'item',
          formatter: (p) => tooltipHtml(theme, p.data?.others ? `${p.name}: ${p.data.others}` : p.name, p.value, p.color, `${((Number(p.value) / total) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`)
        },
        legend: {
          type: 'plain',
          bottom: 0,
          left: 'center',
          width: '94%',
          icon: 'rect',
          itemWidth: 10,
          itemHeight: 10,
          itemGap: 14,
          textStyle: { color: theme.text, fontSize: 12, fontFamily: theme.font },
          pageTextStyle: { color: theme.muted },
          pageIconColor: theme.accent,
          pageIconInactiveColor: theme.border
        },
        series: [{
          type: 'pie',
          name: 'Kilos',
          radius: ['50%', '75%'],
          // Caja del anillo: arriba de la leyenda (los % del radio se calculan sobre esta caja).
          top: 8,
          bottom: legendRows * 24 + 12,
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: theme.surface, borderWidth: 2 },
          emphasis: { scale: true, scaleSize: 5, label: { show: false } },
          data: slices.map(({ name, value, others }, index) => ({ name, value, others, itemStyle: { color: colors[index] } }))
        }]
      };
    }

    const isHorizontal = type === 'horizontalBar';
    const labelWidth = categoryLabelWidth(el, type);
    const categoryAxis = {
      type: 'category',
      data: labels,
      inverse: isHorizontal,
      axisTick: { show: false },
      axisLine: { show: true, lineStyle: { color: theme.borderStrong } },
      axisLabel: {
        color: theme.muted,
        fontSize: 11,
        interval: 0,
        width: labelWidth,
        overflow: 'truncate',
        rotate: isHorizontal ? 0 : verticalRotate(el),
        hideOverlap: false
      },
      boundaryGap: type !== 'line' ? true : ['4%', '4%']
    };
    const narrow = (el?.clientWidth || 600) < 520;
    const valueAxis = {
      type: 'value',
      min: 0,
      splitNumber: narrow ? 3 : 5,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: theme.border, width: 1, type: 'dotted' } },
      axisLabel: { color: theme.muted, fontSize: 11, formatter: formatAxis }
    };
    const grid = { left: isHorizontal ? 8 : (narrow ? 36 : 44), right: isHorizontal ? 48 : 16, top: 16, bottom: 8, containLabel: true };

    if (type === 'line') {
      return {
        ...base,
        grid,
        xAxis: categoryAxis,
        yAxis: valueAxis,
        tooltip: {
          ...base.tooltip,
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: theme.borderStrong, width: 1, type: 'solid' } },
          formatter: (params) => {
            const p = Array.isArray(params) ? params[0] : params;
            return p ? tooltipHtml(theme, p.name, p.value, theme.categorical[p.dataIndex % theme.categorical.length]) : '';
          }
        },
        series: [{
          type: 'line',
          name: 'Kilos',
          data: values.map((value, index) => ({ value, itemStyle: { color: theme.categorical[index % theme.categorical.length] } })),
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: 10,
          lineStyle: { width: 2, color: theme.accent, cap: 'round', join: 'round' },
          itemStyle: { color: theme.accent, borderColor: theme.surface, borderWidth: 2 },
          areaStyle: { color: theme.accent, opacity: 0.1 },
          emphasis: { scale: 1.4, focus: 'none' }
        }]
      };
    }

    return {
      ...base,
      grid,
      xAxis: isHorizontal ? valueAxis : categoryAxis,
      yAxis: isHorizontal ? categoryAxis : valueAxis,
      tooltip: {
        ...base.tooltip,
        trigger: 'item',
        formatter: (p) => tooltipHtml(theme, p.name, p.value, p.color)
      },
      series: [{
        type: 'bar',
        name: 'Kilos',
        data: values.map((value, index) => ({ value, itemStyle: { color: theme.categorical[index % theme.categorical.length] } })),
        barMaxWidth: 24,
        barCategoryGap: '30%',
        itemStyle: { borderRadius: 0 },
        emphasis: { itemStyle: { opacity: 0.85 } },
        label: isHorizontal
          ? { show: true, position: 'right', distance: 6, color: theme.muted, fontSize: 11, formatter: (p) => formatAxis(p.value) }
          : { show: false }
      }]
    };
  };

  const disposeChart = () => {
    chartState.observer?.disconnect();
    chartState.observer = null;
    if (chartState.instance && !chartState.instance.isDisposed()) chartState.instance.dispose();
    chartState.instance = null;
    chartState.lastSignature = '';
  };

  const drawChart = (top, type, { force = false } = {}) => {
    if (!window.echarts) {
      nodes.produccion.innerHTML = '<div class="panel-empty">No se pudo cargar la librería de gráficos.</div>';
      return;
    }
    const el = ensureChartDom();
    if (!el) return;
    if (chartState.instance && (chartState.instance.isDisposed() || chartState.instance.getDom() !== el)) disposeChart();
    const signature = JSON.stringify({ type, top: top.map((item) => [item.id, item.name, item.kg]) });
    if (!force && chartState.instance && chartState.lastSignature === signature) return;
    chartState.lastSignature = signature;
    if (!chartState.instance) {
      chartState.instance = window.echarts.init(el, null, { renderer: 'canvas' });
      if ('ResizeObserver' in window) {
        let raf = 0;
        let lastWidth = el.clientWidth;
        chartState.observer = new ResizeObserver(() => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            const inst = chartState.instance;
            if (!inst || inst.isDisposed()) return;
            inst.resize();
            if (el.clientWidth === lastWidth) return;
            lastWidth = el.clientWidth;
            // Etiquetas, rotación, divisiones y filas de leyenda dependen del ancho: se recalculan sin animar.
            if (chartState.lastTop?.length) {
              inst.setOption({ ...buildChartOption(chartState.lastTop, chartState.type, readChartTheme(), el), animation: false }, { notMerge: true });
            }
          });
        });
        chartState.observer.observe(el);
      }
    }
    chartState.instance.setOption(buildChartOption(top, type, readChartTheme(), el), { notMerge: true });
    fillChartTable(top);
  };

  // Cambio de tema: se descarta la instancia y se vuelve a crear con los colores nuevos.
  document.addEventListener('lj-theme-change', () => {
    if (!chartState.instance) return;
    disposeChart();
    if (chartState.lastTop && chartState.lastTop.length) drawChart(chartState.lastTop, chartState.type, { force: true });
  });

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
      if (!map[key]) map[key] = { id: normalize(item.recipeId), name: normalize(item.recipeTitle || item.recipeName || item.recipeId || 'Sin nombre'), kg: 0, imageUrl: normalize(item.recipeImageUrl) };
      map[key].kg = Number((Number(map[key].kg || 0) + Number(item.quantityKg || 0)).toFixed(2));
    });

    const top = Object.values(map).map((item) => {
      const recipe = safeObject(state.recipesById[item.id]);
      if (!item.imageUrl && normalize(recipe.imageUrl)) item.imageUrl = normalize(recipe.imageUrl);
      return item;
    }).sort((a, b) => b.kg - a.kg).slice(0, 10);

    if (!top.length) {
      disposeChart();
      nodes.produccion.innerHTML = '<div class="panel-empty">No hay produccion en el rango seleccionado.</div>';
      return;
    }

    chartState.lastTop = top;
    drawChart(top, chartState.type);
  };

  const bindChartTypeToggle = () => {
    const group = document.querySelector('#panelProduccion .panel-chart-type-group');
    if (!group || group.dataset.bound === '1') return;
    group.dataset.bound = '1';
    group.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-chart-type]');
      if (!btn) return;
      const type = btn.dataset.chartType;
      if (!type || type === chartState.type) return;
      chartState.type = type;
      group.querySelectorAll('[data-chart-type]').forEach((el) => el.classList.toggle('is-active', el === btn));
      if (chartState.lastTop && chartState.lastTop.length) drawChart(chartState.lastTop, type);
    });
  };

  const renderAll = () => {
    renderSummary();
    renderChart();
    bindChartTypeToggle();
    renderLastReport();
    renderPendientes();
    renderGreeting();
    bindThumbs();
  };

  const applyData = (raw) => {
    state.reports = flattenReports(raw.reportsTree);
    state.report = state.reports[0] || null;
    state.usersMap = safeObject(raw.informesUsers);
    state.recipesById = safeObject(raw.recetas);
    state.providers = (Array.isArray(raw.inventario?.config?.providers) ? raw.inventario.config.providers : []).filter((p) => {
      const hasPendingRne = !normalize(p?.rne?.number);
      const isNonFoodCategory = Boolean(p?.nonFoodCategory);
      return hasPendingRne && !isNonFoodCategory;
    });
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
    nodes.informe.innerHTML = SKELETONS.informe;
    nodes.resumen.innerHTML = SKELETONS.resumen;
    nodes.pendientes.innerHTML = SKELETONS.pendientes;
    nodes.produccion.innerHTML = SKELETONS.produccion;
  };

  const loadOnce = async () => {
    if (!state.initialized) setLoading();
    try {
      const user = await window.laJamoneraReady;
      if (!state.userName) state.userName = normalize(user?.displayName);
      const readPreferred = async (primaryPath, fallbackPath, fallback = {}) => {
        const primary = await window.dbLaJamoneraRest.read(primaryPath).catch(() => null);
        if (primary != null) return primary;
        return window.dbLaJamoneraRest.read(fallbackPath).catch(() => fallback);
      };
      const [reportsTree, inventario, recetas, reparto, registros, informesUsers] = await Promise.all([
        readPreferred('/informes_index', '/informes', {}),
        readPreferred('/inventario_index', '/inventario', {}),
        readPreferred('/recetas_index/items', '/recetas', {}),
        readPreferred('/reparto_index', '/Reparto', {}),
        readPreferred('/produccion_index/registros', '/produccion/registros', {}),
        window.dbLaJamoneraRest.read('/informes/users')
      ]);
      applyData({ reportsTree, inventario, recetas, reparto, registros, informesUsers });
      renderAll();
      state.initialized = true;
      if (state.report && !normalize(state.report.html)) {
        try {
          const hydrated = await fetchLatestReportData(state.report);
          state.report = hydrated;
          const idx = (state.reports || []).findIndex((r) => r.id === hydrated.id);
          if (idx >= 0) state.reports[idx] = hydrated;
          renderLastReport();
        } catch (error) {
        }
      }
    } catch {
      const fallback = '<div class="panel-empty">No se pudieron cargar los datos del panel.</div>';
      [nodes.informe, nodes.resumen, nodes.pendientes, nodes.produccion].forEach((n) => { if (n) n.innerHTML = fallback; });
    }
  };

  const attachRealtimeListeners = () => {
    const db = window.dbLaJamonera;
    if (!db?.ref) return;
    const paths = ['/informes_index', '/inventario_index', '/recetas_index', '/reparto_index', '/produccion_index/registros', '/informes/users'];
    const seenInitialEvent = new Set();
    let refreshTimer = null;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => loadOnce(), 350);
    };
    paths.forEach((path) => {
      db.ref(path).on('value', () => {
        if (!seenInitialEvent.has(path)) {
          seenInitialEvent.add(path);
          return;
        }
        scheduleRefresh();
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
  renderGreeting();
  loadOnce().then(attachRealtimeListeners);
})();
