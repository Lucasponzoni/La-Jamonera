// Modales sobre <sl-dialog>. Reemplaza a bootstrap.Modal y a los eventos *.bs.modal.
// Los sl-* hijos (dropdown, tooltip, select) también emiten sl-show/sl-hide y burbujean:
// por eso todo handler se filtra con event.target === dialog.
(function ljModal() {
  const resolve = (x) => (typeof x === 'string' ? document.getElementById(x.replace(/^#/, '')) : x);
  const EVENTS = { show: 'sl-show', shown: 'sl-after-show', hide: 'sl-hide', hidden: 'sl-after-hide' };
  const closing = new WeakSet();
  // Pila por orden de apertura (el orden del DOM no sirve: el visor de imágenes está antes que producción).
  const stack = [];
  const isDialogEvent = (event) => event.target?.tagName === 'SL-DIALOG';
  document.addEventListener('sl-show', (event) => {
    if (!isDialogEvent(event)) return;
    const i = stack.indexOf(event.target);
    if (i >= 0) stack.splice(i, 1);
    stack.push(event.target);
  }, true);
  document.addEventListener('sl-hide', (event) => {
    if (!isDialogEvent(event)) return;
    closing.add(event.target);
    const i = stack.indexOf(event.target);
    if (i >= 0) stack.splice(i, 1);
  }, true);
  document.addEventListener('sl-after-hide', (event) => { if (isDialogEvent(event)) closing.delete(event.target); }, true);
  const top = () => {
    for (let i = stack.length - 1; i >= 0; i -= 1) if (stack[i].isConnected && stack[i].open) return stack[i];
    return null;
  };
  // Cuando se cancela un cierre, Shoelace ya consumió su CloseWatcher: lo volvemos a armar
  // para que Escape siga funcionando después en ese dialog.
  const rearm = (dialog) => setTimeout(() => { if (dialog.open && typeof dialog.addOpenListeners === 'function') dialog.addOpenListeners(); }, 0);
  window.ljDialogRearm = rearm;
  // Chrome agrupa los CloseWatcher creados sin interacción del usuario en el medio: un Escape
  // cerraría todos los dialogs del grupo. Sólo dejamos cerrar por teclado al de arriba de la pila.
  // El grupo dispara todos los cierres en la misma tarea: el primero (el de arriba) se procesa y
  // los siguientes del mismo Escape (< 150 ms) se descartan aunque para entonces ya sean "el de arriba".
  let lastKeyboardClose = { at: 0, dialog: null };
  document.addEventListener('sl-request-close', (event) => {
    const dialog = event.target;
    if (dialog?.tagName !== 'SL-DIALOG' || event.detail?.source !== 'keyboard') return;
    const sameEscape = Date.now() - lastKeyboardClose.at < 150 && lastKeyboardClose.dialog !== dialog;
    if (sameEscape || (top() && top() !== dialog)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      rearm(dialog);
      return;
    }
    lastKeyboardClose = { at: Date.now(), dialog };
  }, true);

  window.LJModal = {
    get: resolve,
    open(x) {
      const dialog = resolve(x);
      if (dialog && !dialog.open) dialog.show();
      return dialog;
    },
    close(x) {
      const dialog = resolve(x);
      if (dialog && dialog.open) {
        closing.add(dialog);
        dialog.hide();
      }
      return dialog;
    },
    isOpen(x) {
      return Boolean(resolve(x)?.open);
    },
    // Contenedor con scroll propio dentro del dialog (reemplaza a .modal-body).
    body(x) {
      const dialog = resolve(x);
      return dialog?.querySelector(':scope > .lj-dialog-body') || dialog;
    },
    on(x, kind, fn, opts = {}) {
      const dialog = resolve(x);
      if (!dialog) return () => {};
      const type = EVENTS[kind] || kind;
      const handler = (event) => {
        if (event.target !== dialog) return;
        if (opts.once) dialog.removeEventListener(type, handler);
        fn(event);
      };
      dialog.addEventListener(type, handler);
      return () => dialog.removeEventListener(type, handler);
    },
    // Resuelve cuando terminó la animación de cierre. hide() pone open=false al instante,
    // así que también esperamos si el dialog está "cerrándose".
    async onceClosed(x) {
      const dialog = resolve(x);
      if (!dialog) return;
      // Si alguien llamó dialog.hide() directo, sl-hide se emite en el próximo ciclo de actualización.
      if (!dialog.open && !closing.has(dialog)) await dialog.updateComplete;
      if (!dialog.open && !closing.has(dialog)) return;
      await new Promise((done) => this.on(dialog, 'hidden', () => done(), { once: true }));
    },
    topOpen: () => top()
  };

  document.addEventListener('click', (event) => {
    const opener = event.target.closest?.('[data-lj-open]');
    if (opener) {
      event.preventDefault();
      window.LJModal.open(opener.getAttribute('data-lj-open'));
      return;
    }
    const closer = event.target.closest?.('[data-lj-close]');
    if (closer) window.LJModal.close(closer.closest('sl-dialog'));
  });

  // Al abrir, Shoelace enfoca el primer control (p.ej. el campo de comentarios al pie) y el cuerpo
  // baja hasta él. Los modales abren arriba de todo: foco en el panel sin scroll, salvo [autofocus].
  document.addEventListener('sl-initial-focus', (event) => {
    const dialog = event.target;
    if (dialog?.tagName !== 'SL-DIALOG' || !dialog.classList.contains('lj-modal')) return;
    if (dialog.querySelector('[autofocus]')) return;
    event.preventDefault();
    dialog.shadowRoot?.querySelector('[part~="panel"]')?.focus({ preventScroll: true });
    const toTop = () => {
      dialog.shadowRoot?.querySelector('[part~="body"]')?.scrollTo?.(0, 0);
      dialog.querySelectorAll('.lj-dialog-body').forEach((el) => { el.scrollTop = 0; });
    };
    toTop();
    requestAnimationFrame(toTop);
  });

  // Clic fuera del modal: lo cierra, pero sólo al de arriba de la pila (y nunca si el modal
  // pide quedarse abierto con data-lj-static, p.ej. mientras guarda).
  document.addEventListener('sl-request-close', (event) => {
    const dialog = event.target;
    if (dialog?.tagName !== 'SL-DIALOG' || !dialog.classList.contains('lj-modal') || event.detail?.source !== 'overlay') return;
    if (dialog.hasAttribute('data-lj-static') || (top() && top() !== dialog)) event.preventDefault();
  });
})();
