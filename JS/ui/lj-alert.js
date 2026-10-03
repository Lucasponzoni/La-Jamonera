// Alertas sobre <sl-dialog> con la misma API de SweetAlert2 que usa el sitio.
// window.Swal y window.LJAlert apuntan al mismo objeto, así las ~330 llamadas existentes
// (Swal.fire / openIosSwal / openSwal / openPlanillaSwal) siguen funcionando sin reescribir su lógica.
(function ljAlert() {
  const ICONS = { success: 'check-circle', error: 'x-circle', warning: 'exclamation-triangle', info: 'info-circle', question: 'question-circle' };
  const DismissReason = Object.freeze({ cancel: 'cancel', backdrop: 'backdrop', close: 'close', esc: 'esc', timer: 'timer' });

  // Los wrappers pasan clases tipo "ios-btn ios-btn-success"; las traducimos a variantes de sl-button.
  const variantFrom = (cls, fallback) => {
    const c = String(cls || '');
    if (/deny-critical|danger|error/.test(c)) return 'danger';
    if (/success/.test(c)) return 'success';
    if (/warning/.test(c)) return 'warning';
    if (/primary/.test(c)) return 'primary';
    if (/secondary|default|light|neutral/.test(c)) return 'default';
    return fallback;
  };
  // Clases de botón que no son de estilo legacy (se conservan para selectores/CSS existentes).
  const extraClasses = (cls) => String(cls || '').split(/\s+/).filter((c) => c && !/^(btn|ios-btn.*|swal2-.*)$/.test(c));
  const setContent = (el, value) => {
    if (value instanceof Node) { el.replaceChildren(value); return; }
    el.innerHTML = value == null ? '' : String(value);
  };

  let current = null;

  const makeButton = (role, text, variant, extra) => {
    const b = document.createElement('sl-button');
    b.variant = variant;
    b.className = ['lj-alert-btn', `lj-alert-${role}`, `swal2-${role}`, ...extra].join(' ');
    b.textContent = text;
    b.dataset.ljAlertRole = role;
    return b;
  };

  const render = (state) => {
    const { opts, popup } = state;
    const cc = opts.customClass || {};
    // Clases swal2-* además de las propias: el CSS de los módulos sigue apuntando a esa estructura.
    popup.className = ['lj-alert', 'swal2-popup', ...String(cc.popup || '').split(/\s+/).filter(Boolean)].join(' ');
    popup.replaceChildren();

    if (opts.icon && ICONS[opts.icon]) {
      const icon = document.createElement('div');
      icon.className = `lj-alert-icon swal2-icon is-${opts.icon}`;
      icon.innerHTML = `<sl-icon name="${ICONS[opts.icon]}"></sl-icon>`;
      popup.append(icon);
    }
    if (opts.title != null && opts.title !== '') {
      const title = document.createElement('h2');
      title.className = ['lj-alert-title', 'swal2-title', cc.title].filter(Boolean).join(' ');
      title.id = `lj-alert-title-${state.id}`;
      setContent(title, opts.title);
      popup.append(title);
      state.title = title;
    } else state.title = null;

    const html = document.createElement('div');
    html.className = ['lj-alert-html', 'swal2-html-container', cc.htmlContainer].filter(Boolean).join(' ');
    if (opts.html != null) setContent(html, opts.html); else if (opts.text != null) html.textContent = String(opts.text);
    if (html.childNodes.length) popup.append(html);
    state.html = html;

    state.input = null;
    if (opts.input) {
      const tag = opts.input === 'textarea' ? 'sl-textarea' : 'sl-input';
      const input = document.createElement(tag);
      if (tag === 'sl-input') input.type = ['password', 'email', 'number', 'tel', 'url', 'search'].includes(opts.input) ? opts.input : 'text';
      if (opts.input === 'password') input.passwordToggle = true;
      input.className = ['swal2-input', 'lj-alert-input', opts.inputClass].filter(Boolean).join(' ');
      if (opts.inputLabel) input.label = opts.inputLabel;
      if (opts.inputPlaceholder) input.placeholder = opts.inputPlaceholder;
      if (opts.inputValue != null) input.value = String(opts.inputValue);
      Object.entries(opts.inputAttributes || {}).forEach(([k, v]) => input.setAttribute(k, v));
      popup.append(input);
      state.input = input;
    }

    const validation = document.createElement('div');
    validation.className = 'lj-alert-validation swal2-validation-message';
    validation.setAttribute('role', 'alert');
    validation.hidden = true;
    popup.append(validation);
    state.validation = validation;

    const actions = document.createElement('div');
    actions.className = 'lj-alert-actions swal2-actions';
    const buttons = [];
    state.confirm = state.deny = state.cancel = null;
    if (opts.showConfirmButton !== false) {
      state.confirm = makeButton('confirm', opts.confirmButtonText ?? 'OK', variantFrom(cc.confirmButton, 'primary'), extraClasses(cc.confirmButton));
      buttons.push(state.confirm);
    }
    if (opts.showDenyButton) {
      state.deny = makeButton('deny', opts.denyButtonText ?? 'No', variantFrom(cc.denyButton, 'warning'), extraClasses(cc.denyButton));
      buttons.push(state.deny);
    }
    if (opts.showCancelButton) {
      state.cancel = makeButton('cancel', opts.cancelButtonText ?? 'Cancelar', variantFrom(cc.cancelButton, 'default'), extraClasses(cc.cancelButton));
      buttons.push(state.cancel);
    }
    if (opts.reverseButtons) buttons.reverse();
    actions.append(...buttons);
    if (buttons.length) popup.append(actions);
    state.actions = actions;
  };

  const finish = (state, result) => {
    if (!state || state.done) return;
    state.done = true;
    if (current === state) current = null;
    clearTimeout(state.timer);
    try { state.opts.willClose?.(state.popup); } catch (e) { console.error(e); }
    state.resolve({ isConfirmed: false, isDenied: false, isDismissed: false, value: undefined, ...result });
    const { dialog } = state;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      dialog.remove();
      try { state.opts.didClose?.(); } catch (e) { console.error(e); }
    };
    if (dialog.open) {
      dialog.addEventListener('sl-after-hide', (event) => { if (event.target === dialog) cleanup(); });
      dialog.hide();
      // Si se cerró en medio de la animación de apertura, sl-after-hide puede no llegar.
      setTimeout(cleanup, 1500);
    } else cleanup();
  };

  const inputValue = (state) => {
    if (!state.input) return undefined;
    return state.input.value;
  };

  const setLoading = (state, on) => {
    state.loading = on;
    [state.confirm, state.deny, state.cancel].forEach((b) => { if (b) b.disabled = on; });
    if (state.confirm) state.confirm.loading = on;
    state.popup.classList.toggle('is-loading', on);
    if (on && !state.confirm) {
      if (!state.spinner) {
        state.spinner = document.createElement('sl-spinner');
        state.spinner.className = 'lj-alert-spinner';
      }
      state.popup.insertBefore(state.spinner, state.validation);
    } else state.spinner?.remove();
  };

  const runAction = async (state, kind) => {
    if (state.done || state.loading) return;
    const hook = kind === 'confirm' ? state.opts.preConfirm : state.opts.preDeny;
    let value = kind === 'confirm' ? (inputValue(state) ?? true) : false;
    if (typeof hook === 'function') {
      state.validation.hidden = true;
      setLoading(state, true);
      try {
        const out = await hook(kind === 'confirm' ? inputValue(state) : false);
        if (state.done) return;
        setLoading(state, false);
        if (out === false || !state.validation.hidden) return;
        if (out !== undefined) value = out;
      } catch (error) {
        if (state.done) return;
        setLoading(state, false);
        api.showValidationMessage(error?.message || String(error));
        return;
      }
    }
    finish(state, kind === 'confirm' ? { isConfirmed: true, value } : { isDenied: true, value });
  };

  const fire = (...args) => {
    let opts = args[0];
    if (typeof opts !== 'object' || opts === null) opts = { title: args[0], html: args[1], icon: args[2] };
    opts = { ...opts };
    if (current) finish(current, { isDismissed: true, dismiss: DismissReason.close });

    return new Promise((resolve) => {
      const dialog = document.createElement('sl-dialog');
      dialog.className = 'lj-alert-dialog';
      dialog.noHeader = true;
      dialog.setAttribute('no-header', '');
      const width = opts.width;
      if (width != null && width !== '') dialog.style.setProperty('--width', typeof width === 'number' ? `${width}px` : String(width));
      const popup = document.createElement('div');
      dialog.append(popup);
      const state = { id: Math.random().toString(36).slice(2, 8), dialog, popup, opts, resolve, done: false, loading: false };
      render(state);
      if (state.title) dialog.label = state.title.textContent.trim();

      popup.addEventListener('click', (event) => {
        const btn = event.target.closest?.('[data-lj-alert-role]');
        if (!btn || btn.disabled) return;
        const role = btn.dataset.ljAlertRole;
        if (role === 'cancel') finish(state, { isDismissed: true, dismiss: DismissReason.cancel });
        else runAction(state, role);
      });
      // Enter dentro de un input confirma, como SweetAlert.
      popup.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        const host = event.target.closest?.('sl-input, input');
        if (!host || host.closest('sl-textarea, textarea')) return;
        if (state.confirm && host === state.input) { event.preventDefault(); runAction(state, 'confirm'); }
      });
      dialog.addEventListener('sl-request-close', (event) => {
        if (event.target !== dialog) return;
        const source = event.detail?.source;
        const allowOutside = typeof opts.allowOutsideClick === 'function' ? opts.allowOutsideClick() : opts.allowOutsideClick !== false;
        const allowEsc = typeof opts.allowEscapeKey === 'function' ? opts.allowEscapeKey() : opts.allowEscapeKey !== false;
        event.preventDefault();
        if (!state.loading) {
          if (source === 'overlay' && allowOutside) { finish(state, { isDismissed: true, dismiss: DismissReason.backdrop }); return; }
          if (source === 'keyboard' && allowEsc) { finish(state, { isDismissed: true, dismiss: DismissReason.esc }); return; }
          if (source === 'close-button') { finish(state, { isDismissed: true, dismiss: DismissReason.close }); return; }
        }
        // Cierre no permitido: Shoelace ya consumió el CloseWatcher, hay que re-armarlo.
        if (source === 'keyboard') setTimeout(() => { if (dialog.open && typeof dialog.addOpenListeners === 'function') dialog.addOpenListeners(); }, 0);
      });
      dialog.addEventListener('sl-after-show', (event) => {
        if (event.target !== dialog || state.done) return;
        try { opts.didRender?.(popup); opts.didOpen?.(popup); } catch (e) { console.error(e); }
        if (state.input) state.input.focus();
      });
      // Sin foco automático en el primer control: igual que SweetAlert, foco en confirmar.
      dialog.addEventListener('sl-initial-focus', (event) => {
        if (event.target !== dialog) return;
        event.preventDefault();
        (state.input || state.confirm || state.cancel || popup).focus?.();
      });

      current = state;
      document.body.append(dialog);
      try { opts.willOpen?.(popup); } catch (e) { console.error(e); }
      customElements.whenDefined('sl-dialog').then(() => { if (!state.done) dialog.show(); });
      if (opts.timer) state.timer = setTimeout(() => finish(state, { isDismissed: true, dismiss: DismissReason.timer }), Number(opts.timer));
    });
  };

  const api = {
    fire,
    DismissReason,
    close(result) {
      if (!current) return;
      finish(current, result && typeof result === 'object' ? result : { isDismissed: true, dismiss: DismissReason.close });
    },
    isVisible: () => Boolean(current),
    getPopup: () => current?.popup || null,
    getHtmlContainer: () => current?.html || null,
    getTitle: () => current?.title || null,
    getConfirmButton: () => current?.confirm || null,
    getDenyButton: () => current?.deny || null,
    getCancelButton: () => current?.cancel || null,
    getInput: () => current?.input || null,
    getValidationMessage: () => current?.validation || null,
    showValidationMessage(message) {
      if (!current) return;
      current.validation.innerHTML = message == null ? '' : String(message);
      current.validation.hidden = false;
    },
    resetValidationMessage() {
      if (!current) return;
      current.validation.hidden = true;
      current.validation.textContent = '';
    },
    showLoading() { if (current) setLoading(current, true); },
    hideLoading() { if (current) setLoading(current, false); },
    isLoading: () => Boolean(current?.loading),
    clickConfirm() { if (current) runAction(current, 'confirm'); },
    clickDeny() { if (current) runAction(current, 'deny'); },
    clickCancel() { if (current) finish(current, { isDismissed: true, dismiss: DismissReason.cancel }); },
    enableButtons() { [current?.confirm, current?.deny, current?.cancel].forEach((b) => { if (b) b.disabled = false; }); },
    disableButtons() { [current?.confirm, current?.deny, current?.cancel].forEach((b) => { if (b) b.disabled = true; }); },
    update(patch = {}) {
      if (!current) return;
      const keepValue = inputValue(current);
      current.opts = { ...current.opts, ...patch };
      render(current);
      if (current.input && keepValue != null && !('inputValue' in patch)) current.input.value = keepValue;
    },
    mixin(defaults = {}) {
      return { ...api, fire: (opts = {}) => fire({ ...defaults, ...opts, customClass: { ...(defaults.customClass || {}), ...(opts.customClass || {}) } }) };
    }
  };

  window.LJAlert = api;
  window.Swal = api;
})();
