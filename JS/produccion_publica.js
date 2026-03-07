(function produccionPublicaPage() {
  const loadingNode = document.getElementById('publicTraceLoading');
  const dataNode = document.getElementById('publicTraceData');
  if (!loadingNode || !dataNode) return;

  const normalize = (v) => String(v || '').trim();
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const formatDateTime = (value) => {
    const d = new Date(Number(value));
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getId = () => {
    const params = new URLSearchParams(window.location.search);
    const queryId = normalize(params.get('id'));
    if (queryId) return queryId;
    const parts = (window.location.pathname || '').split('/').filter(Boolean);
    return normalize(parts[parts.length - 1]);
  };

  const render = async () => {
    const id = getId();
    if (!id) {
      dataNode.innerHTML = '<div class="ingrediente-empty-list">No se indicó un número de producción.</div>';
      loadingNode.classList.add('d-none');
      dataNode.classList.remove('d-none');
      return;
    }
    try {
      await window.laJamoneraReady;
      const registros = await window.dbLaJamoneraRest.read('/produccion/registros');
      const config = await window.dbLaJamoneraRest.read('/produccion/config');
      const reg = (registros && registros[id]) || null;
      if (!reg) throw new Error('Sin registro');
      dataNode.innerHTML = `
        <section class="produccion-trace-v2 produccion-trace-apple-viewer">
          <article class="produccion-trace-summary">
            <h6><i class="bi bi-diagram-3 fa-solid fa-diagram-project"></i> Trazabilidad ${escapeHtml(reg.id)}</h6>
            <div class="produccion-trace-grid">
              <p><strong>Producto</strong><span>${escapeHtml(reg.recipeTitle || '-')}</span></p>
              <p><strong>Estado</strong><span>${escapeHtml(reg.status || '-')}</span></p>
              <p><strong>Cantidad final</strong><span>${Number(reg.quantityKg || 0).toFixed(2)} kg</span></p>
              <p><strong>Fecha</strong><span>${escapeHtml(formatDateTime(reg.createdAt))}</span></p>
            </div>
          </article>
          <div class="text-center mt-2">
            <button id="publicOpenPlanillaBtn" type="button" class="btn ios-btn ios-btn-primary"><i class="fa-regular fa-file-lines"></i><span>Ver planilla completa</span></button>
          </div>
        </section>`;
      dataNode.querySelector('#publicOpenPlanillaBtn')?.addEventListener('click', async () => {
        await window.laJamoneraPlanillaProduccion?.openByRegistro?.(reg, { companyLogoUrl: normalize(config?.companyLogoUrl) });
      });
    } catch (error) {
      dataNode.innerHTML = '<div class="ingrediente-empty-list">No se pudo cargar la trazabilidad pública solicitada.</div>';
    } finally {
      loadingNode.classList.add('d-none');
      dataNode.classList.remove('d-none');
    }
  };

  render();
})();
