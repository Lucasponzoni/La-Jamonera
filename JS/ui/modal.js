// Modales sobre <sl-dialog>. Reemplaza a bootstrap.Modal y a los eventos *.bs.modal.
// Los sl-* hijos (dropdown, tooltip, select) también emiten sl-show/sl-hide y burbujean:
// por eso todo handler se filtra con event.target === dialog.
(function ljModal() {
  const resolve = (x) => (typeof x === 'string' ? document.getElementById(x.replace(/^#/, '')) : x);
  const EVENTS = { show: 'sl-show', shown: 'sl-after-show', hide: 'sl-hide', hidden: 'sl-after-hide' };
  const closing = new WeakSet();
  const isDialogEvent = (event) => event.target?.tagName === 'SL-DIALOG';
  document.addEventListener('sl-hide', (event) => { if (isDialogEvent(event)) closing.add(event.target); }, true);
  document.addEventListener('sl-after-hide', (event) => { if (isDialogEvent(event)) closing.delete(event.target); }, true);

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
    topOpen() {
      const open = [...document.querySelectorAll('sl-dialog[open]')];
      return open[open.length - 1] || null;
    }
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

  // Igual que con Bootstrap no se pierden borradores por un clic accidental fuera del modal.
  document.addEventListener('sl-request-close', (event) => {
    const dialog = event.target;
    if (dialog?.tagName === 'SL-DIALOG' && dialog.classList.contains('lj-modal') && event.detail?.source === 'overlay') {
      event.preventDefault();
    }
  });
})();
