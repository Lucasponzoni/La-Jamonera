(function informesModule() {
  const informesModal = document.getElementById('informesModal');
  if (!informesModal) {
    return;
  }

  const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
  const DRAFT_KEY = 'laJamoneraInformeDraft';
  const USER_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  const informesLoading = document.getElementById('informesLoading');
  const informesData = document.getElementById('informesData');
  const openUserFormBtn = document.getElementById('openUserFormBtn');
  const informesUsersList = document.getElementById('informesUsersList');
  const informeDateInput = document.getElementById('informeDateInput');
  const informeUserSelect = document.getElementById('informeUserSelect');
  const informeEditor = document.getElementById('informeEditor');
  const fontSizeSelect = document.getElementById('fontSizeSelect');
  const formatBlockSelect = document.getElementById('formatBlockSelect');
  const textColorInput = document.getElementById('textColorInput');
  const highlightColorInput = document.getElementById('highlightColorInput');
  const applyHighlightBtn = document.getElementById('applyHighlightBtn');
  const toggleEmojiPanel = document.getElementById('toggleEmojiPanel');
  const emojiPanel = document.getElementById('emojiPanel');
  const informePreview = document.getElementById('informePreview');
  const attachFilesBtn = document.getElementById('attachFilesBtn');
  const attachmentsInput = document.getElementById('attachmentsInput');
  const attachmentsGrid = document.getElementById('attachmentsGrid');
  const saveInformeBtn = document.getElementById('saveInformeBtn');
  const clearInformeBtn = document.getElementById('clearInformeBtn');
  const importanceRange = document.getElementById('importanceRange');
  const importanceLabel = document.getElementById('importanceLabel');
  const informesBoardLoading = document.getElementById('informesBoardLoading');
  const informesBoardEmpty = document.getElementById('informesBoardEmpty');
  const informesCardsGrid = document.getElementById('informesCardsGrid');
  const informesPagination = document.getElementById('informesPagination');
  const openFilterInformesBtn = document.getElementById('openFilterInformesBtn');
  const clearFilterInformesBtn = document.getElementById('clearFilterInformesBtn');
  const informesFilterInput = document.getElementById('informesFilterInput');

  const imageViewerModalEl = document.getElementById('imageViewerModal');
  const viewerImage = document.getElementById('viewerImage');
  const viewerPrevBtn = document.getElementById('viewerPrevBtn');
  const viewerNextBtn = document.getElementById('viewerNextBtn');
  const viewerZoomInBtn = document.getElementById('viewerZoomInBtn');
  const viewerZoomOutBtn = document.getElementById('viewerZoomOutBtn');

  const state = {
    users: {},
    attachments: [],
    imageViewerIndex: 0,
    viewerScale: 1,
    reportsByDate: {},
    reports: [],
    filteredReports: [],
    reportDayCount: {},
    activeRange: null,
    currentPage: 1,
    viewerImages: [],
    reportsLoaded: false,
    reopenViewerReportId: ''
  };

  let datePicker = null;
  let imageViewerModal = null;
  let reportsFilterPicker = null;
  const REPORTS_PER_PAGE = 9;
  let initialLoadPromise = null;

  const ensureImageViewerModal = () => {
    if (!imageViewerModal && window.bootstrap && imageViewerModalEl) {
      imageViewerModal = new bootstrap.Modal(imageViewerModalEl);
    }
  };

  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const getSwalTarget = () => (informesModal && informesModal.classList.contains('show') ? informesModal : document.body);

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

  const initialsFromName = (fullName) => {
    const parts = normalizeValue(fullName).split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    const initial = parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
    return initial || '';
  };

  const showState = (key) => {
    informesLoading.classList.toggle('d-none', key !== 'loading');
    informesData.classList.toggle('d-none', key !== 'data');
    if (key !== 'data') {
      informesData.classList.remove('has-scroll-hint');
    }
  };

  const getDateParts = (date) => {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return { year, month, day };
  };

  const getCurrentDate = () => {
    if (datePicker && datePicker.selectedDates && datePicker.selectedDates[0]) {
      return datePicker.selectedDates[0];
    }
    return new Date();
  };

  const getFileCategory = (file) => file.type.startsWith('image/') ? 'image' : 'doc';

  const fileIcon = (file) => {
    const name = normalizeLower(file.name);
    if (name.endsWith('.pdf')) return 'bi-file-earmark-pdf';
    if (name.endsWith('.doc') || name.endsWith('.docx')) return 'bi-file-earmark-word';
    if (name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.csv')) return 'bi-file-earmark-excel';
    return 'bi-file-earmark-text';
  };

  const renderUserAvatar = (user) => {
    if (user.photoUrl) {
      return `<span class="user-avatar-thumb"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-user-photo" src="${user.photoUrl}" alt="${user.fullName}"></span>`;
    }
    const initials = initialsFromName(user.fullName);
    return `<span class="user-avatar-thumb user-avatar-initials">${initials || '<i class=\"bi bi-person-fill\"></i>'}</span>`;
  };

  const prepareThumbLoaders = (selector) => {
    const nodes = Array.from(document.querySelectorAll(selector));
    nodes.forEach((img) => {
      const parent = img.closest('.user-avatar-thumb');
      const spinner = parent ? parent.querySelector('.thumb-loading') : null;
      const done = () => {
        img.classList.add('is-loaded');
        if (spinner) spinner.remove();
      };
      if (img.complete) {
        done();
      } else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', () => {
          if (spinner) spinner.remove();
        }, { once: true });
      }
    });
  };

  const toggleScrollHint = (element) => {
    if (!element) {
      return;
    }

    if (element === informesUsersList) {
      const hasOverflow = element.scrollWidth > element.clientWidth + 4;
      const nearEnd = element.scrollLeft + element.clientWidth >= element.scrollWidth - 6;
      element.classList.toggle('has-scroll-hint', hasOverflow && !nearEnd);
      return;
    }

    const hasOverflow = element.scrollHeight > element.clientHeight + 4;
    const nearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 6;
    element.classList.toggle('has-scroll-hint', hasOverflow && !nearBottom);
  };

  const updateMainScrollHint = () => {
    toggleScrollHint(informesUsersList);
  };

  const getDateLabel = (value) => {
    const date = new Date(value || Date.now());
    return date.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const countCommentEntries = (comment) => {
    const replies = Array.isArray(comment?.replies) ? comment.replies : [];
    return 1 + replies.reduce((acc, item) => acc + countCommentEntries(item), 0);
  };

  const getCommentsCount = (report) => {
    const comments = sortComments(getCommentList(report));
    return comments.reduce((acc, item) => acc + countCommentEntries(item), 0);
  };

  const normalizeImportance = (value, fallback = 50) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(100, Math.max(0, Math.round(numeric)));
  };

  const IMPORTANCE_LEVELS = [
    { max: 14, label: 'Excelente 😄', tone: 'ok' },
    { max: 28, label: 'Muy bueno 🙂', tone: 'ok' },
    { max: 42, label: 'Bueno 😊', tone: 'normal' },
    { max: 56, label: 'Normal 😐', tone: 'normal' },
    { max: 70, label: 'Atención 😶', tone: 'warn' },
    { max: 84, label: 'Importante ⚠️', tone: 'high' },
    { max: 100, label: 'Muy importante 🚨', tone: 'critical' }
  ];

  const getImportanceMeta = (importanceValue) => {
    const value = normalizeImportance(importanceValue, 50);
    return IMPORTANCE_LEVELS.find((item) => value <= item.max) || IMPORTANCE_LEVELS[IMPORTANCE_LEVELS.length - 1];
  };

  const getReportPath = (report) => `/informes/${report.year}/${report.month}/${report.day}/${report.id}`;

  const sanitizeHtmlForPdfMake = (rawHtml) => {
    const source = String(rawHtml || '').trim();
    if (!source) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${source}</div>`, 'text/html');
    const root = doc.body.firstElementChild || doc.body;

    root.querySelectorAll('img').forEach((img) => {
      const url = normalizeValue(img.getAttribute('src'));
      const alt = normalizeValue(img.getAttribute('alt')) || 'Imagen';
      const replacement = doc.createElement('p');
      replacement.innerHTML = `<strong>${escapeHtml(alt)}</strong><br><small>Imagen externa omitida del PDF por restricción CORS.</small>${url ? `<br><small>${escapeHtml(url)}</small>` : ''}`;
      img.replaceWith(replacement);
    });

    return root.innerHTML;
  };

  const buildPdfDefinition = (report) => {
    const attachments = Array.isArray(report?.attachments) ? report.attachments : [];
    const images = attachments.filter((item) => item.type === 'image' && item.url);
    const docs = attachments.filter((item) => item.type !== 'image' && item.url);
    const safeHtml = normalizeHtmlForPdf(report.html || '');

    const safeHtml = sanitizeHtmlForPdfMake(report.html || '');
    const htmlContent = window.htmlToPdfmake
      ? window.htmlToPdfmake(safeHtml || '<p>Sin contenido</p>', { window })
      : [{ text: safeHtml || 'Sin contenido' }];

    return {
      pageSize: 'A4',
      pageMargins: [28, 24, 28, 24],
      defaultStyle: { fontSize: 11 },
      content: [
        { text: 'Informe bromatológico', style: 'title' },
        { text: `Usuario: ${report.userName || '-'}`, margin: [0, 2, 0, 0] },
        { text: `Puesto: ${report.userPosition || '-'}`, margin: [0, 2, 0, 0] },
        { text: `Fecha: ${getDateLabel(report.createdAt)}`, margin: [0, 2, 0, 10] },
        { text: 'Contenido', style: 'sectionTitle' },
        ...(Array.isArray(htmlContent) ? htmlContent : [htmlContent]),
        { text: 'Imágenes adjuntas', style: 'sectionTitle', margin: [0, 14, 0, 6] },
        images.length
          ? { ul: images.map((item) => ({ text: `${item.name || 'Imagen'} - ${item.url}`, link: item.url, color: '#1d4ed8' })) }
          : { text: 'Sin imágenes adjuntas.', color: '#5a6482' },
        { text: 'Otros adjuntos', style: 'sectionTitle', margin: [0, 14, 0, 6] },
        docs.length
          ? { ul: docs.map((item) => ({ text: `${item.name || 'Archivo'}${item.url ? ` - ${item.url}` : ''}`, link: item.url || undefined, color: item.url ? '#1d4ed8' : '#1f2a44' })) }
          : { text: 'Sin archivos adjuntos.', color: '#5a6482' }
      ],
      styles: {
        title: { fontSize: 18, bold: true },
        sectionTitle: { fontSize: 13, bold: true }
      }
    };
  };

  const openProcessingAlert = (message) => {
    Swal.fire({
      target: getSwalTarget(),
      title: 'Procesando informe',
      html: `<div class="d-flex flex-column align-items-center gap-2"><img src="./IMG/Meta-ai-logo.webp" alt="Procesando" class="meta-spinner-login"><p class="mb-0">${escapeHtml(message)}</p></div>`,
      allowEscapeKey: false,
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: {
        popup: 'ios-alert informes-alert informes-saving-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text'
      },
      buttonsStyling: false
    });
  };

  const fetchLatestReportData = async (report) => {
    await window.laJamoneraReady;
    const path = getReportPath(report);
    const latest = await window.dbLaJamoneraRest.read(path);
    const latestHtml = await window.dbLaJamoneraRest.read(`${path}/html`);
    if (!latest || typeof latest !== 'object') {
      return {
        ...report,
        html: typeof latestHtml === 'string' ? latestHtml : report.html
      };
    }
    return {
      ...report,
      ...latest,
      html: typeof latestHtml === 'string' ? latestHtml : latest.html,
      id: latest.id || report.id,
      year: report.year,
      month: report.month,
      day: report.day
    };
  };

  const buildReportPdfBlob = async (report) => {
    if (!window.pdfMake || !window.htmlToPdfmake) {
      throw new Error('pdf_lib_unavailable');
    }

    const docDefinition = buildPdfDefinition(report);
    return await new Promise((resolve, reject) => {
      try {
        window.pdfMake.createPdf(docDefinition).getBlob((blob) => resolve(blob));
      } catch (error) {
        reject(error);
      }
    });
  };

  const downloadPdfBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const printPdfBlob = async (blob) => new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
    frame.src = url;
    document.body.appendChild(frame);

    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch (error) {
      }

      setTimeout(() => {
        URL.revokeObjectURL(url);
        frame.remove();
        resolve();
      }, 2500);
    };
  });

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

    if (!choice.isConfirmed && !choice.isDenied) {
      return;
    }

    try {
      openProcessingAlert(choice.isConfirmed ? 'Leyendo informe desde Firebase y preparando PDF...' : 'Leyendo informe desde Firebase y generando PDF...');
      const latestReport = await fetchLatestReportData(report);
      if (!normalizeValue(latestReport.html || '')) {
        throw new Error('empty_report_html');
      }

      const blob = await buildReportPdfBlob(latestReport);
      const filename = `informe_${latestReport.id || Date.now()}.pdf`;

      if (choice.isConfirmed) {
        await printPdfBlob(blob);
      } else {
        downloadPdfBlob(blob, filename);
      }
    } catch (error) {
      let message = '<p>No se pudo generar el PDF del informe.</p>';
      if (error?.message === 'pdf_lib_unavailable') {
        message = '<p>No pudimos cargar la librería PDF (pdfmake/html-to-pdfmake). Reintentá en unos segundos.</p>';
      }
      if (error?.message === 'empty_report_html') {
        message = '<p>El informe no tiene contenido HTML para imprimir. Verificá que esté guardado correctamente en Firebase.</p>';
      }
      await openIosSwal({ title: 'Error al generar PDF', html: message, icon: 'error', confirmButtonText: 'Entendido' });
    } finally {
      Swal.close();
    }
  };

  const getImportanceValue = () => {
    if (!importanceRange) return 50;
    return normalizeImportance(importanceRange.value, 50);
  };

  const getCommentList = (report) => {
    const comments = report?.comments;
    if (!comments) return [];
    if (Array.isArray(comments)) return comments;
    if (typeof comments === 'object') return Object.values(comments);
    return [];
  };

  const sortComments = (comments) => [...comments].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

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

  const setCollapsedSelection = (node, offset = 0) => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const createPlainWrapper = (text = '​') => {
    const span = document.createElement('span');
    span.className = 'editor-plain-text';
    span.textContent = text || '​';
    return span;
  };

  const placeCaretOutsideFormatting = (node) => {
    if (!node) return;
    const styledTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'MARK', 'FONT', 'SPAN']);
    let cursor = node.parentElement;
    let styledAncestor = null;

    while (cursor && cursor !== informeEditor) {
      const hasInlineStyle = Boolean(cursor.getAttribute('style'));
      if (styledTags.has(cursor.tagName) || hasInlineStyle) {
        styledAncestor = cursor;
      }
      cursor = cursor.parentElement;
    }

    if (!styledAncestor || !styledAncestor.parentNode) {
      return;
    }

    const spacer = createPlainWrapper();
    styledAncestor.parentNode.insertBefore(spacer, styledAncestor.nextSibling);
    setCollapsedSelection(spacer.firstChild, spacer.firstChild.length);
  };

  const ensurePlainTypingContext = () => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!range.collapsed || !informeEditor.contains(range.startContainer)) {
      return;
    }

    const plain = createPlainWrapper();
    range.insertNode(plain);
    setCollapsedSelection(plain.firstChild, plain.firstChild.length);
    placeCaretOutsideFormatting(plain);
  };

  const renderUsers = () => {
    const users = Object.values(state.users).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));

    if (!users.length) {
      informesUsersList.innerHTML = '<div class="informes-empty">No hay usuarios cargados.</div>';
      informesUsersList.classList.remove('has-scroll-hint');
      renderUserSelect();
      return;
    }

    informesUsersList.innerHTML = users.map((user) => `
      <div class="informe-user-circle-wrap">
        <article class="informe-user-circle" data-user-id="${user.id}">
          ${renderUserAvatar(user)}
          <div class="informe-user-main">
            <h6>${user.fullName}</h6>
            <p>${user.position}</p><small class="email-user">${user.email || ""}</small>
          </div>
        </article>
        <div class="informe-user-actions">
          <button class="family-manage-btn" type="button" data-user-edit="${user.id}" title="Editar usuario"><i class="fa-solid fa-pen"></i></button>
          <button class="family-manage-btn" type="button" data-user-delete="${user.id}" title="Eliminar usuario"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join('');

    renderUserSelect();
    prepareThumbLoaders('.js-user-photo');
    toggleScrollHint(informesUsersList);
  };

  const renderUserSelect = () => {
    const users = Object.values(state.users).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
    const current = informeUserSelect.value;

    const options = users.map((user) => `<option value="${user.id}">${user.fullName} (${user.position})</option>`).join('');
    informeUserSelect.innerHTML = `<option value="">Seleccioná un usuario</option>${options}<option value="create">Crear nuevo usuario</option>`;

    if (current && state.users[current]) {
      informeUserSelect.value = current;
    }
  };

  const renderAttachments = () => {
    if (!state.attachments.length) {
      attachmentsGrid.innerHTML = '<div class="informes-empty">No hay archivos adjuntos.</div>';
      return;
    }

    attachmentsGrid.innerHTML = state.attachments.map((item, idx) => {
      if (item.type === 'image') {
        return `
          <button type="button" class="attachment-card" data-view-image="${idx}">
            <span class="attachment-loader"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando" class="meta-spinner-login"></span>
            <img src="${item.previewUrl}" alt="${item.file.name}" class="attachment-image js-attachment-preview">
          </button>
        `;
      }

      return `
        <div class="attachment-card attachment-doc">
          <i class="bi ${fileIcon(item.file)}"></i>
          <span>${item.file.name}</span>
        </div>
      `;
    }).join('');

    const previews = Array.from(attachmentsGrid.querySelectorAll('.js-attachment-preview'));
    previews.forEach((img) => {
      const loader = img.parentElement.querySelector('.attachment-loader');
      const done = () => {
        img.classList.add('is-loaded');
        if (loader) loader.remove();
      };
      if (img.complete) {
        done();
      } else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', () => {
          if (loader) loader.remove();
        }, { once: true });
      }
    });
  };



  const escapeHtml = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const setBoardState = (key) => {
    if (!informesBoardLoading || !informesBoardEmpty || !informesCardsGrid || !informesPagination) return;
    informesBoardLoading.classList.toggle('d-none', key !== 'loading');
    informesBoardEmpty.classList.toggle('d-none', key !== 'empty');
    informesCardsGrid.classList.toggle('d-none', key !== 'data');
    informesPagination.classList.toggle('d-none', key !== 'data');
  };

  const collectReports = async () => {
    await window.laJamoneraReady;
    const tree = await window.dbLaJamoneraRest.read('/informes');
    const output = [];
    const years = tree && typeof tree === 'object' ? Object.keys(tree) : [];
    years.forEach((year) => {
      const monthsObj = tree[year] || {};
      Object.keys(monthsObj).forEach((month) => {
        const daysObj = monthsObj[month] || {};
        Object.keys(daysObj).forEach((day) => {
          const reports = daysObj[day] || {};
          Object.keys(reports).forEach((id) => {
            const report = reports[id];
            if (!report || typeof report !== 'object') return;
            if (!report.html && !report.createdAt) return;
            output.push({ ...report, id: report.id || id, year, month, day });
          });
        });
      });
    });
    output.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return output;
  };

  const renderBoardPagination = (totalPages) => {
    if (totalPages <= 1) {
      informesPagination.innerHTML = '';
      return;
    }
    let html = `<button class="btn ios-btn ios-btn-secondary" data-page="${Math.max(1, state.currentPage - 1)}">Anterior</button>`;
    for (let page = 1; page <= totalPages; page += 1) {
      html += `<button class="btn ios-btn ${page === state.currentPage ? 'ios-btn-primary' : 'ios-btn-secondary'}" data-page="${page}">${page}</button>`;
    }
    html += `<button class="btn ios-btn ios-btn-secondary" data-page="${Math.min(totalPages, state.currentPage + 1)}">Siguiente</button>`;
    informesPagination.innerHTML = html;
  };

  const renderReportsBoard = () => {
    const source = state.filteredReports.length || state.activeRange ? state.filteredReports : state.reports;
    if (!source.length) {
      setBoardState('empty');
      informesCardsGrid.innerHTML = '';
      informesPagination.innerHTML = '';
      return;
    }

    const totalPages = Math.max(1, Math.ceil(source.length / REPORTS_PER_PAGE));
    state.currentPage = Math.min(state.currentPage, totalPages);
    const startAt = (state.currentPage - 1) * REPORTS_PER_PAGE;
    const pageItems = source.slice(startAt, startAt + REPORTS_PER_PAGE);

    informesCardsGrid.innerHTML = pageItems.map((report) => {
      const user = state.users[report.userId] || {};
      const attachments = Array.isArray(report.attachments) ? report.attachments : [];
      const imageCount = attachments.filter((item) => item.type === 'image').length;
      const docCount = Math.max(0, attachments.length - imageCount);
      const commentsCount = getCommentsCount(report);
      const importance = getImportanceMeta(report.importance);
      const displayName = user.fullName || report.userName || 'Usuario';
      const displayUser = user.fullName ? user : { fullName: displayName, photoUrl: '' };

      return `
        <article class="informe-card" data-report-id="${report.id}" data-year="${report.year}" data-month="${report.month}" data-day="${report.day}">
          <div class="informe-card-head">
            <span class="informe-card-date"><i class="fa-regular fa-calendar"></i> ${getDateLabel(report.createdAt)}</span>
            <span class="informe-card-comments ${commentsCount ? 'has-comments' : 'no-comments'}"><i class="fa-solid ${commentsCount ? 'fa-comment-dots' : 'fa-comment-slash'}"></i> ${commentsCount ? `${commentsCount} comentario(s)` : 'Sin comentarios'}</span>
          </div>

          <div class="informe-card-preview">${report.html || '<p>Sin contenido</p>'}</div>

          <div class="informe-card-meta">
            <span class="informe-attach-chip"><i class="fa-regular fa-image"></i> ${imageCount}</span>
            <span class="informe-attach-chip"><i class="fa-regular fa-file-lines"></i> ${docCount}</span>
            <span class="importance-chip importance-${importance.tone}">${normalizeImportance(report.importance, 50)}% · ${importance.label}</span>
            <button class="btn informe-print-chip" type="button" data-print-report="${report.id}" title="Imprimir informe"><i class="fa-solid fa-print"></i></button>
          </div>

          <div class="informe-card-user">
            ${renderUserAvatar(displayUser)}
            <div class="informe-card-user-text">
              <strong>${escapeHtml(displayName)}</strong>
              <small>${escapeHtml(user.position || report.userPosition || 'Sin puesto')}</small>
            </div>
          </div>

          <div class="informe-card-actions">
            <button class="btn ios-btn ios-btn-primary" type="button" data-view-report="${report.id}">Ver informe completo</button>
            <button class="btn informe-icon-btn" type="button" data-comment-report="${report.id}" title="Comentar"><i class="fa-regular fa-message"></i></button>
            <button class="btn informe-icon-btn" type="button" data-edit-report="${report.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
            <button class="btn informe-icon-btn danger" type="button" data-delete-report="${report.id}" title="Borrar"><i class="fa-solid fa-trash"></i></button>
          </div>
        </article>
      `;
    }).join('');

    prepareThumbLoaders('.informe-card .js-user-photo');
    renderBoardPagination(totalPages);
    setBoardState('data');
  };

  const buildReportDayCount = async () => {
    const index = await window.dbLaJamoneraRest.read('/informes_index');
    const dayCount = {};
    if (index && typeof index === 'object') {
      Object.keys(index).forEach((year) => {
        Object.keys(index[year] || {}).forEach((month) => {
          Object.keys(index[year][month] || {}).forEach((day) => {
            const key = `${year}-${month}-${day}`;
            dayCount[key] = Object.keys(index[year][month][day] || {}).length;
          });
        });
      });
    }
    state.reportDayCount = dayCount;
  };

  const loadReportsBoard = async () => {
    if (!informesBoardLoading) return;
    setBoardState('loading');
    try {
      await buildReportDayCount();
      state.reports = await collectReports();
      if (!state.activeRange) {
        state.filteredReports = [];
      }
      renderReportsBoard();
      if (reportsFilterPicker) {
        reportsFilterPicker.redraw();
      }
    } catch (error) {
      setBoardState('empty');
      informesBoardEmpty.textContent = 'No hay informes para cargar';
    }
  };

  const applyDateFilter = (startDate, endDate) => {
    if (!startDate || !endDate) {
      state.activeRange = null;
      state.filteredReports = [];
      state.currentPage = 1;
      clearFilterInformesBtn.classList.add('d-none');
      renderReportsBoard();
      return;
    }

    state.activeRange = [startDate, endDate];
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    state.filteredReports = state.reports.filter((report) => {
      const created = new Date(Number(report.createdAt || Date.now()));
      return created >= start && created <= end;
    });
    state.currentPage = 1;
    clearFilterInformesBtn.classList.remove('d-none');
    renderReportsBoard();
  };

  const loadData = async () => {
    showState('loading');
    try {
      await window.laJamoneraReady;
      const users = await window.dbLaJamoneraRest.read('/informes/users');
      state.users = users && typeof users === 'object' ? users : {};
      renderUsers();
      renderAttachments();
      showState('data');
      updateMainScrollHint();
      await loadReportsBoard();
    } catch (error) {
      await openIosSwal({ title: 'Error', html: '<p>No se pudieron cargar los datos de informes.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      showState('data');
    }
  };

  const ensureInitialDataLoaded = async () => {
    if (initialLoadPromise) {
      return initialLoadPromise;
    }

    initialLoadPromise = (async () => {
      await loadData();
      await restoreDraft();
      state.reportsLoaded = true;
      updateMainScrollHint();
    })();

    try {
      await initialLoadPromise;
    } finally {
      initialLoadPromise = null;
    }
  };

  const uploadToStorage = async (file, basePath) => {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const refPath = `${basePath}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const ref = window.storageLaJamonera.ref().child(refPath);
    await ref.put(file);
    return ref.getDownloadURL();
  };

  const promptUserKey = async () => {
    const keyCheck = await openIosSwal({
      title: 'Verificar clave',
      input: 'password',
      inputClass: 'ios-input informes-key-input',
      inputLabel: 'Ingresá la clave de 4 dígitos',
      inputAttributes: { maxlength: 4, inputmode: 'numeric', autocomplete: 'new-password' },
      confirmButtonText: 'Validar',
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'informes-key-alert'
      },
      didOpen: () => {
        const input = document.querySelector('.swal2-input.informes-key-input');
        if (input) {
          input.setAttribute('autocomplete', 'new-password');
          input.setAttribute('autocorrect', 'off');
          input.setAttribute('autocapitalize', 'off');
          input.setAttribute('spellcheck', 'false');
        }
      },
      preConfirm: (val) => {
        if (!/^\d{4}$/.test(String(val || ''))) {
          Swal.showValidationMessage('La clave debe tener 4 dígitos numéricos.');
          return false;
        }
        return String(val);
      }
    });
    return keyCheck;
  };

  const openUserForm = async (initial = null) => {
    let pendingUpload = null;
    const result = await openIosSwal({
      title: initial ? 'Editar usuario' : 'Cargar usuario',
      showCancelButton: true,
      confirmButtonText: initial ? 'Guardar cambios' : 'Crear usuario',
      cancelButtonText: 'Cancelar',
      customClass: { popup: 'informes-user-form-alert ingredientes-alert' },
      html: `
        <div class="ingrediente-form-grid">
          <section class="step-block">
            <h6 class="step-title">1) Datos personales</h6>
            <div class="step-content">
              <label for="userFullName">Nombre y apellido *</label>
              <input id="userFullName" class="swal2-input ios-input" autocomplete="off" placeholder="Ej: Juan Pérez" value="${initial ? initial.fullName : ''}">
              <label for="userPosition">Puesto en la empresa *</label>
              <input id="userPosition" class="swal2-input ios-input" autocomplete="off" placeholder="Ej: Bromatólogo" value="${initial ? initial.position : ''}">
              <label for="userEmail">Email *</label>
              <input id="userEmail" class="swal2-input ios-input" autocomplete="off" type="email" placeholder="Ej: usuario@empresa.com" value="${initial ? (initial.email || '') : ''}">
              <label for="userPin">Clave de 4 dígitos *</label>
              <div class="ios-input-group d-flex align-items-center px-2">
                <input id="userPin" class="swal2-input ios-input border-0 bg-transparent flex-grow-1" type="password" maxlength="4" inputmode="numeric" autocomplete="new-password" placeholder="4 dígitos" value="${initial ? initial.pin : ''}">
                <button id="toggleUserPin" type="button" class="btn ios-toggle-pass" aria-label="Ver u ocultar clave"><i class="fa-solid fa-eye"></i></button>
              </div>
            </div>
          </section>
          <section class="step-block">
            <h6 class="step-title">2) Fotografía (opcional)</h6>
            <div class="step-content">
              <div id="userPhotoPreview" class="image-preview-circle">${initial?.photoUrl ? `<img src="${initial.photoUrl}" alt="Foto">` : '<span class="image-placeholder-circle-2 user-initials-preview"><i class="bi bi-person-fill"></i></span>'}</div>
              <input id="userPhotoInput" type="file" class="form-control image-file-input" accept="image/*">
            </div>
          </section>
        </div>
      `,
      didOpen: () => {
        const fullNameInput = document.getElementById('userFullName');
        const photoInput = document.getElementById('userPhotoInput');
        const preview = document.getElementById('userPhotoPreview');
        const userPinInput = document.getElementById('userPin');
        const toggleUserPin = document.getElementById('toggleUserPin');

        const updateInitials = () => {
          if (pendingUpload || (initial && initial.photoUrl)) {
            return;
          }
          const initials = initialsFromName(fullNameInput.value);
          preview.innerHTML = initials
            ? `<span class="image-placeholder-circle-2 user-initials-preview">${initials}</span>`
            : '<span class="image-placeholder-circle-2 user-initials-preview"><i class="bi bi-person-fill"></i></span>';
        };

        fullNameInput.addEventListener('input', updateInitials);
        toggleUserPin.addEventListener('click', () => {
          const hidden = userPinInput.type === 'password';
          userPinInput.type = hidden ? 'text' : 'password';
          toggleUserPin.innerHTML = hidden ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
        });
        updateInitials();

        photoInput.addEventListener('change', async () => {
          const file = photoInput.files && photoInput.files[0];
          if (!file) return;
          if (!USER_PHOTO_TYPES.includes(file.type) || file.size > MAX_UPLOAD_SIZE_BYTES) {
            photoInput.value = '';
            return;
          }
          pendingUpload = file;
          preview.innerHTML = `<span class="image-preview-overlay"><img src="./IMG/Meta-ai-logo.webp" alt="Subiendo" class="meta-spinner-login"></span>`;
          const tmp = URL.createObjectURL(file);
          setTimeout(() => {
            preview.innerHTML = `<img src="${tmp}" alt="Vista previa">`;
          }, 600);
        });
      },
      preConfirm: async () => {
        const fullName = normalizeValue(document.getElementById('userFullName').value);
        const position = normalizeValue(document.getElementById('userPosition').value);
        const email = normalizeLower(document.getElementById('userEmail').value);
        const pin = normalizeValue(document.getElementById('userPin').value);

        if (!fullName || !position || !email) {
          Swal.showValidationMessage('Completá nombre, puesto e email.');
          return false;
        }
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          Swal.showValidationMessage('Ingresá un email válido.');
          return false;
        }
        if (!/^\d{4}$/.test(pin)) {
          Swal.showValidationMessage('La clave debe tener 4 dígitos.');
          return false;
        }

        let photoUrl = initial?.photoUrl || '';
        if (pendingUpload) {
          try {
            await window.laJamoneraReady;
            photoUrl = await uploadToStorage(pendingUpload, 'informes/users');
          } catch (error) {
            Swal.showValidationMessage('No se pudo subir la foto.');
            return false;
          }
        }

        return { fullName, position, email, pin, photoUrl };
      }
    });

    if (!result.isConfirmed) {
      return null;
    }

    const id = initial?.id || makeId('usr');
    const payload = {
      id,
      ...result.value,
      createdAt: initial?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    state.users[id] = payload;
    await window.dbLaJamoneraRest.write('/informes/users', state.users);
    renderUsers();
    return id;
  };

  const saveInforme = async () => {
    const selectedUserId = normalizeValue(informeUserSelect.value);
    const editorHtml = normalizeValue(informeEditor.innerHTML);

    if (!selectedUserId || !state.users[selectedUserId]) {
      await openIosSwal({ title: 'Falta usuario', html: '<p>Seleccioná un usuario válido para guardar.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }
    if (!editorHtml) {
      await openIosSwal({ title: 'Falta contenido', html: '<p>Escribí el contenido del informe.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    const keyCheck = await promptUserKey();
    if (!keyCheck.isConfirmed || keyCheck.value !== state.users[selectedUserId].pin) {
      if (keyCheck.isConfirmed) {
        await openIosSwal({ title: 'Clave incorrecta', html: '<p>No coincide la clave del usuario.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      }
      return;
    }

    const date = getCurrentDate();
    const { year, month, day } = getDateParts(date);
    const reportId = makeId('inf');

    Swal.fire({
      title: 'Guardando informe...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Guardando" class="meta-spinner-login"></div>',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert informes-alert informes-saving-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' }
    });

    try {
      await window.laJamoneraReady;
      const attachmentsSaved = [];

      for (const item of state.attachments) {
        const folder = item.type === 'image' ? 'images' : 'docs';
        const storagePath = `informes/${year}/${month}/${day}/${reportId}/${folder}`;
        const url = await uploadToStorage(item.file, storagePath);
        attachmentsSaved.push({
          name: item.file.name,
          type: item.type,
          mime: item.file.type,
          size: item.file.size,
          url
        });
      }

      const basePath = `/informes/${year}/${month}/${day}/${reportId}`;
      const reportPayload = {
        id: reportId,
        createdAt: Date.now(),
        reportDate: `${year}-${month}-${day}`,
        userId: selectedUserId,
        userName: state.users[selectedUserId].fullName,
        userPosition: state.users[selectedUserId].position,
        userEmail: state.users[selectedUserId].email || '',
        html: editorHtml,
        importance: getImportanceValue(),
        attachments: attachmentsSaved,
        comments: {}
      };

      await window.dbLaJamoneraRest.write(basePath, reportPayload);
      await window.dbLaJamoneraRest.write(`/informes_index/${year}/${month}/${day}/${reportId}`, {
        id: reportId,
        reportDate: `${year}-${month}-${day}`,
        userId: selectedUserId,
        userName: state.users[selectedUserId].fullName,
        importance: getImportanceValue(),
        createdAt: Date.now(),
        attachmentsCount: attachmentsSaved.length,
        commentsCount: 0
      });

      state.attachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      state.attachments = [];
      renderAttachments();
      informeEditor.innerHTML = '';
      resetEditorControls();
      clearTypingStates();
      importanceRange.value = '50';
      updateToolbarState();
      updatePreview();
      updateImportanceLabel();
      clearDraft();
      await loadReportsBoard();
      const printChoice = await openIosSwal({
        title: 'Informe guardado',
        html: '<p>El informe fue almacenado correctamente.</p><p>¿Querés imprimirlo ahora?</p>',
        icon: 'success',
        showCancelButton: true,
        confirmButtonText: 'Sí, imprimir',
        cancelButtonText: 'No, cerrar'
      });
      if (printChoice.isConfirmed) {
        await printReport(reportPayload);
      }
    } catch (error) {
      await openIosSwal({ title: 'Error al guardar', html: '<p>No se pudo guardar el informe. Reintentá.</p>', icon: 'error', confirmButtonText: 'Entendido' });
    } finally {
      Swal.close();
    }
  };



  const findReportById = (reportId) => {
    const source = state.reports || [];
    return source.find((item) => item.id === reportId) || null;
  };

  const ensureUsersAvailableForComment = async () => {
    const users = Object.values(state.users || {});
    if (users.length) return true;
    const answer = await openIosSwal({
      title: 'Sin usuarios',
      html: '<p>Necesitás crear un usuario antes de comentar.</p>',
      showCancelButton: true,
      confirmButtonText: 'Crear usuario',
      cancelButtonText: 'Cancelar'
    });
    if (!answer.isConfirmed) return false;
    const id = await openUserForm();
    return Boolean(id);
  };

  const verifyReportCreatorPin = async (report) => {
    const user = state.users[report.userId];
    if (!user) {
      await openIosSwal({ title: 'Usuario no encontrado', html: '<p>No existe el usuario creador del informe.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      return false;
    }
    const keyCheck = await promptUserKey();
    if (!keyCheck.isConfirmed) return false;
    if (keyCheck.value !== user.pin) {
      await openIosSwal({ title: 'Clave incorrecta', html: '<p>No coincide la clave del creador.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      return false;
    }
    return true;
  };

  const renderCommentTree = (comments = [], level = 0) => sortComments(comments).map((comment) => {
    const author = escapeHtml(comment.userName || 'Usuario');
    const text = escapeHtml(comment.text || '').replaceAll('\\n', '<br>');

    const date = getDateLabel(comment.createdAt);
    const replies = Array.isArray(comment.replies) ? comment.replies : [];
    const accent = commentAccentFromUserId(comment.userId || comment.userName || 'anon');
    return `
      <article class="report-comment-item ${level > 0 ? 'is-reply' : ''}" style="--comment-accent:${accent};" data-comment-id="${comment.id}" data-comment-level="${level}">
        <header class="report-comment-head">
          <strong>${author}</strong>
          <small>${date}</small>
        </header>
        <p class="report-comment-text">${text}</p>
        <button type="button" class="btn report-comment-reply-btn" data-reply-comment="${comment.id}">Responder</button>
        ${replies.length ? `<div class="report-comment-replies">${renderCommentTree(replies, level + 1)}</div>` : ''}
      </article>
    `;
  }).join('');

  const buildCommentsPanel = (report) => {
    const comments = getCommentList(report);
    if (!comments.length) {
      return '<div class="informes-empty report-comments-empty">Sin comentarios todavía.</div>';
    }
    return `<div class="report-comments-thread">${renderCommentTree(comments)}</div>`;
  };

  const openReportViewer = async (report) => {
    const attachments = Array.isArray(report.attachments) ? report.attachments : [];
    const imageAttachments = attachments.filter((item) => item.type === 'image');
    const attachmentHtml = attachments.length
      ? attachments.map((item, index) => {
        if (item.type === 'image') {
          return `<button type="button" class="attachment-card" data-open-report-image="${index}"><img src="${item.url}" alt="${escapeHtml(item.name)}" class="attachment-image is-loaded"></button>`;
        }
        return `<a href="${item.url}" target="_blank" rel="noopener noreferrer" class="attachment-card attachment-doc"><i class="bi bi-file-earmark"></i><span>${escapeHtml(item.name)}</span></a>`;
      }).join('')
      : '<div class="informes-empty">Sin adjuntos</div>';

    await openIosSwal({
      title: 'Informe completo',
      width: 980,
      html: `
        <div class="report-viewer">
          <div class="report-viewer-meta">
            <p><strong>Creador:</strong> ${escapeHtml(report.userName || '')}</p>
            <p><strong>Puesto:</strong> ${escapeHtml(report.userPosition || '-')}</p>
            <p><strong>Email:</strong> ${escapeHtml(report.userEmail || '-')}</p>
            <p><strong>Fecha:</strong> ${getDateLabel(report.createdAt)}</p>
          </div>
          <div class="report-viewer-content-wrap"><div class="report-viewer-content">${report.html || ''}</div></div>
          <div class="attachments-grid">${attachmentHtml}</div>
          <section class="report-comments-wrap">
            <div class="report-comments-head">
              <h6><i class="fa-regular fa-comments"></i> <span class="report-comments-title-text">Comentarios</span></h6>
              <button type="button" class="btn ios-btn ios-btn-secondary report-add-comment-btn" data-comment-from-viewer="1">Comentar</button>
            </div>
            ${buildCommentsPanel(report)}
          </section>
        </div>
      `,
      confirmButtonText: 'Cerrar',
      didOpen: (popup) => {
        popup.querySelectorAll('[data-open-report-image]').forEach((node) => {
          node.addEventListener('click', (event) => {
            const idx = Number(event.currentTarget.dataset.openReportImage);
            const selected = attachments[idx];
            const imageIndex = imageAttachments.findIndex((item) => item.url === selected?.url);
            if (imageIndex < 0) return;
            state.viewerImages = imageAttachments.map((item) => ({ previewUrl: item.url }));
            state.reopenViewerReportId = report.id;
            Swal.close();
            setTimeout(() => openImageViewer(imageIndex), 80);
          });
        });

        const addCommentBtn = popup.querySelector('[data-comment-from-viewer]');
        addCommentBtn?.addEventListener('click', async () => {
          Swal.close();
          await addCommentToReport(report, null, { returnToViewer: true });
        });

        popup.querySelectorAll('[data-reply-comment]').forEach((node) => {
          node.addEventListener('click', async (event) => {
            const commentId = String(event.currentTarget.dataset.replyComment || '');
            Swal.close();
            await addCommentToReport(report, commentId, { returnToViewer: true });
          });
        });
      }
    });
  };

  const editReport = async (report) => {
    const allowed = await verifyReportCreatorPin(report);
    if (!allowed) return;

    const currentAttachments = Array.isArray(report.attachments) ? [...report.attachments] : [];
    const localUploads = [];

    const answer = await openIosSwal({
      title: 'Editar informe',
      html: `
        <div class="text-start report-edit-wrap">
          <label class="mb-2">Contenido del informe</label>
          <div class="editor-toolbar report-edit-toolbar" role="toolbar" aria-label="Herramientas de edición">
            <button type="button" class="editor-btn" data-edit-cmd="bold"><i class="fa-solid fa-bold"></i></button>
            <button type="button" class="editor-btn" data-edit-cmd="italic"><i class="fa-solid fa-italic"></i></button>
            <button type="button" class="editor-btn" data-edit-cmd="underline"><i class="fa-solid fa-underline"></i></button>
            <button type="button" class="editor-btn" data-edit-cmd="insertUnorderedList"><i class="fa-solid fa-list-ul"></i></button>
            <button type="button" class="editor-btn" data-edit-cmd="justifyLeft"><i class="fa-solid fa-align-left"></i></button>
            <button type="button" class="editor-btn" data-edit-cmd="justifyCenter"><i class="fa-solid fa-align-center"></i></button>
          </div>
          <div class="report-editor-scroll"><div id="editReportHtml" class="informe-editor" contenteditable="true">${report.html || ''}</div></div>
          <div class="importance-wrap mt-3">
            <label class="form-label" for="editImportanceRange">Importancia sanitaria</label>
            <input id="editImportanceRange" type="range" min="0" max="100" value="${normalizeImportance(report.importance, 50)}" class="importance-range">
            <div id="editImportanceLabel" class="importance-label"></div>
          </div>
          <label class="mt-3 mb-2">Adjuntos actuales</label>
          <div id="editAttachmentsGrid" class="attachments-grid report-edit-attachments">
            ${currentAttachments.length ? currentAttachments.map((item, idx) => `
              <article class="attachment-card ${item.type !== 'image' ? 'attachment-doc' : ''}" data-edit-attachment="${idx}">
                ${item.type === 'image'
                  ? `<img src="${item.url}" alt="${escapeHtml(item.name)}" class="attachment-image is-loaded">`
                  : `<i class="bi bi-file-earmark"></i><span>${escapeHtml(item.name)}</span>`}
                <button type="button" class="btn remove-attachment-btn is-danger" data-remove-edit-attachment="${idx}" title="Quitar adjunto"><i class="fa-solid fa-circle-xmark"></i></button>
              </article>
            `).join('') : '<div class="informes-empty">Sin adjuntos</div>'}
          </div>
          <div class="mt-2 d-flex justify-content-end">
            <button type="button" id="editAddAttachmentsBtn" class="btn ios-btn ios-btn-secondary report-edit-add-btn"><i class="fa-solid fa-paperclip"></i> Agregar adjuntos</button>
            <input id="editAttachmentsInput" type="file" class="d-none" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt">
          </div>
        </div>
      `,
      width: 980,
      showCancelButton: true,
      confirmButtonText: 'Guardar cambios',
      cancelButtonText: 'Cancelar',
      didOpen: (popup) => {
        const grid = popup.querySelector('#editAttachmentsGrid');
        const input = popup.querySelector('#editAttachmentsInput');
        const addBtn = popup.querySelector('#editAddAttachmentsBtn');
        const editEditor = popup.querySelector('#editReportHtml');
        const editImportanceRange = popup.querySelector('#editImportanceRange');
        const editImportanceLabel = popup.querySelector('#editImportanceLabel');

        const updateEditImportanceLabel = () => {
          const meta = getImportanceMeta(editImportanceRange?.value);
          if (editImportanceLabel) {
            editImportanceLabel.textContent = `${normalizeImportance(editImportanceRange?.value, 50)}% · ${meta.label}`;
          }
        };

        popup.querySelectorAll('[data-edit-cmd]').forEach((button) => {
          button.addEventListener('click', () => {
            editEditor?.focus();
            document.execCommand(button.dataset.editCmd, false, null);
          });
        });

        editImportanceRange?.addEventListener('input', updateEditImportanceLabel);
        updateEditImportanceLabel();

        const redraw = () => {
          if (!grid) return;
          grid.innerHTML = currentAttachments.length
            ? currentAttachments.map((item, idx) => `
              <article class="attachment-card ${item.type !== 'image' ? 'attachment-doc' : ''}" data-edit-attachment="${idx}">
                ${item.type === 'image'
                  ? `<img src="${item.url}" alt="${escapeHtml(item.name)}" class="attachment-image is-loaded">`
                  : `<i class="bi bi-file-earmark"></i><span>${escapeHtml(item.name)}</span>`}
                <button type="button" class="btn remove-attachment-btn is-danger" data-remove-edit-attachment="${idx}" title="Quitar adjunto"><i class="fa-solid fa-circle-xmark"></i></button>
              </article>
            `).join('')
            : '<div class="informes-empty">Sin adjuntos</div>';
        };

        addBtn?.addEventListener('click', () => input?.click());
        input?.addEventListener('change', (event) => {
          const files = Array.from(event.target.files || []);
          files.forEach((file) => {
            const message = validateFile(file);
            if (message) return;
            const type = getFileCategory(file);
            const previewUrl = type === 'image' ? URL.createObjectURL(file) : '';
            const tmpId = makeId('tmpAtt');
            localUploads.push({ tmpId, file });
            currentAttachments.push({
              id: tmpId,
              name: file.name,
              type,
              mime: file.type,
              size: file.size,
              url: previewUrl,
              isLocal: true
            });
          });
          event.target.value = '';
          redraw();
        });

        let pendingDeleteIndex = null;

        const renderDeleteConfirm = () => {
          grid?.querySelectorAll('.attachment-delete-confirm').forEach((node) => node.remove());
          if (pendingDeleteIndex === null) return;
          const card = grid?.querySelector(`[data-edit-attachment="${pendingDeleteIndex}"]`);
          if (!card) {
            pendingDeleteIndex = null;
            return;
          }
          const confirm = document.createElement('div');
          confirm.className = 'attachment-delete-confirm';
          confirm.innerHTML = '<button type="button" class="btn attachment-delete-btn yes" data-attachment-confirm="yes">Eliminar</button><button type="button" class="btn attachment-delete-btn no" data-attachment-confirm="no">Cancelar</button>';
          card.appendChild(confirm);
        };

        grid?.addEventListener('click', (event) => {
          const removeBtn = event.target.closest('[data-remove-edit-attachment]');
          if (removeBtn) {
            pendingDeleteIndex = Number(removeBtn.dataset.removeEditAttachment);
            renderDeleteConfirm();
            return;
          }

          const confirmBtn = event.target.closest('[data-attachment-confirm]');
          if (!confirmBtn) return;
          const decision = confirmBtn.dataset.attachmentConfirm;
          const idx = pendingDeleteIndex;
          pendingDeleteIndex = null;

          if (decision !== 'yes') {
            renderDeleteConfirm();
            return;
          }

          const target = currentAttachments[idx];
          if (!target) {
            renderDeleteConfirm();
            return;
          }

          if (target?.isLocal && target.url) {
            URL.revokeObjectURL(target.url);
          }
          currentAttachments.splice(idx, 1);
          redraw();
        });
      },
      preConfirm: () => {
        const html = normalizeValue(document.getElementById('editReportHtml').innerHTML);
        if (!html) {
          Swal.showValidationMessage('El informe no puede quedar vacío.');
          return false;
        }
        const importance = normalizeImportance(document.getElementById('editImportanceRange')?.value, 50);
        return { html, importance };
      }
    });

    if (!answer.isConfirmed) {
      currentAttachments.forEach((item) => {
        if (item.isLocal && item.url) URL.revokeObjectURL(item.url);
      });
      return;
    }

    const path = getReportPath(report);
    const uploadedMap = new Map();
    for (const item of localUploads) {
      const folder = getFileCategory(item.file) === 'image' ? 'images' : 'docs';
      const storagePath = `informes/${report.year}/${report.month}/${report.day}/${report.id}/${folder}`;
      const url = await uploadToStorage(item.file, storagePath);
      uploadedMap.set(item.tmpId, url);
    }

    const finalAttachments = currentAttachments.map((item) => {
      if (!item.isLocal) return item;
      const source = localUploads.find((upload) => upload.tmpId === item.id);
      return {
        name: item.name,
        type: item.type,
        mime: item.mime || source?.file?.type || '',
        size: item.size || source?.file?.size || 0,
        url: uploadedMap.get(item.id) || item.url
      };
    });

    currentAttachments.forEach((item) => {
      if (item.isLocal && item.url) URL.revokeObjectURL(item.url);
    });

    const updated = { ...report, html: answer.value.html, importance: normalizeImportance(answer.value.importance, 50), attachments: finalAttachments, updatedAt: Date.now() };
    await window.dbLaJamoneraRest.write(path, updated);
    await window.dbLaJamoneraRest.write(`/informes_index/${report.year}/${report.month}/${report.day}/${report.id}`, {
      id: report.id,
      reportDate: report.reportDate,
      userId: report.userId,
      userName: report.userName,
      importance: normalizeImportance(updated.importance, 50),
      createdAt: Number(report.createdAt || Date.now()),
      attachmentsCount: finalAttachments.length,
      commentsCount: getCommentsCount(updated),
      updatedAt: Date.now()
    });
    await loadReportsBoard();
  };

  const deleteReport = async (report) => {
    const allowed = await verifyReportCreatorPin(report);
    if (!allowed) return;
    const confirmation = await openIosSwal({
      title: 'Borrar informe',
      html: '<p>Esta acción eliminará el informe de forma definitiva.</p>',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Borrar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirmation.isConfirmed) return;
    const path = getReportPath(report);
    await window.dbLaJamoneraRest.write(path, null);
    await window.dbLaJamoneraRest.write(`/informes_index/${report.year}/${report.month}/${report.day}/${report.id}`, null);
    await loadReportsBoard();
  };

  const reopenReportViewerById = async (reportId) => {
    const report = findReportById(reportId);
    if (report) {
      await openReportViewer(report);
    }
  };

  const findCommentById = (comments, commentId) => {
    for (const comment of comments) {
      if (comment.id === commentId) return comment;
      const replies = Array.isArray(comment.replies) ? comment.replies : [];
      const found = findCommentById(replies, commentId);
      if (found) return found;
    }
    return null;
  };

  const addCommentToReport = async (report, parentCommentId = null, options = {}) => {
    const canContinue = await ensureUsersAvailableForComment();
    if (!canContinue) return;
    const users = Object.values(state.users);
    const optionsHtml = [
      '<option value="">Seleccioná un usuario</option>',
      ...users.map((user) => `<option value="${user.id}">${escapeHtml(user.fullName)}</option>`),
      '<option value="create">Crear nuevo usuario</option>'
    ].join('');
    const commentPrompt = await openIosSwal({
      title: parentCommentId ? 'Responder comentario' : 'Nuevo comentario',
      html: `<div class="text-start report-comment-form"><label>Usuario</label><select id="commentUser" class="form-select ios-input mb-2">${optionsHtml}</select><label>Comentario</label><textarea id="commentText" class="swal2-textarea ios-input" placeholder="Escribí tu comentario"></textarea><label>Clave</label><input id="commentPin" class="swal2-input ios-input" type="password" inputmode="numeric" maxlength="4" placeholder="Clave de 4 dígitos" autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false"></div>`,
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      didOpen: (popup) => {
        const userSelect = popup.querySelector('#commentUser');
        userSelect?.addEventListener('change', async (event) => {
          if (event.target.value !== 'create') return;
          const id = await openUserForm();
          if (!id) {
            event.target.value = '';
            return;
          }
          const extra = document.createElement('option');
          extra.value = id;
          extra.textContent = state.users[id] ? state.users[id].fullName : 'Usuario';
          event.target.insertBefore(extra, event.target.querySelector('option[value="create"]'));
          event.target.value = id;
        });
      },
      preConfirm: () => {
        const userId = normalizeValue(document.getElementById('commentUser').value);
        const text = normalizeValue(document.getElementById('commentText').value);
        const pin = normalizeValue(document.getElementById('commentPin').value);
        if (!userId || !state.users[userId]) {
          Swal.showValidationMessage('Seleccioná un usuario.');
          return false;
        }
        if (!text) {
          Swal.showValidationMessage('Escribí un comentario.');
          return false;
        }
        if (!/^\d{4}$/.test(pin)) {
          Swal.showValidationMessage('Ingresá una clave válida de 4 dígitos.');
          return false;
        }
        if (pin !== String(state.users[userId].pin || '')) {
          Swal.showValidationMessage('Clave incorrecta. Volvé a intentarlo.');
          return false;
        }
        return { userId, text, pin };
      }
    });
    if (!commentPrompt.isConfirmed) {
      if (options.returnToViewer) {
        await reopenReportViewerById(report.id);
      }
      return;
    }

    const author = state.users[commentPrompt.value.userId];

    const comments = sortComments(getCommentList(report));
    const commentId = makeId('cmt');
    const newComment = {
      id: commentId,
      userId: author.id,
      userName: author.fullName,
      text: commentPrompt.value.text,
      createdAt: Date.now(),
      replies: []
    };

    if (parentCommentId) {
      const parent = findCommentById(comments, parentCommentId);
      if (parent) {
        parent.replies = Array.isArray(parent.replies) ? parent.replies : [];
        parent.replies.push(newComment);
      } else {
        comments.push(newComment);
      }
    } else {
      comments.push(newComment);
    }

    const commentsObject = comments.reduce((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});

    const updated = { ...report, comments: commentsObject };
    await window.dbLaJamoneraRest.write(getReportPath(report), updated);
    await window.dbLaJamoneraRest.write(`/informes_index/${report.year}/${report.month}/${report.day}/${report.id}`, {
      id: report.id,
      reportDate: report.reportDate,
      userId: report.userId,
      userName: report.userName,
      importance: normalizeImportance(report.importance, 50),
      createdAt: Number(report.createdAt || Date.now()),
      attachmentsCount: Array.isArray(report.attachments) ? report.attachments.length : 0,
      commentsCount: getCommentsCount(updated),
      updatedAt: Date.now()
    });
    await loadReportsBoard();
    if (options.returnToViewer) {
      await reopenReportViewerById(report.id);
    }
  };

  const updatePreview = () => {
    const hasContent = normalizeValue(informeEditor?.textContent || '');
    if (!hasContent) {
      informePreview.style.textAlign = 'left';
      informePreview.innerHTML = '<span style="color:#000000;background:#ffffff;font-weight:400;font-style:normal;text-decoration:none;">Texto vista previa</span>';
      return;
    }

    const previewColor = textColorInput.value || '#000000';
    const previewHighlight = highlightColorInput.value || '#ffffff';
    const previewBold = document.queryCommandState('bold');
    const previewItalic = document.queryCommandState('italic');
    const previewUnderline = document.queryCommandState('underline');
    const previewStrike = document.queryCommandState('strikeThrough');
    const align = ['justifyCenter', 'justifyRight', 'justifyFull'].find((cmd) => document.queryCommandState(cmd));
    informePreview.style.textAlign = align === 'justifyCenter' ? 'center' : align === 'justifyRight' ? 'right' : align === 'justifyFull' ? 'justify' : 'left';
    const deco = `${previewUnderline ? 'underline ' : ''}${previewStrike ? 'line-through' : 'none'}`.trim();
    informePreview.innerHTML = `<span style="color:${previewColor};background:${previewHighlight};font-weight:${previewBold ? 700 : 400};font-style:${previewItalic ? 'italic' : 'normal'};text-decoration:${deco || 'none'};">Texto vista previa</span>`;
  };

  const updateToolbarState = () => {
    const toggles = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'];
    toggles.forEach((cmd) => {
      const button = document.querySelector(`.editor-btn[data-cmd="${cmd}"]`);
      if (!button) return;
      let active = false;
      try { active = document.queryCommandState(cmd); } catch (error) { active = false; }
      button.classList.toggle('is-active', !!active);
    });
  };

  const resetEditorControls = () => {
    fontSizeSelect.value = '3';
    formatBlockSelect.value = 'P';
    textColorInput.value = '#000000';
    highlightColorInput.value = '#ffffff';
  };

  const clearTypingStates = () => {
    ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].forEach((cmd) => {
      let active = false;
      try { active = document.queryCommandState(cmd); } catch (error) { active = false; }
      if (active) {
        document.execCommand(cmd, false, null);
      }
    });
    document.execCommand('justifyLeft', false, null);
  };

  const applyEditorCommand = (cmd, value = null) => {
    const selection = window.getSelection();
    const hasSelection =
      selection
      && selection.rangeCount > 0
      && !selection.isCollapsed
      && informeEditor.contains(selection.anchorNode)
      && informeEditor.contains(selection.focusNode);

    informeEditor.focus();
    if (cmd === 'removeFormat') {
      if (hasSelection && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        const plainText = range.toString();
        range.deleteContents();
        const plainNode = createPlainWrapper(plainText);
        range.insertNode(plainNode);
        setCollapsedSelection(plainNode.firstChild, plainNode.firstChild.length);
        placeCaretOutsideFormatting(plainNode);
      }

      clearTypingStates();
      resetEditorControls();
      ensurePlainTypingContext();
      updateToolbarState();
      updatePreview();
      return;
    } else if (cmd === 'formatBlock') {
      document.execCommand('formatBlock', false, `<${value}>`);
    } else if (cmd === 'hiliteColor') {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('hiliteColor', false, value || 'transparent');
    } else if (cmd === 'foreColor') {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('foreColor', false, value);
    } else {
      document.execCommand(cmd, false, value);
    }
    updateToolbarState();
    updatePreview();
  };

  const updateImportanceLabel = () => {
    const meta = getImportanceMeta(getImportanceValue());
    importanceLabel.textContent = meta.label;
  };

  const EMOJIS = ['😀', '😁', '😂', '🤣', '😊', '🙂', '😉', '😍', '😘', '😎', '🤔', '😐', '😶', '🙄', '😢', '😭', '😡', '🤯', '🥳', '👍', '👎', '👏', '🙏', '💡', '🔥', '⚠️', '🚨', '✅', '❌', '🧪', '📌', '📎', '📅', '🧼', '🧫'];

  const renderEmojiPanel = () => {
    emojiPanel.innerHTML = EMOJIS.map((emoji) => `<button type="button" class="emoji-btn" data-emoji="${emoji}">${emoji}</button>`).join('');
  };


  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const persistDraft = async () => {
    try {
      const attachments = await Promise.all(state.attachments.map(async (item) => ({
        name: item.file.name,
        type: item.file.type,
        size: item.file.size,
        dataUrl: await readFileAsDataUrl(item.file)
      })));
      const draft = {
        editorHtml: informeEditor.innerHTML,
        userId: informeUserSelect.value,
        importance: getImportanceValue(),
        date: informeDateInput.value,
        fontSize: fontSizeSelect.value,
        formatBlock: formatBlockSelect.value,
        textColor: textColorInput.value,
        highlightColor: highlightColorInput.value,
        attachments,
        updatedAt: Date.now()
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (error) {
      // noop
    }
  };

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
  };

  const restoreDraft = async () => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) {
      resetEditorControls();
      updatePreview();
      return;
    }
    try {
      const draft = JSON.parse(raw);
      informeEditor.innerHTML = draft.editorHtml || '';
      importanceRange.value = String(normalizeImportance(draft.importance, 50));
      if (draft.userId && state.users[draft.userId]) informeUserSelect.value = draft.userId;
      if (draft.date && datePicker) datePicker.setDate(draft.date, true, 'd/m/Y');
      if (draft.fontSize) fontSizeSelect.value = draft.fontSize;
      if (draft.formatBlock) formatBlockSelect.value = draft.formatBlock;
      if (draft.textColor) textColorInput.value = draft.textColor;
      if (draft.highlightColor) highlightColorInput.value = draft.highlightColor;

      state.attachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });

      state.attachments = await Promise.all((draft.attachments || []).map(async (item) => {
        const response = await fetch(item.dataUrl);
        const blob = await response.blob();
        const file = new File([blob], item.name, { type: item.type || blob.type });
        return {
          file,
          type: getFileCategory(file),
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
        };
      }));

      renderAttachments();
      updateImportanceLabel();
      updateToolbarState();
      updatePreview();
    } catch (error) {
      clearDraft();
    }
  };

  const openImageViewer = (index) => {
    ensureImageViewerModal();
    const images = state.viewerImages.length ? state.viewerImages : state.attachments.filter((item) => item.type === 'image');
    if (!images.length || !imageViewerModal) return;
    state.imageViewerIndex = index;
    state.viewerScale = 1;
    viewerImage.style.transform = 'scale(1)';
    viewerImage.src = images[state.imageViewerIndex].previewUrl;
    imageViewerModal.show();
  };

  const updateViewerImage = (delta) => {
    const images = state.viewerImages.length ? state.viewerImages : state.attachments.filter((item) => item.type === 'image');
    if (!images.length) return;
    state.imageViewerIndex = (state.imageViewerIndex + delta + images.length) % images.length;
    state.viewerScale = 1;
    viewerImage.style.transform = 'scale(1)';
    viewerImage.src = images[state.imageViewerIndex].previewUrl;
  };

  const setViewerScale = (value) => {
    state.viewerScale = Math.max(1, Math.min(4, value));
    viewerImage.style.transform = `scale(${state.viewerScale})`;
  };

  const validateFile = (file) => {
    if (!file) return 'Archivo vacío';
    if (file.size > MAX_UPLOAD_SIZE_BYTES) return 'Cada archivo debe pesar menos de 10MB';
    return '';
  };

  openUserFormBtn.addEventListener('click', () => openUserForm());

  informesUsersList.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-user-edit]');
    if (editBtn) {
      const user = state.users[editBtn.dataset.userEdit];
      if (!user) return;
      const keyCheck = await promptUserKey();
      if (!keyCheck.isConfirmed || keyCheck.value !== user.pin) {
        if (keyCheck.isConfirmed) {
          await openIosSwal({ title: 'Clave incorrecta', html: '<p>No coincide la clave del usuario.</p>', icon: 'error', confirmButtonText: 'Entendido' });
        }
        return;
      }
      await openUserForm(user);
      return;
    }

    const deleteBtn = event.target.closest('[data-user-delete]');
    if (deleteBtn) {
      const user = state.users[deleteBtn.dataset.userDelete];
      if (!user) return;
      const keyCheck = await promptUserKey();
      if (!keyCheck.isConfirmed || keyCheck.value !== user.pin) {
        if (keyCheck.isConfirmed) {
          await openIosSwal({ title: 'Clave incorrecta', html: '<p>No coincide la clave del usuario.</p>', icon: 'error', confirmButtonText: 'Entendido' });
        }
        return;
      }
      const confirm = await openIosSwal({ title: 'Eliminar usuario', html: `<p>Se eliminará a ${user.fullName}.</p>`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' });
      if (!confirm.isConfirmed) return;
      delete state.users[user.id];
      await window.dbLaJamoneraRest.write('/informes/users', state.users);
      renderUsers();
    }
  });

  informeUserSelect.addEventListener('change', async (event) => {
    if (event.target.value === 'create') {
      const id = await openUserForm();
      if (id) {
        informeUserSelect.value = id;
      } else {
        informeUserSelect.value = '';
      }
    }
  });

  document.querySelectorAll('.editor-btn[data-cmd]').forEach((button) => {
    button.addEventListener('click', () => applyEditorCommand(button.dataset.cmd, button.dataset.value || null));
  });

  fontSizeSelect.addEventListener('change', () => applyEditorCommand('fontSize', fontSizeSelect.value));
  formatBlockSelect.addEventListener('change', () => applyEditorCommand('formatBlock', formatBlockSelect.value));
  textColorInput.addEventListener('input', () => applyEditorCommand('foreColor', textColorInput.value));
  highlightColorInput.addEventListener('input', updatePreview);
  applyHighlightBtn.addEventListener('click', () => applyEditorCommand('hiliteColor', highlightColorInput.value));

  toggleEmojiPanel.addEventListener('click', () => {
    emojiPanel.classList.toggle('is-open');
  });

  emojiPanel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-emoji]');
    if (!button) return;
    applyEditorCommand('insertText', button.dataset.emoji);
    emojiPanel.classList.remove('is-open');
  });

  document.addEventListener('click', (event) => {
    if (!emojiPanel.classList.contains('is-open')) return;
    if (event.target.closest('.emoji-picker-wrap')) return;
    emojiPanel.classList.remove('is-open');
  });

  attachFilesBtn.addEventListener('click', () => attachmentsInput.click());
  attachmentsInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    files.forEach((file) => {
      const message = validateFile(file);
      if (message) return;
      const type = getFileCategory(file);
      const previewUrl = type === 'image' ? URL.createObjectURL(file) : '';
      state.attachments.push({ file, type, previewUrl });
    });
    event.target.value = '';
    renderAttachments();
    persistDraft();
  });

  attachmentsGrid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-view-image]');
    if (!card) return;
    const clickedIndex = Number(card.dataset.viewImage);
    const imageAttachments = state.attachments.filter((item) => item.type === 'image');
    const target = state.attachments[clickedIndex];
    const imageIndex = imageAttachments.findIndex((img) => img.previewUrl === target.previewUrl);
    if (imageIndex >= 0) {
      state.viewerImages = imageAttachments;
      openImageViewer(imageIndex);
    }
  });

  informesUsersList.addEventListener('scroll', () => {
    toggleScrollHint(informesUsersList);
  });

  saveInformeBtn.addEventListener('click', saveInforme);

  clearInformeBtn.addEventListener('click', async () => {
    const answer = await openIosSwal({
      title: 'Borrar informe',
      html: '<p>¿Qué querés borrar?</p>',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Solo texto',
      denyButtonText: 'Texto y adjuntos',
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'informes-clear-alert'
      }
    });

    if (answer.isConfirmed || answer.isDenied) {
      informeEditor.innerHTML = '';
      if (answer.isDenied) {
        state.attachments.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        state.attachments = [];
        renderAttachments();
      }
      resetEditorControls();
      applyEditorCommand('removeFormat');
      updatePreview();
      persistDraft();
    }
  });

  informeEditor.addEventListener('input', () => {
    informeEditor.querySelectorAll('.editor-plain-text').forEach((node) => {
      if (node.textContent === '\u200B') {
        node.remove();
      }
    });
    updatePreview();
    persistDraft();
  });
  informeEditor.addEventListener('keyup', updateToolbarState);
  informeEditor.addEventListener('mouseup', updateToolbarState);
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === informeEditor || informeEditor.contains(document.activeElement)) {
      updateToolbarState();
    }
  });

  importanceRange.addEventListener('input', () => { updateImportanceLabel(); persistDraft(); });

  viewerPrevBtn.addEventListener('click', () => updateViewerImage(-1));
  viewerNextBtn.addEventListener('click', () => updateViewerImage(1));
  viewerZoomInBtn.addEventListener('click', () => setViewerScale(state.viewerScale + 0.25));
  viewerZoomOutBtn.addEventListener('click', () => setViewerScale(state.viewerScale - 0.25));
  imageViewerModalEl?.addEventListener('hidden.bs.modal', async () => {
    if (!state.reopenViewerReportId) return;
    const report = findReportById(state.reopenViewerReportId);
    state.reopenViewerReportId = '';
    if (report) {
      await openReportViewer(report);
    }
  });

  viewerImage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.2 : 0.2;
    setViewerScale(state.viewerScale + delta);
  }, { passive: false });

  let pinchStartDistance = 0;
  let pinchStartScale = 1;
  viewerImage.addEventListener('touchstart', (event) => {
    if (event.touches.length === 2) {
      const [a, b] = event.touches;
      pinchStartDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchStartScale = state.viewerScale;
    }
  }, { passive: true });

  viewerImage.addEventListener('touchmove', (event) => {
    if (event.touches.length === 2) {
      const [a, b] = event.touches;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchStartDistance) {
        const ratio = distance / pinchStartDistance;
        setViewerScale(pinchStartScale * ratio);
      }
    }
  }, { passive: true });

  window.addEventListener('beforeunload', persistDraft);
  informesModal.addEventListener('hidden.bs.modal', persistDraft);
  informeUserSelect.addEventListener('change', persistDraft);
  fontSizeSelect.addEventListener('change', persistDraft);
  formatBlockSelect.addEventListener('change', persistDraft);
  textColorInput.addEventListener('change', persistDraft);
  highlightColorInput.addEventListener('change', persistDraft);

  window.laJamoneraReady.then(() => ensureInitialDataLoaded()).catch(() => setBoardState('empty'));



  if (informesPagination) {
    informesPagination.addEventListener('click', (event) => {
      const button = event.target.closest('[data-page]');
      if (!button) return;
      state.currentPage = Number(button.dataset.page || 1);
      renderReportsBoard();
    });
  }

  if (informesCardsGrid) {
    informesCardsGrid.addEventListener('click', async (event) => {
      const article = event.target.closest('.informe-card');
      if (!article) return;
      const report = findReportById(article.dataset.reportId);
      if (!report) return;

      if (event.target.closest('[data-print-report]')) {
        await printReport(report);
        return;
      }
      if (event.target.closest('[data-view-report]')) {
        await openReportViewer(report);
        return;
      }
      if (event.target.closest('[data-edit-report]')) {
        await editReport(report);
        return;
      }
      if (event.target.closest('[data-delete-report]')) {
        await deleteReport(report);
        return;
      }
      if (event.target.closest('[data-comment-report]')) {
        await addCommentToReport(report);
      }
    });
  }

  if (openFilterInformesBtn && informesFilterInput && window.flatpickr) {
    reportsFilterPicker = flatpickr(informesFilterInput, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      locale: window.flatpickr?.l10ns?.es || undefined,
      positionElement: openFilterInformesBtn,
      appendTo: openFilterInformesBtn.parentElement,
      disableMobile: true,
      onReady: (_dates, _str, fp) => {
        fp.calendarContainer.classList.add('informes-filter-calendar');
      },
      onOpen: (_dates, _str, fp) => {
        fp.redraw();
      },
      onDayCreate: (_dObj, _dStr, _fp, dayElem) => {
        const dateObj = dayElem.dateObj;
        if (!dateObj) return;
        const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        const count = state.reportDayCount[key] || 0;
        if (!count) return;
        const badge = document.createElement('span');
        badge.className = 'flatpickr-report-badge';
        badge.textContent = String(count);
        dayElem.appendChild(badge);
      },
      onClose: (selectedDates) => {
        if (selectedDates.length === 2) {
          applyDateFilter(selectedDates[0], selectedDates[1]);
        }
      }
    });

    openFilterInformesBtn.addEventListener('click', () => {
      if (reportsFilterPicker) {
        reportsFilterPicker.redraw();
        reportsFilterPicker.open();
      }
    });
  }

  if (clearFilterInformesBtn) {
    clearFilterInformesBtn.addEventListener('click', () => {
      if (reportsFilterPicker) {
        reportsFilterPicker.clear();
      }
      applyDateFilter(null, null);
    });
  }

  informesModal.addEventListener('show.bs.modal', async () => {
    if (!datePicker && window.flatpickr) {
      datePicker = flatpickr(informeDateInput, {
        dateFormat: 'd/m/Y',
        defaultDate: new Date(),
        locale: window.flatpickr.l10ns.es
      });
    }
    ensureImageViewerModal();

    renderEmojiPanel();
    updatePreview();
    updateToolbarState();
    updateImportanceLabel();
    await ensureInitialDataLoaded();
  });
})();
