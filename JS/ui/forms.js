(function ljForms() {
  // sl-change no sale como 'change' nativo: lo re-despachamos para que los listeners existentes sigan andando.
  document.addEventListener('sl-change', (event) => {
    const host = event.target;
    if (!host || !host.tagName || !host.tagName.startsWith('SL-')) return;
    if (!['SL-INPUT', 'SL-SELECT', 'SL-TEXTAREA', 'SL-CHECKBOX', 'SL-SWITCH', 'SL-RADIO-GROUP', 'SL-RANGE', 'SL-RATING', 'SL-COLOR-PICKER'].includes(host.tagName)) return;
    host.dispatchEvent(new Event('change', { bubbles: true }));
  }, true);

  const ENC = '~';
  // encodeURIComponent no escapa '~', así que primero lo pasamos a %7E y después todo '%' a '~'.
  window.ljOptionValue = (raw) => encodeURIComponent(String(raw ?? '')).replace(/~/g, '%7E').replace(/%/g, ENC);
  const decode = (v) => decodeURIComponent(String(v ?? '').replace(new RegExp(ENC, 'g'), '%'));
  window.ljSelectValue = (el) => {
    if (!el) return '';
    const v = el.value;
    if (el.tagName === 'SL-SELECT') return Array.isArray(v) ? v.map(decode) : decode(v);
    return v;
  };
  window.ljSetSelectValue = (el, raw) => {
    if (!el) return;
    el.value = el.tagName === 'SL-SELECT' ? (Array.isArray(raw) ? raw.map(window.ljOptionValue) : window.ljOptionValue(raw)) : raw;
  };
  window.ljReady = async (root = document) => {
    const tags = new Set([...(root.querySelectorAll ? root.querySelectorAll('*') : [])].map((n) => n.localName).filter((t) => t.startsWith('sl-')));
    await Promise.all([...tags].map((t) => customElements.whenDefined(t)));
    await Promise.all([...root.querySelectorAll([...tags].join(',') || 'sl-none')].map((n) => n.updateComplete));
  };
  window.ljNativeInput = (el) => {
    if (!el) return null;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el;
    return el.input || el.shadowRoot?.querySelector('input,textarea') || null;
  };
  window.ljFlatpickr = (el, opts) => window.flatpickr(window.ljNativeInput(el) || el, opts);

  // Buscadores: el navegador los tomaba por el campo "usuario" del login y los autocompletaba con el
  // email guardado (el filtro quedaba vacío). Les sacamos el autocompletado a todos, también a los
  // que se crean después (listas que se re-renderizan).
  const SEARCH_SEL = 'sl-input[type="search"], sl-input[placeholder^="Buscar" i], input[type="search"], input[placeholder^="Buscar" i]';
  const noAutofill = (el) => {
    if (el.dataset.ljNoAutofill) return;
    el.dataset.ljNoAutofill = '1';
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('spellcheck', 'false');
    if (!el.getAttribute('name')) el.setAttribute('name', `lj-search-${Math.random().toString(36).slice(2, 8)}`);
    el.setAttribute('data-lpignore', 'true');
    el.setAttribute('data-1p-ignore', '');
    // Si el navegador ya lo rellenó al cargar (antes de este script), lo vaciamos.
    if (el.value && /@/.test(String(el.value)) && !el.dataset.ljTyped) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Autocompletado posterior (p.ej. al abrir un formulario con campo de clave): un email que
    // aparece sin que se haya tecleado ni pegado nada se descarta.
    const guard = () => {
      if (el.dataset.ljTyped || !/@/.test(String(el.value || ''))) return;
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    el.addEventListener('sl-input', guard);
    el.addEventListener('input', guard);
    el.addEventListener('change', guard);
  };
  // Campos de clave fuera del login (PIN de usuarios, claves de API): que el navegador no los tome
  // por un login ni ofrezca la contraseña guardada.
  const PASS_SEL = 'sl-input[type="password"], input[type="password"]';
  const noPasswordFill = (el) => {
    if (document.documentElement.classList.contains('login-protected') || el.dataset.ljNoPassFill) return;
    el.dataset.ljNoPassFill = '1';
    el.setAttribute('autocomplete', 'new-password');
    el.setAttribute('data-lpignore', 'true');
    el.setAttribute('data-1p-ignore', '');
    if (!el.getAttribute('name')) el.setAttribute('name', `lj-secret-${Math.random().toString(36).slice(2, 8)}`);
  };
  const scan = (root) => {
    if (!root.querySelectorAll) return;
    root.querySelectorAll(SEARCH_SEL).forEach(noAutofill);
    root.querySelectorAll(PASS_SEL).forEach(noPasswordFill);
  };
  const markTyped = (e) => { const t = e.target.closest?.(SEARCH_SEL); if (t) t.dataset.ljTyped = '1'; };
  document.addEventListener('keydown', markTyped, true);
  document.addEventListener('paste', markTyped, true);
  const start = () => {
    scan(document);
    new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.matches?.(SEARCH_SEL)) noAutofill(n);
      if (n.matches?.(PASS_SEL)) noPasswordFill(n);
      scan(n);
    }))).observe(document.body, { childList: true, subtree: true });
    // Autocompletado tardío del navegador (llega después de la carga).
    setTimeout(() => document.querySelectorAll(SEARCH_SEL).forEach((el) => { delete el.dataset.ljNoAutofill; noAutofill(el); }), 1200);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
