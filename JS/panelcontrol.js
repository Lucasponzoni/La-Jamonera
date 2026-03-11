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
  const getDateLabel = formatDateTime;
  const getSwalTarget = () => document.body;
  const openIosSwal = (options) => Swal.fire({
    target: getSwalTarget(),
    ...options,
    customClass: {
      popup: `ios-alert informes-alert ${options?.customClass?.popup || ''}`.trim(),
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text',
      confirmButton: 'ios-btn ios-btn-primary',
      denyButton: 'ios-btn ios-btn-secondary',
      cancelButton: 'ios-btn ios-btn-secondary',
      ...options.customClass
    },
    buttonsStyling: false
  });

  const commentsList = (report) => {
    if (Array.isArray(report?.comments)) return report.comments;
    if (report?.comments && typeof report.comments === 'object') return Object.values(report.comments);
    return [];
  };

  const toneImportance = (value) => {
    const n = Math.max(0, Math.min(100, Number(value || 0)));
    if (n <= 14) return { tone: 'ok', label: 'Excelente 😄' };
    if (n <= 28) return { tone: 'ok', label: 'Muy bueno 🙂' };
    if (n <= 42) return { tone: 'normal', label: 'Bueno 😊' };
    if (n <= 56) return { tone: 'normal', label: 'Normal 😐' };
    if (n <= 70) return { tone: 'warn', label: 'Atención 😶' };
    if (n <= 84) return { tone: 'high', label: 'Importante ⚠️' };
    return { tone: 'critical', label: 'Muy importante 🚨' };
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

  const agoDaysLabel = (ts) => {
    const days = Math.floor((Date.now() - Number(ts || Date.now())) / 86400000);
    if (days === 0) return 'CREADO HOY';
    if (days === 1) return 'Hace <strong>1 día</strong>';
    if (days === -1) return 'Hace -<strong>1 día</strong>-';
    if (days < 0) return `Hace -${Math.abs(days)} días-`;
    return `Hace ${days} días`;
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

  const findReportById = (id) => (state.reports || []).find((item) => item.id === id);

  const makeMarquee = (rows, minToAnimate = 3, rowSeconds = 7) => {
    const animate = rows.length >= minToAnimate;
    const clone = animate ? rows.concat(rows) : rows;
    const duration = Math.max(18, rows.length * rowSeconds);
    return `<div class="panel-marquee ${animate ? 'is-animated-wrap' : ''}"><div class="panel-marquee-track ${animate ? 'is-animated' : ''}" style="--panel-marquee-duration:${duration}s;">${clone.join('')}</div></div>`;
  };

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
      return `<span class="user-avatar-thumb panel-user-avatar"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-panel-thumb" src="${escapeHtml(user.photoUrl)}" alt="${escapeHtml(user.name)}"></span>`;
    }
    return `<span class="user-avatar-thumb">${escapeHtml(initials(user.name))}</span>`;
  };

  const bindThumbs = () => {
    document.querySelectorAll('.js-panel-thumb').forEach((img) => {
      const stopThumbLoading = () => {
        img.classList.add('is-loaded');
        img.closest('.user-avatar-thumb, .panel-avatar, .panel-chart-avatar')?.querySelector('.thumb-loading')?.classList.add('d-none');
      };
      img.addEventListener('load', stopThumbLoading, { once: true });
      img.addEventListener('error', () => {
        stopThumbLoading();
        img.closest('.panel-user-avatar')?.classList.add('is-fallback');
      }, { once: true });
      if (img.complete) stopThumbLoading();
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
    <article class="report-comment-item ${level > 0 ? 'is-reply' : ''}" data-comment-id="${escapeHtml(comment.id || '')}">
      <header class="report-comment-head"><strong>${escapeHtml(comment.userName || 'Usuario')}</strong><small>${escapeHtml(getDateLabel(comment.createdAt))}</small></header>
      <p class="report-comment-text">${escapeHtml(comment.text || '').replaceAll('\n', '<br>')}</p>
      <div class="report-comment-actions"><button type="button" class="btn report-comment-reply-btn" data-reply-comment="${escapeHtml(comment.id || '')}">Responder</button></div>
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
        <img
          src="./IMG/Meta-ai-logo.webp"
          alt="Procesando"
          class="meta-spinner-login"
        >
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
      confirmButton: 'ios-btn ios-btn-success',
      denyButton: 'ios-btn ios-btn-danger ios-btn-deny-critical',
      cancelButton: 'ios-btn ios-btn-secondary'
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
    const usersHtml = usersWithEmail.length ? usersWithEmail.map((user) => `<label class="notify-user-card"><div class="notify-user-main">${renderUserAvatar(user)}<div class="notify-user-text"><strong>${escapeHtml(user.fullName || 'Usuario')}</strong><small>${escapeHtml(user.email || '')}</small></div></div><input type="checkbox" data-resend-user-email="${escapeHtml(user.email || '')}" data-resend-user-name="${escapeHtml(user.fullName || '')}"></label>`).join('') : '<div class="informes-empty">No hay usuarios con email cargado.</div>';
    const response = await openIosSwal({ title: 'Reenviar informe por email', width: 760, showCancelButton: true, confirmButtonText: 'Reenviar', cancelButtonText: 'Cancelar', html: `<div class="text-start report-resend-wrap"><p class="mb-2">Seleccioná usuarios del listado o escribí emails nuevos (separados por coma).</p><div id="resendUsersList" class="notify-specific-users-list">${usersHtml}</div><label class="form-label mt-3" for="resendExtraEmails">Emails adicionales</label><textarea id="resendExtraEmails" class="swal2-textarea ios-input" placeholder="ejemplo@dominio.com, otro@dominio.com"></textarea></div>`, didOpen: bindThumbs, preConfirm: () => {
      const selectedNodes = Array.from(document.querySelectorAll('[data-resend-user-email]:checked'));
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
      await window.laJamoneraEmailSender.sendEmail('La Jamonera', `Reenvío de informe bromatológico · ${latestReport.userName || 'La Jamonera'}`, emailHtml, target.name || target.email, target.email);
    }
    window.laJamoneraNotify?.show({ type: 'success', title: 'Emails enviados', message: 'El informe se reenvió correctamente.' });
  };

  const getCommentsCount = (report) => commentsList(report).length;

  const verifyReportCreatorPin = async (report) => {
    const user = safeObject(state.usersMap[report?.userId]);
    if (!user?.pin) return true;
    const result = await openIosSwal({
      title: 'Clave de usuario',
      html: '<input id="panelCreatorPin" class="swal2-input ios-input" type="password" inputmode="numeric" maxlength="4" placeholder="Clave de 4 dígitos">',
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

  const openViewer = async (report) => {
    const user = getReportUser(report);
    const commentsCount = getCommentsCount(report);
    const attachments = Array.isArray(report.attachments) ? report.attachments : [];
    const importance = toneImportance(report.importance);
    const attachmentHtml = attachments.length
      ? attachments.map((item, index) => {
        if (item?.type === 'image') {
          return `<button type="button" class="attachment-card" data-open-report-image="${index}"><span class="attachment-loader"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando" class="meta-spinner-login"></span><img src="${escapeHtml(item.url || '')}" alt="${escapeHtml(item.name || 'Adjunto')}" class="attachment-image js-report-attachment-image"></button>`;
        }
        return `<a href="${escapeHtml(item?.url || '#')}" target="_blank" rel="noopener noreferrer" class="attachment-card attachment-doc"><i class="bi bi-file-earmark"></i><span>${escapeHtml(item?.name || 'Documento')}</span></a>`;
      }).join('')
      : '<div class="informes-empty">Sin adjuntos</div>';
    const users = Object.values(state.usersMap || {}).sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || '')));
    const commentUserOptions = ['<option value="">Seleccioná un usuario</option>', ...users.map((user) => `<option value="${escapeHtml(user.id || '')}">${escapeHtml(user.fullName || 'Usuario')}</option>`)].join('');
    const comments = getCommentList(report);
    const commentsHtml = comments.length
      ? `<div class="report-comments-thread">${renderCommentTree(comments)}</div>`
      : '<div class="informes-empty report-comments-empty">Sin comentarios todavía.</div>';

    await openIosSwal({
      title: 'Informe completo',
      width: 980,
      html: `<div class="report-viewer"><div class="report-viewer-meta"><p><strong>Creador:</strong> ${escapeHtml(user.name || '-')}</p><p><strong>Puesto:</strong> ${escapeHtml(user.position || '-')}</p><p><strong>Fecha:</strong> ${escapeHtml(getDateLabel(report.createdAt))}</p><p><strong>Última actualización:</strong> ${escapeHtml(getDateLabel(report.updatedAt || report.createdAt))}</p><div class="report-viewer-meta-actions"><button type="button" class="btn ios-btn ios-btn-warning report-resend-btn" data-resend-report-email="1"><i class="fa-regular fa-paper-plane"></i><span>Reenviar email</span></button></div></div><div class="report-viewer-content-wrap"><div class="report-viewer-content">${report.html || ''}</div></div><div class="attachments-grid">${attachmentHtml}</div><section class="report-comments-wrap"><div class="report-comments-head"><h6><i class="fa-regular fa-comments"></i> <span class="report-comments-title-text">Comentarios</span></h6></div><div class="report-inline-comment-form"><div class="report-inline-comment-reply d-none" id="inlineReplyLabel"></div><select id="inlineCommentUser" class="form-select ios-input mb-2">${commentUserOptions}</select><textarea id="inlineCommentText" class="swal2-textarea ios-input" placeholder="Escribí un comentario"></textarea><input id="inlineCommentPin" class="swal2-input ios-input" type="password" inputmode="numeric" maxlength="4" placeholder="Clave de 4 dígitos"><div class="d-flex justify-content-end gap-2"><button type="button" class="btn ios-btn ios-btn-secondary d-none" id="inlineCancelReplyBtn">Cancelar respuesta</button><button type="button" class="btn ios-btn ios-btn-primary" id="inlineSendCommentBtn"><i class="fa-solid fa-paper-plane"></i><span>Enviar comentario</span></button></div></div><div id="reportCommentsBody">${commentsHtml}</div></section></div>`,
      customClass: { popup: 'panel-report-alert' },
      confirmButtonText: 'Cerrar',
      didOpen: (popup) => {
        bindThumbs();
        let replyToId = '';
        const commentsBody = popup.querySelector('#reportCommentsBody');
        const replyLabel = popup.querySelector('#inlineReplyLabel');
        const cancelReplyBtn = popup.querySelector('#inlineCancelReplyBtn');
        const sendBtn = popup.querySelector('#inlineSendCommentBtn');

        popup.querySelectorAll('.attachment-card[data-open-report-image]').forEach((node) => {
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

        popup.querySelector('[data-resend-report-email]')?.addEventListener('click', async () => {
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
          const userId = normalize(popup.querySelector('#inlineCommentUser')?.value);
          const text = normalize(popup.querySelector('#inlineCommentText')?.value);
          const pin = normalize(popup.querySelector('#inlineCommentPin')?.value);
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
          popup.querySelector('#inlineCommentText').value = '';
          popup.querySelector('#inlineCommentPin').value = '';
          replyToId = '';
          replyLabel.classList.add('d-none');
          cancelReplyBtn.classList.add('d-none');
          await loadOnce();
        });
      }
    });
  };

  const promptComment = async (report) => {
    const users = Object.values(state.usersMap || {}).sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || '')));
    const options = ['<option value="">Seleccioná un usuario</option>', ...users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.fullName || 'Usuario')}</option>`)].join('');
    const result = await openIosSwal({
      title: 'Agregar comentario',
      html: `<select id="panelCommentUser" class="form-select ios-input mb-2">${options}</select><textarea id="panelCommentText" class="swal2-textarea ios-input" maxlength="500" placeholder="Escribí un comentario"></textarea><input id="panelCommentPin" class="swal2-input ios-input" type="password" inputmode="numeric" maxlength="4" placeholder="Clave de 4 dígitos">`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => ({
        userId: normalize(document.getElementById('panelCommentUser')?.value),
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
      html: `<textarea id="panelEditReportHtml" class="swal2-textarea ios-input" style="min-height:220px;">${(report.html || '').replace(/<[^>]+>/g, '')}</textarea>`,
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

  const renderLastReport = () => {
    const report = state.report;
    if (!report) {
      nodes.informeAgo.classList.add('d-none');
      nodes.informe.innerHTML = '<div class="panel-empty">Todavía no hay informes cargados.</div>';
      return;
    }

    const user = getReportUser(report);
    const commentsCount = commentsList(report).length;
    const attachments = Array.isArray(report.attachments) ? report.attachments : [];
    const importance = toneImportance(report.importance);

    nodes.informeAgo.classList.remove('d-none');
    nodes.informeAgo.textContent = ago(report.createdAt);

    nodes.informe.innerHTML = `
      <article class="informe-card" data-report-id="${escapeHtml(report.id)}">
        <div class="informe-card-head">
          <span class="informe-card-date"><i class="fa-regular fa-calendar"></i> ${escapeHtml(formatDateTime(report.createdAt))}</span>
          <span class="informe-card-comments ${commentsCount ? 'has-comments' : 'no-comments'}"><i class="fa-solid ${commentsCount ? 'fa-comment-dots' : 'fa-comment-slash'}"></i> ${commentsCount ? `${commentsCount} comentario(s)` : 'Sin comentarios'}</span>
        </div>
        <div class="informe-card-preview">${report.html || '<p>Sin contenido.</p>'}</div>
        <div class="informe-card-meta">
          <span class="informe-attach-chip"><i class="fa-regular fa-image"></i> ${attachments.filter((x) => x?.type === 'image').length}</span>
          <span class="informe-attach-chip"><i class="fa-regular fa-file-lines"></i> ${Math.max(0, attachments.length - attachments.filter((x) => x?.type === 'image').length)}</span>
          <span class="importance-chip importance-${importance.tone}">${Math.max(0, Math.min(100, Number(report.importance || 0)))}% · ${importance.label}</span>
          <span class="informe-attach-chip panel-report-age-chip"><i class="fa-regular fa-clock"></i> ${agoDaysLabel(report.createdAt)}</span>
          <button class="btn informe-print-chip" type="button" data-print-report="${escapeHtml(report.id)}" title="Imprimir informe"><i class="fa-solid fa-print"></i></button>
        </div>
        <div class="informe-card-user">
          ${renderUserAvatar(user)}
          <div class="informe-card-user-text"><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.position)}</small></div>
        </div>
        <div class="informe-card-actions">
          <button class="btn ios-btn ios-btn-primary" type="button" data-view-report="${escapeHtml(report.id)}">Ver informe completo</button>
        </div>
      </article>`;

    bindThumbs();
    const card = nodes.informe.querySelector('.informe-card');
    card?.addEventListener('click', async (event) => {
      if (event.target.closest('[data-print-report]')) {
        await printReport(report);
        return;
      }
      if (event.target.closest('[data-view-report]')) {
        await openViewer(report);
        return;
      }
      if (event.target.closest('[data-edit-report]')) {
        await promptEdit(report);
        return;
      }
      if (event.target.closest('[data-delete-report]')) {
        await deleteReport(report);
        return;
      }
      if (event.target.closest('[data-comment-report]')) {
        await promptComment(report);
      }
    });
  };

  const renderSummary = () => {
    nodes.resumen.innerHTML = `<div class="panel-kpi-row"><div class="panel-metric panel-metric-rne"><strong>${state.providers.length}</strong><span><i class="fa-solid fa-file-shield"></i> RNE pendientes</span></div><div class="panel-metric panel-metric-rnpa"><strong>${state.recipes.length}</strong><span><i class="fa-solid fa-clipboard-check"></i> RNPA críticos</span></div><div class="panel-metric panel-metric-transport"><strong>${state.vehicles.length}</strong><span><i class="fa-solid fa-id-card-clip"></i> UTA/URA con alerta</span></div><div class="panel-metric panel-metric-reports"><strong>${state.reports.length}</strong><span><i class="fa-solid fa-file-waveform"></i> Informes cargados</span></div></div>`;
  };

  const renderProviders = () => {
    const rows = state.providers.map((provider) => {
      const photo = normalize(provider.photoUrl);
      const avatar = photo
        ? `<div class="panel-avatar"><span class="thumb-loading"><img src="./IMG/Meta-ai-logo.webp" class="panel-spinner" alt="cargando"></span><img class="js-panel-thumb" src="${escapeHtml(photo)}" alt="${escapeHtml(provider.name)}"></div>`
        : `<div class="panel-avatar">${escapeHtml(initials(provider.name))}</div>`;
      return `<article class="panel-list-card">${avatar}<div class="panel-item-text"><strong>${escapeHtml(provider.name || 'Proveedor')}</strong><small><i class="fa-solid fa-triangle-exclamation"></i> RNE pendiente</small><p class="panel-status is-danger">Completar registro del proveedor</p></div></article>`;
    });
    if (!rows.length) { nodes.rne.innerHTML = '<div class="panel-empty">No hay alertas para mostrar.</div>'; return; }
    nodes.rne.innerHTML = makeMarquee(rows, 3, 7);
  };

  const renderRnpa = () => {
    const rows = state.recipes.map((recipe) => {
      const days = dayDiff(recipe.rnpa?.expiryDate);
      const expired = Number(days) < 0;
      const photo = normalize(recipe.imageUrl);
      const avatar = photo
        ? `<div class="panel-avatar"><span class="thumb-loading"><img src="./IMG/Meta-ai-logo.webp" class="panel-spinner" alt="cargando"></span><img class="js-panel-thumb" src="${escapeHtml(photo)}" alt="${escapeHtml(recipe.title)}"></div>`
        : `<div class="panel-avatar">${escapeHtml(initials(recipe.title))}</div>`;
      return `<article class="panel-list-card">${avatar}<div class="panel-item-text"><strong>${escapeHtml(recipe.title || 'Receta')}</strong><small><i class="fa-regular fa-calendar"></i> Vence: ${escapeHtml(recipe.rnpa?.expiryDate || '-')}</small><p class="panel-status ${expired ? 'is-danger' : 'is-warning'}">${expired ? `Venció hace ${Math.abs(days)} día(s)` : `Vence en ${days} día(s)`}</p></div></article>`;
    });
    if (!rows.length) { nodes.rnpa.innerHTML = '<div class="panel-empty">No hay alertas para mostrar.</div>'; return; }
    nodes.rnpa.innerHTML = makeMarquee(rows, 3, 7);
  };

  const renderTransport = () => {
    const rows = state.vehicles.map((vehicle) => {
      const days = dayDiff(vehicle.expiryDate);
      return `<article class="panel-list-card"><div class="panel-avatar"><i class="fa-solid fa-id-card-clip"></i></div><div class="panel-item-text"><strong>${escapeHtml(vehicle.number || '-')} · ${escapeHtml(vehicle.patent || '-')}</strong><small>${escapeHtml(vehicle.brand || vehicle.type || 'Unidad')} · ${escapeHtml(vehicle.expiryDate || '-')}</small><p class="panel-status ${days < 0 ? 'is-danger' : 'is-warning'}">${days < 0 ? `Vencido hace ${Math.abs(days)} día(s)` : `Vence en ${days} día(s)`}</p></div></article>`;
    });
    if (!rows.length) { nodes.transporte.innerHTML = '<div class="panel-empty">No hay alertas para mostrar.</div>'; return; }
    nodes.transporte.innerHTML = makeMarquee(rows, 3, 7);
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
      if (!map[key]) map[key] = { id: normalize(item.recipeId), name: normalize(item.recipeTitle || item.recipeName || item.recipeId || 'Sin nombre'), kg: 0, imageUrl: normalize(item.recipeImageUrl) };
      map[key].kg = Number((Number(map[key].kg || 0) + Number(item.quantityKg || 0)).toFixed(2));
    });

    const top = Object.values(map).map((item) => {
      const recipe = safeObject(state.recipesById[item.id]);
      if (!item.imageUrl && normalize(recipe.imageUrl)) item.imageUrl = normalize(recipe.imageUrl);
      return item;
    }).sort((a, b) => b.kg - a.kg).slice(0, 10);

    if (!top.length) { nodes.produccion.innerHTML = '<div class="panel-empty">No hay producción en el rango seleccionado.</div>'; return; }

    const max = Math.max(...top.map((x) => x.kg));
    nodes.produccion.innerHTML = `<div class="panel-chart-wrap">${top.map((item, index) => {
      const avatar = item.imageUrl
        ? `<span class="panel-chart-avatar"><span class="thumb-loading"><img src="./IMG/Meta-ai-logo.webp" class="panel-spinner" alt="cargando"></span><img class="js-panel-thumb" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}"></span>`
        : `<span class="panel-chart-avatar">${escapeHtml(initials(item.name))}</span>`;
      return `<div class="panel-chart-row"><div class="panel-chart-rank">${index + 1}</div><div class="panel-chart-label">${avatar}<span>${escapeHtml(item.name)}</span></div><div class="panel-chart-bar"><div class="panel-chart-fill" style="width:${Math.max(10, (item.kg / max) * 100)}%"></div></div><div class="panel-chart-value">${item.kg.toFixed(2)} kg</div></div>`;
    }).join('')}</div>`;
  };

  const renderAll = () => {
    renderSummary();
    renderChart();
    renderLastReport();
    renderProviders();
    renderRnpa();
    renderTransport();
    bindThumbs();
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
    } catch {
      const fallback = '<div class="panel-empty">No se pudieron cargar los datos del panel.</div>';
      [nodes.informe, nodes.resumen, nodes.rne, nodes.rnpa, nodes.transporte, nodes.produccion].forEach((n) => { if (n) n.innerHTML = fallback; });
    }
  };

  const attachRealtimeListeners = () => {
    const db = window.dbLaJamonera;
    if (!db?.ref) return;
    ['/informes', '/inventario', '/recetas', '/Reparto', '/produccion/registros', '/informes/users'].forEach((path) => db.ref(path).on('value', () => loadOnce()));
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
