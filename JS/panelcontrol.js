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
    if (n <= 14) return { tone: 'ok', label: 'Excelente ✅' };
    if (n <= 28) return { tone: 'ok', label: 'Muy bueno ⭐' };
    if (n <= 42) return { tone: 'normal', label: 'Bueno 👍' };
    if (n <= 56) return { tone: 'normal', label: 'Normal 😐' };
    if (n <= 70) return { tone: 'warn', label: 'Atención ⚠️' };
    if (n <= 84) return { tone: 'high', label: 'Importante 🔔' };
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

  const spinner = (alt) => `<div class="panel-spinner-wrap"><sl-spinner class="panel-spinner" aria-label="${escapeHtml(alt)}"></sl-spinner></div>`;

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
      return `<span class="user-avatar-thumb panel-user-avatar"><span class="thumb-loading"><sl-spinner class="meta-spinner-login" aria-label="Cargando"></sl-spinner></span><img class="thumb-image js-panel-thumb" src="${escapeHtml(user.photoUrl)}" alt="${escapeHtml(user.name)}"></span>`;
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

  const openViewer = async (report) => {
    const user = getReportUser(report);
    const commentsCount = getCommentsCount(report);
    const attachments = Array.isArray(report.attachments) ? report.attachments : [];
    const importance = toneImportance(report.importance);
    const attachmentHtml = attachments.length
      ? attachments.map((item, index) => {
        if (item?.type === 'image') {
          return `<button type="button" class="lj-tile attachment-card" data-open-report-image="${index}"><span class="attachment-loader"><sl-spinner class="meta-spinner-login" aria-label="Cargando"></sl-spinner></span><img src="${escapeHtml(item.url || '')}" alt="${escapeHtml(item.name || 'Adjunto')}" class="attachment-image js-report-attachment-image"></button>`;
        }
        return `<a href="${escapeHtml(item?.url || '#')}" target="_blank" rel="noopener noreferrer" class="attachment-card attachment-doc"><sl-icon name="file-earmark"></sl-icon><span>${escapeHtml(item?.name || 'Documento')}</span></a>`;
      }).join('')
      : '<div class="informes-empty">Sin adjuntos</div>';
    const users = Object.values(state.usersMap || {}).sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || '')));
    const commentUserOptions = users.map((user) => `<sl-option value="${ljOptionValue(user.id || '')}">${escapeHtml(user.fullName || 'Usuario')}</sl-option>`).join('');
    const comments = getCommentList(report);
    const commentsHtml = comments.length
      ? `<div class="report-comments-thread">${renderCommentTree(comments)}</div>`
      : '<div class="informes-empty report-comments-empty">Sin comentarios todavía.</div>';

    await openIosSwal({
      title: 'Informe completo',
      width: 980,
      html: `<div class="report-viewer"><div class="report-viewer-meta"><p><strong>Creador:</strong> ${escapeHtml(user.name || '-')}</p><p><strong>Puesto:</strong> ${escapeHtml(user.position || '-')}</p><p><strong>Fecha:</strong> ${escapeHtml(getDateLabel(report.createdAt))}</p><p><strong>Última actualización:</strong> ${escapeHtml(getDateLabel(report.updatedAt || report.createdAt))}</p><div class="report-viewer-meta-actions"><sl-button variant="warning" type="button" class="report-resend-btn" data-resend-report-email="1"><i slot="prefix" class="fa-regular fa-paper-plane"></i>Reenviar email</sl-button></div></div><div class="report-viewer-content-wrap"><div class="report-viewer-content">${report.html || ''}</div></div><div class="attachments-grid">${attachmentHtml}</div><section class="report-comments-wrap"><div class="report-comments-head"><h6><i class="fa-regular fa-comments"></i> <span class="report-comments-title-text">Comentarios</span></h6></div><div class="report-inline-comment-form"><div class="report-inline-comment-reply d-none" id="inlineReplyLabel"></div><sl-select id="inlineCommentUser" class="mb-2" placeholder="Seleccioná un usuario" hoist>${commentUserOptions}</sl-select><sl-textarea id="inlineCommentText" class="swal2-textarea mb-2" resize="auto" placeholder="Escribí un comentario"></sl-textarea><sl-input id="inlineCommentPin" class="swal2-input mb-2" type="password" inputmode="numeric" maxlength="4" placeholder="Clave de 4 dígitos"></sl-input><div class="d-flex justify-content-end gap-2"><sl-button variant="default" type="button" class="d-none" id="inlineCancelReplyBtn">Cancelar respuesta</sl-button><sl-button variant="primary" type="button" id="inlineSendCommentBtn"><i slot="prefix" class="fa-solid fa-paper-plane"></i>Enviar comentario</sl-button></div></div><div id="reportCommentsBody">${commentsHtml}</div></section></div>`,
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
          const userId = normalize(ljSelectValue(popup.querySelector('#inlineCommentUser')));
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
          <sl-button variant="default" size="small" class="lj-icon-btn informe-print-chip" type="button" data-print-report="${escapeHtml(report.id)}" title="Imprimir informe" aria-label="Imprimir informe"><i class="fa-solid fa-print"></i></sl-button>
        </div>
        <div class="informe-card-user">
          ${renderUserAvatar(user)}
          <div class="informe-card-user-text"><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.position)}</small></div>
        </div>
        <div class="informe-card-actions">
          <sl-button variant="primary" type="button" data-view-report="${escapeHtml(report.id)}">Ver informe completo</sl-button>
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
    const cards = [
      { key: 'rne', icon: 'shield-exclamation', value: state.providers.length, title: 'RNE pendientes', note: 'proveedores sin completar', unit: 'proveedores' },
      { key: 'rnpa', icon: 'clipboard2-check', value: state.recipes.length, title: 'RNPA críticos', note: 'recetas a revisar', unit: 'recetas' },
      { key: 'transport', icon: 'truck-front', value: state.vehicles.length, title: 'UTA/URA', note: 'unidades por vencer', unit: 'unidades' },
      { key: 'reports', icon: 'file-earmark-medical', value: state.reports.length, title: 'Informes', note: 'registros disponibles', unit: 'cargados' }
    ];
    nodes.resumen.innerHTML = `<div class="panel-kpi-row">${cards.map((card) => `<article class="panel-metric panel-metric-${card.key}"><div class="panel-metric-top"><span class="panel-metric-icon"><sl-icon name="${card.icon}"></sl-icon></span><div class="panel-metric-copy"><strong>${escapeHtml(card.title)}</strong><small>${escapeHtml(card.note)}</small></div></div><div class="panel-metric-bottom"><span class="panel-metric-value">${card.value}</span><span class="panel-metric-unit">${escapeHtml(card.unit)}</span></div></article>`).join('')}</div>`;
  };

  const renderProviders = () => {
    const rows = state.providers.map((provider) => {
      const photo = normalize(provider.photoUrl);
      const avatar = photo
        ? `<div class="panel-avatar"><span class="thumb-loading"><sl-spinner class="panel-spinner" aria-label="cargando"></sl-spinner></span><img class="js-panel-thumb" src="${escapeHtml(photo)}" alt="${escapeHtml(provider.name)}"></div>`
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
        ? `<div class="panel-avatar"><span class="thumb-loading"><sl-spinner class="panel-spinner" aria-label="cargando"></sl-spinner></span><img class="js-panel-thumb" src="${escapeHtml(photo)}" alt="${escapeHtml(recipe.title)}"></div>`
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
    const grid = { left: isHorizontal ? 8 : (narrow ? 28 : 16), right: isHorizontal ? 48 : 16, top: 16, bottom: 8, containLabel: true };

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
      [nodes.informe, nodes.resumen, nodes.rne, nodes.rnpa, nodes.transporte, nodes.produccion].forEach((n) => { if (n) n.innerHTML = fallback; });
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
  loadOnce().then(attachRealtimeListeners);
})();
