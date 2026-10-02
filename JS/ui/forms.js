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
})();
