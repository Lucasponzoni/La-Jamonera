// Configuración del sitio: claves de Google Gemini (IA) y Resend (correo).
// Las claves se guardan sólo en el servidor (Cloud Function → RTDB /_secure/*); el navegador
// recibe el estado y la clave enmascarada, nunca la clave completa.
(function configuracionModule() {
  const DIALOG_ID = 'configuracionModal';
  // Valores iniciales; "Obtener modelos" trae la lista real de la cuenta de Google.
  let TEXT_MODELS = [
    { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
  ];
  let IMAGE_MODELS = [
    { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image (Nano Banana 2)' },
    { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' }
  ];

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const notify = (type, title, message) => window.laJamoneraNotify?.show({ type, title, message });

  const ERRORS = {
    ia_key_missing: 'Todavía no hay una clave de Gemini guardada.',
    email_key_missing: 'Todavía no hay una clave de Resend guardada.',
    email_config_incomplete: 'Falta el correo remitente. Completalo y guardá.',
    admin_required: 'Sólo un administrador puede ver y cambiar la configuración.',
    invalid_key: 'La clave no tiene el formato esperado.',
    invalid_email: 'El correo remitente no es válido.',
    missing_token: 'Tu sesión expiró. Volvé a iniciar sesión.',
    invalid_token: 'Tu sesión expiró. Volvé a iniciar sesión.'
  };
  const errorText = (body, res) => ERRORS[body?.error] || body?.error || `Error ${res?.status || ''}`.trim();

  const api = async (method, path, body) => {
    const proxy = window.laJamoneraProxy;
    if (!proxy) throw new Error('El servidor no está disponible.');
    const res = method === 'GET' ? await proxy.getJson(path) : await proxy.postJson(path, body);
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.ok === false) {
      if (res.status === 404) throw new Error('El servidor todavía no tiene esta función. Falta publicar la Cloud Function.');
      throw new Error(errorText(json, res));
    }
    return json || {};
  };

  const optionsHtml = (list) => list.map((m) => `<sl-option value="${esc(window.ljOptionValue ? window.ljOptionValue(m.value) : m.value)}">${esc(m.label)}</sl-option>`).join('');
  const selectValue = (el) => (window.ljSelectValue ? window.ljSelectValue(el) : el.value);
  const setSelect = (el, value) => (window.ljSetSelectValue ? window.ljSetSelectValue(el, value) : (el.value = value));

  const template = () => `
    <sl-dialog id="${DIALOG_ID}" class="lj-modal config-modal">
      <div slot="label" class="lj-dialog-title"><h5 class="lj-dialog-heading">Configuración</h5></div>
      <div class="lj-dialog-body">
        <p class="config-intro">Las claves se guardan sólo en el servidor: acá ves el principio y el final, nunca la clave completa.</p>
        <div class="config-grid">
          <section class="config-card" data-config="ai" aria-labelledby="configAiTitle">
            <header class="config-card-head">
              <img src="./IMG/gemini.webp" alt="" class="config-logo" width="36" height="36">
              <div class="config-card-titles">
                <h6 id="configAiTitle">Inteligencia artificial</h6>
                <p>Google Gemini · informes, recetas, inventario e imágenes</p>
              </div>
              <sl-tag size="small" class="config-status" data-status>Cargando</sl-tag>
            </header>
            <dl class="config-facts">
              <div><dt>Clave actual</dt><dd data-key-masked>—</dd></div>
              <div><dt>Actualizada</dt><dd data-updated>—</dd></div>
            </dl>
            <div class="config-fields">
              <sl-input type="password" password-toggle autocomplete="off" spellcheck="false" label="Nueva clave de API" placeholder="Pegá la clave de Google AI Studio" help-text="Dejala vacía para mantener la actual." data-field="apiKey">
                <i slot="prefix" class="fa-solid fa-key"></i>
              </sl-input>
              <sl-select label="Modelo de texto" data-field="textModel" hoist>${optionsHtml(TEXT_MODELS)}</sl-select>
              <sl-select label="Modelo de imágenes" data-field="imageModel" hoist>${optionsHtml(IMAGE_MODELS)}</sl-select>
            </div>
            <p class="config-result" data-result hidden></p>
            <footer class="config-actions">
              <sl-button variant="default" data-action="models"><i slot="prefix" class="fa-solid fa-arrows-rotate"></i>Obtener modelos</sl-button>
              <sl-button variant="default" data-action="test"><i slot="prefix" class="fa-solid fa-plug-circle-check"></i>Probar conexión</sl-button>
              <sl-button variant="primary" data-action="save"><i slot="prefix" class="fa-solid fa-floppy-disk"></i>Guardar</sl-button>
            </footer>
          </section>

          <section class="config-card" data-config="email" aria-labelledby="configEmailTitle">
            <header class="config-card-head">
              <span class="config-logo config-logo-resend"><img src="./IMG/Resend.svg" alt="" width="22" height="22"></span>
              <div class="config-card-titles">
                <h6 id="configEmailTitle">Correo electrónico</h6>
                <p>Resend · avisos y envíos por mail</p>
              </div>
              <sl-tag size="small" class="config-status" data-status>Cargando</sl-tag>
            </header>
            <dl class="config-facts">
              <div><dt>Clave actual</dt><dd data-key-masked>—</dd></div>
              <div><dt>Actualizada</dt><dd data-updated>—</dd></div>
            </dl>
            <div class="config-fields">
              <sl-input type="password" password-toggle autocomplete="off" spellcheck="false" label="Nueva clave de API" placeholder="re_..." help-text="Dejala vacía para mantener la actual." data-field="apiKey">
                <i slot="prefix" class="fa-solid fa-key"></i>
              </sl-input>
              <sl-input type="email" label="Correo remitente" placeholder="avisos@tudominio.com" help-text="Debe ser de un dominio verificado en Resend." data-field="fromEmail">
                <i slot="prefix" class="fa-solid fa-at"></i>
              </sl-input>
              <sl-input label="Nombre del remitente" placeholder="La Jamonera" data-field="fromName">
                <i slot="prefix" class="fa-solid fa-signature"></i>
              </sl-input>
            </div>
            <p class="config-result" data-result hidden></p>
            <footer class="config-actions">
              <sl-button variant="default" data-action="test"><i slot="prefix" class="fa-solid fa-paper-plane"></i>Enviar prueba</sl-button>
              <sl-button variant="primary" data-action="save"><i slot="prefix" class="fa-solid fa-floppy-disk"></i>Guardar</sl-button>
            </footer>
          </section>
        </div>
      </div>
    </sl-dialog>`;

  const field = (card, name) => card.querySelector(`[data-field="${name}"]`);

  // Rehace las opciones de un select manteniendo (o agregando) el valor actual.
  const fillSelect = (el, list, value) => {
    const items = list.some((m) => m.value === value) || !value ? list : [{ value, label: value }, ...list];
    el.innerHTML = optionsHtml(items);
    setSelect(el, value || (items[0] && items[0].value) || '');
  };
  const modelLabel = (m, latestId) => `${m.name}${m.preview ? ' · preview' : ''}${m.id === latestId ? ' · más nuevo' : ''}`;

  const setResult = (card, type, text) => {
    const el = card.querySelector('[data-result]');
    el.hidden = !text;
    el.className = `config-result is-${type}`;
    el.innerHTML = text ? `<i class="fa-solid ${type === 'ok' ? 'fa-circle-check' : 'fa-circle-exclamation'}" aria-hidden="true"></i><span>${esc(text)}</span>` : '';
  };

  const paint = (card, cfg) => {
    const tag = card.querySelector('[data-status]');
    const missingSender = card.dataset.config === 'email' && cfg.hasKey && !cfg.hasSender;
    tag.variant = cfg.configured ? 'success' : 'warning';
    tag.textContent = cfg.configured ? 'Configurado' : (missingSender ? 'Falta remitente' : 'Sin configurar');
    card.querySelector('[data-key-masked]').textContent = cfg.keyMasked || 'Sin clave';
    const by = cfg.updatedBy ? ` · ${cfg.updatedBy}` : '';
    card.querySelector('[data-updated]').textContent = cfg.updatedAt ? `${fmtDate(cfg.updatedAt)}${by}` : '—';
    field(card, 'apiKey').value = '';
    if (card.dataset.config === 'ai') {
      fillSelect(field(card, 'textModel'), TEXT_MODELS, cfg.textModel || TEXT_MODELS[0].value);
      fillSelect(field(card, 'imageModel'), IMAGE_MODELS, cfg.imageModel || IMAGE_MODELS[0].value);
    } else {
      field(card, 'fromEmail').value = cfg.fromEmail || '';
      field(card, 'fromName').value = cfg.fromName || '';
    }
  };

  const paintError = (card, error) => {
    const tag = card.querySelector('[data-status]');
    tag.variant = 'neutral';
    tag.textContent = 'Sin datos';
    setResult(card, 'error', error.message);
  };

  const withBusy = async (button, fn) => {
    button.loading = true;
    try { return await fn(); } finally { button.loading = false; }
  };

  const load = async (dialog) => {
    const [ai, email] = ['ai', 'email'].map((k) => dialog.querySelector(`[data-config="${k}"]`));
    setResult(ai, 'ok', '');
    setResult(email, 'ok', '');
    await Promise.all([
      api('GET', '/config/ai').then((cfg) => paint(ai, cfg)).catch((e) => paintError(ai, e)),
      api('GET', '/config/email').then((cfg) => paint(email, cfg)).catch((e) => paintError(email, e))
    ]);
  };

  const collect = (card) => {
    const apiKey = String(field(card, 'apiKey').value || '').trim();
    if (card.dataset.config === 'ai') {
      return { apiKey, textModel: selectValue(field(card, 'textModel')), imageModel: selectValue(field(card, 'imageModel')) };
    }
    return { apiKey, fromEmail: String(field(card, 'fromEmail').value || '').trim(), fromName: String(field(card, 'fromName').value || '').trim() };
  };

  const validate = (card, data) => {
    if (card.dataset.config === 'ai' && data.apiKey && data.apiKey.length < 20) return 'La clave de Gemini parece incompleta.';
    if (card.dataset.config === 'email') {
      if (data.apiKey && !/^re_\w{8,}/.test(data.apiKey)) return 'La clave de Resend empieza con "re_".';
      if (data.fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.fromEmail)) return 'El correo remitente no es válido.';
    }
    return '';
  };

  const onAction = async (card, action, button) => {
    const kind = card.dataset.config;
    if (action === 'save') {
      const data = collect(card);
      const invalid = validate(card, data);
      if (invalid) return setResult(card, 'error', invalid);
      await withBusy(button, async () => {
        try {
          const cfg = await api('POST', `/config/${kind}`, data);
          paint(card, cfg);
          setResult(card, 'ok', 'Configuración guardada.');
          notify('success', 'Configuración guardada', kind === 'ai' ? 'Gemini quedó listo para usar.' : 'Resend quedó listo para enviar correos.');
        } catch (error) {
          setResult(card, 'error', error.message);
        }
      });
      return;
    }
    if (action === 'models') {
      await withBusy(button, async () => {
        try {
          const out = await api('GET', '/config/ai/models');
          TEXT_MODELS = out.text.map((m) => ({ value: m.id, label: modelLabel(m, out.latestText) }));
          IMAGE_MODELS = out.image.map((m) => ({ value: m.id, label: modelLabel(m, out.latestImage) }));
          fillSelect(field(card, 'textModel'), TEXT_MODELS, out.latestText);
          fillSelect(field(card, 'imageModel'), IMAGE_MODELS, out.latestImage);
          const same = out.current && out.current.textModel === out.latestText && out.current.imageModel === out.latestImage;
          setResult(card, 'ok', same
            ? `Ya usás los más nuevos: ${out.latestText} e ${out.latestImage}.`
            : `Encontré ${out.text.length} modelos de texto y ${out.image.length} de imágenes. Seleccioné los más nuevos (${out.latestText} e ${out.latestImage}); tocá Guardar para aplicarlos.`);
        } catch (error) {
          setResult(card, 'error', error.message);
        }
      });
      return;
    }
    if (action === 'test') {
      await withBusy(button, async () => {
        try {
          const out = await api('POST', `/config/${kind}/test`, {});
          setResult(card, 'ok', kind === 'ai'
            ? `Conexión correcta con ${out.model || 'Gemini'} (${out.ms} ms).`
            : `Correo de prueba enviado a ${out.to || 'tu casilla'}.`);
        } catch (error) {
          setResult(card, 'error', error.message);
        }
      });
    }
  };

  const ensureDialog = () => {
    let dialog = document.getElementById(DIALOG_ID);
    if (dialog) return dialog;
    const holder = document.createElement('div');
    holder.innerHTML = template().trim();
    dialog = holder.firstElementChild;
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || button.loading) return;
      onAction(button.closest('.config-card'), button.dataset.action, button);
    });
    return dialog;
  };

  const open = async () => {
    const dialog = ensureDialog();
    if (window.ljReady) await window.ljReady(dialog);
    if (window.LJModal) window.LJModal.open(dialog); else dialog.show();
    load(dialog);
  };

  // Sólo los administradores ven "Configuración" (el servidor igual lo exige en cada pedido).
  const revealForAdmins = async () => {
    try {
      if (window.laJamoneraReady) await window.laJamoneraReady;
      const me = await api('GET', '/me');
      if (!me.admin) return;
      document.querySelectorAll('.js-open-config').forEach((el) => { el.hidden = false; });
    } catch (_) { /* sin servidor o sin sesión: queda oculto */ }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', revealForAdmins, { once: true });
  else revealForAdmins();

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest?.('.js-open-config');
    if (!trigger) return;
    trigger.closest('sl-dropdown')?.hide?.();
    open();
  });

  window.LJConfig = { open };
})();
