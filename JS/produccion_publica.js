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
  const formatIsoEs = (iso) => {
    const text = normalize(iso);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return text || '-';
    return `${match[3]}-${match[2]}-${match[1]}`;
  };

  const getId = () => {
    const params = new URLSearchParams(window.location.search);
    const queryId = normalize(params.get('id'));
    if (queryId) return queryId;
    const parts = (window.location.pathname || '').split('/').filter(Boolean);
    return normalize(parts[parts.length - 1]);
  };

  const ensureMermaid = async () => {
    if (window.mermaid) return true;
    const load = (src, id) => new Promise((resolve) => {
      const existing = document.getElementById(id);
      if (existing) {
        resolve(Boolean(window.mermaid));
        return;
      }
      const s = document.createElement('script');
      s.id = id;
      s.src = src;
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    const ok = await load('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js', 'la-jamonera-mermaid-public');
    if (!ok || !window.mermaid) return false;
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      themeVariables: {
        primaryColor: '#eef4ff',
        primaryTextColor: '#223f78',
        primaryBorderColor: '#c4d5f5',
        lineColor: '#6e88bc'
      }
    });
    return true;
  };

  const buildDefinition = (registro) => {
    const ingredients = Array.isArray(registro?.lots) ? registro.lots : [];
    const totalIngredientsKg = ingredients.reduce((sum, item) => sum + Number(item?.neededQty || item?.requiredQty || 0), 0);
    const mermaKg = Math.max(0, totalIngredientsKg - Number(registro?.quantityKg || 0));
    const manager = Array.isArray(registro?.managers) && registro.managers[0] ? registro.managers[0] : 'Responsable';
    const companyRne = normalize(registro?.traceability?.company?.rne?.number || '-');
    const productRnpa = normalize(registro?.traceability?.product?.rnpa?.number || '-');
    const lines = [
      'flowchart LR',
      `C["<b>FRIGORIFICO LA JAMONERA SA</b>"]:::toneCompany`,
      `CR["<b>RNE EMPRESA</b><br/>${escapeHtml(companyRne)}"]:::toneRegistry`,
      `P["<b>${escapeHtml((registro?.recipeTitle || 'Producto').toUpperCase())}</b>"]:::toneProduct`,
      `RNPA["<b>RNPA</b><br/>${escapeHtml(productRnpa)}"]:::toneRegistry`,
      `R["<b>PRODUCCIÓN</b> ${Number(registro?.quantityKg || 0).toFixed(2)} KG<br/><b>Fecha:</b> ${escapeHtml(formatIsoEs(registro?.productionDate || ''))}"]:::toneProduction`,
      `L["<b>LOTE:</b> ${escapeHtml(registro?.id || '-')}<br/><b>VTO:</b> ${escapeHtml(formatIsoEs(registro?.productExpiryDate || ''))}"]:::toneLot`,
      `M["<b>ENCARGADO:</b> ${escapeHtml(manager)}"]:::toneManager`,
      `I["<b>INGREDIENTES TOTALES</b> ${totalIngredientsKg.toFixed(3)} KG"]:::toneIngredients`,
      `W["<b>MERMA</b> ${mermaKg.toFixed(3)} KG"]:::toneWaste`,
      'C --> CR',
      'C --> P',
      'P -.-> RNPA',
      'P --> R',
      'R --> L',
      'R --> M',
      'R --> I',
      'I --> W'
    ];
    ingredients.forEach((plan, idx) => {
      const lot = Array.isArray(plan?.lots) && plan.lots[0] ? plan.lots[0] : {};
      const nodeId = `ING_${idx + 1}`;
      const rneId = `ING_${idx + 1}_RNE`;
      lines.push(`${nodeId}["<b>${idx + 1}. ${escapeHtml((plan?.ingredientName || 'Ingrediente').toUpperCase())}</b><br/><b>Usado:</b> ${escapeHtml(String(Number(plan?.neededQty || plan?.requiredQty || 0).toFixed(3)))} ${escapeHtml(plan?.ingredientUnit || plan?.unit || '')}<br/><b>Lote:</b> ${escapeHtml(lot?.lotNumber || lot?.entryId || '-')}<br/><b>Proveedor:</b> ${escapeHtml(lot?.provider || '-')}<br/><b>VTO lote:</b> ${escapeHtml(formatIsoEs(lot?.expiryDate || ''))}"]:::toneIngredient`);
      lines.push(`${rneId}["<b>RNE PROVEEDOR</b><br/>${escapeHtml(lot?.providerRne?.number || '-')} "]:::toneRegistry`);
      lines.push(`I --> ${nodeId}`);
      lines.push(`${nodeId} -.-> ${rneId}`);
    });
    lines.push('linkStyle default stroke:#6e83a7,stroke-width:1.8px;');
    lines.push('classDef toneCompany fill:#2f6ecf,stroke:#1f57ad,color:#ffffff,stroke-width:1.8px;');
    lines.push('classDef toneProduct fill:#3b82f6,stroke:#1f5ec4,color:#ffffff,stroke-width:1.7px;');
    lines.push('classDef toneLot fill:#ffedd1,stroke:#e4b674,color:#704b1e,stroke-width:1.4px;');
    lines.push('classDef toneProduction fill:#ffe7a9,stroke:#dbb867,color:#6b4f16,stroke-width:1.55px;');
    lines.push('classDef toneManager fill:#ece0ff,stroke:#c0a2ea,color:#4f3a7d,stroke-width:1.35px;');
    lines.push('classDef toneIngredients fill:#d1f2df,stroke:#89c8a5,color:#1a5e3f,stroke-width:1.45px;');
    lines.push('classDef toneWaste fill:#ffd8de,stroke:#e994a4,color:#7d2233,stroke-width:1.4px;');
    lines.push('classDef toneIngredient fill:#eaf1ff,stroke:#9fb9e6,color:#173f78,stroke-width:1.35px;');
    lines.push('classDef toneRegistry fill:#e7efff,stroke:#8eaedf,color:#173d73,stroke-width:1.35px;');
    return lines.join('\n');
  };

  const isImageUrl = (url) => /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(normalize(url));
  const isPdfUrl = (url) => /\.pdf(\?|$)/i.test(normalize(url));

  const openAttachments = async (urls, title) => {
    if (!Array.isArray(urls) || !urls.length) return;
    const blocks = urls.map((url) => {
      if (isPdfUrl(url)) {
        return `<article class="attachment-card attachment-doc" style="aspect-ratio:auto;height:72vh;"><iframe src="${escapeHtml(url)}" class="viewer-document" title="PDF"></iframe></article>`;
      }
      if (isImageUrl(url)) {
        return `<article class="attachment-card" style="aspect-ratio:auto;"><img src="${escapeHtml(url)}" class="attachment-image is-loaded" style="opacity:1;max-height:72vh;object-fit:contain;" alt="Adjunto"></article>`;
      }
      return `<article class="attachment-card attachment-doc" style="aspect-ratio:auto;"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="btn ios-btn ios-btn-secondary"><i class="fa-solid fa-up-right-from-square"></i><span>Abrir adjunto</span></a></article>`;
    }).join('');
    await Swal.fire({
      title,
      html: `<div class="attachments-grid" style="grid-template-columns:1fr;">${blocks}</div>`,
      width: '92vw',
      confirmButtonText: 'Cerrar',
      customClass: { popup: 'ios-alert ingredientes-alert', confirmButton: 'ios-btn ios-btn-secondary' }
    });
  };

  const renderPublicTrace = async (registro, config) => {
    const companyRne = normalize(registro?.traceability?.company?.rne?.number || '-');
    const rnpa = normalize(registro?.traceability?.product?.rnpa?.number || '-');
    const companyRneAttachment = normalize(registro?.traceability?.company?.rne?.attachmentUrl);
    const rnpaAttachment = normalize(registro?.traceability?.product?.rnpa?.attachmentUrl);
    const ingredients = Array.isArray(registro?.lots) ? registro.lots : [];

    dataNode.innerHTML = `<section class="produccion-trace-v2 produccion-trace-apple-viewer">
      <article class="produccion-trace-summary">
        <h6><i class="bi bi-diagram-3 fa-solid fa-diagram-project"></i> Trazabilidad ${escapeHtml(registro.id)}</h6>
        <div class="produccion-trace-grid">
          <p><strong>Empresa</strong><span>FRIGORIFICO LA JAMONERA SA</span></p>
          <p><strong>RNE empresa</strong><span>${escapeHtml(companyRne)}</span></p>
          <p><strong>Producto</strong><span>${escapeHtml(registro.recipeTitle || '-')}</span></p>
          <p><strong>RNPA</strong><span>${escapeHtml(rnpa)}</span></p>
          <p><strong>Cantidad final</strong><span>${Number(registro.quantityKg || 0).toFixed(2)} kg</span></p>
          <p><strong>Fecha</strong><span>${escapeHtml(formatDateTime(registro.createdAt))}</span></p>
          <p><strong>Estado</strong><span>${escapeHtml(registro.status || '-')}</span></p>
        </div>
        <div class="produccion-trace-card-actions">
          ${companyRneAttachment ? '<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="publicCompanyRneAttachmentBtn"><i class="fa-regular fa-eye"></i><span>Ver adjunto RNE empresa</span></button>' : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>RNE empresa sin adjunto</button>'}
          ${rnpaAttachment ? '<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="publicRnpaAttachmentBtn"><i class="fa-regular fa-eye"></i><span>Ver adjunto RNPA</span></button>' : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>RNPA sin adjunto</button>'}
          <button id="publicOpenPlanillaBtn" type="button" class="btn ios-btn ios-btn-primary"><i class="fa-regular fa-file-lines"></i><span>Ver planilla</span></button>
        </div>
      </article>
      <div class="produccion-trace-mermaid-wrap"><div class="produccion-trace-mermaid" data-public-mermaid><div class="produccion-trace-mermaid-loading"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando" class="meta-spinner-login"><p>Renderizando diagrama...</p></div></div></div>
      <div class="produccion-trace-ingredients">
        ${ingredients.map((item, idx) => {
          const lots = Array.isArray(item?.lots) ? item.lots : [];
          const ingredientImage = normalize(item?.ingredientImageUrl);
          const mergedAttachments = lots.flatMap((lot) => (Array.isArray(lot?.invoiceImageUrls) ? lot.invoiceImageUrls : []));
          const providerRneAttachment = normalize(lots.find((lot) => normalize(lot?.providerRne?.attachmentUrl))?.providerRne?.attachmentUrl);
          return `<article class="produccion-trace-ingredient-card"><header><div class="produccion-trace-ingredient-head-main"><span class="produccion-trace-ingredient-index">${idx + 1}</span><span class="produccion-trace-ingredient-avatar">${ingredientImage ? `<img src="${escapeHtml(ingredientImage)}" alt="${escapeHtml(item?.ingredientName || 'Ingrediente')}">` : '<i class="bi bi-basket2-fill fa-solid fa-carrot"></i>'}</span><h6>${escapeHtml(item?.ingredientName || 'Ingrediente')}</h6></div></header><div class="produccion-trace-lots">${lots.map((lot) => `<article class="produccion-trace-lot-card"><div class="produccion-trace-lot-head"><strong><i class="bi bi-upc-scan fa-solid fa-barcode"></i> Lote ${escapeHtml(lot?.lotNumber || lot?.entryId || '-')}</strong><span class="produccion-trace-used-badge">Vencimiento al elaborar: ${escapeHtml(formatIsoEs(lot?.expiryDate || ''))}</span></div><div class="produccion-trace-grid"><p><strong>Usado</strong><span>${Number(lot?.takeQty || 0).toFixed(3)} ${escapeHtml(lot?.unit || item?.ingredientUnit || '')}</span></p><p><strong>Proveedor</strong><span>${escapeHtml(lot?.provider || '-')}</span></p><p><strong>N° factura</strong><span>${escapeHtml(lot?.invoiceNumber || '-')}</span></p><p><strong>RNE proveedor</strong><span>${escapeHtml(lot?.providerRne?.number || '-')}</span></p></div></article>`).join('') || '<p class="m-0">Sin lotes asociados.</p>'}</div><div class="produccion-trace-card-actions">${mergedAttachments.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-public-images='${encodeURIComponent(JSON.stringify(mergedAttachments))}'><i class="fa-regular fa-images"></i><span>Ver adjuntos (${mergedAttachments.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}${providerRneAttachment ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-public-images='${encodeURIComponent(JSON.stringify([providerRneAttachment]))}'><i class="fa-regular fa-eye"></i><span>Ver adjunto RNE</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>RNE sin adjunto</button>'}</div></article>`;
        }).join('') || '<p class="ingrediente-empty-list">Sin desglose de lotes para esta producción.</p>'}
      </div>
    </section>`;

    dataNode.querySelector('#publicOpenPlanillaBtn')?.addEventListener('click', async () => {
      await window.laJamoneraPlanillaProduccion?.openByRegistro?.(registro, { companyLogoUrl: normalize(config?.companyLogoUrl), usersMap: safeObject(config?.usersMap) });
    });
    dataNode.querySelector('#publicCompanyRneAttachmentBtn')?.addEventListener('click', async () => openAttachments([companyRneAttachment], 'Adjunto RNE empresa'));
    dataNode.querySelector('#publicRnpaAttachmentBtn')?.addEventListener('click', async () => openAttachments([rnpaAttachment], 'Adjunto RNPA'));
    dataNode.querySelectorAll('[data-public-images]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const urls = JSON.parse(decodeURIComponent(btn.dataset.publicImages || '[]'));
        await openAttachments(urls, 'Adjuntos');
      });
    });

    const mermaidHost = dataNode.querySelector('[data-public-mermaid]');
    if (mermaidHost) {
      const hasMermaid = await ensureMermaid();
      if (hasMermaid) {
        try {
          const rendered = await window.mermaid.render(`public_trace_${Date.now()}`, buildDefinition(registro));
          mermaidHost.innerHTML = rendered.svg;
        } catch (error) {
          mermaidHost.innerHTML = '<p class="m-0">No se pudo renderizar el diagrama.</p>';
        }
      } else {
        mermaidHost.innerHTML = '<p class="m-0">No se pudo cargar Mermaid.</p>';
      }
    }
  };

  const safeObject = (value) => (value && typeof value === 'object' ? value : {});

  const run = async () => {
    const id = getId();
    if (!id) {
      loadingNode.classList.add('d-none');
      dataNode.classList.remove('d-none');
      dataNode.innerHTML = '<div class="ingrediente-empty-list">No se indicó número de producción.</div>';
      return;
    }
    try {
      await window.laJamoneraReady;
      const [registros, config, users] = await Promise.all([
        window.dbLaJamoneraRest.read('/produccion/registros'),
        window.dbLaJamoneraRest.read('/produccion/config'),
        window.dbLaJamoneraRest.read('/informes/users')
      ]);
      const registro = safeObject(registros)[id];
      if (!registro) throw new Error('No encontrado');
      const cfg = { ...safeObject(config), usersMap: safeObject(users) };
      await renderPublicTrace(registro, cfg);
    } catch (error) {
      dataNode.innerHTML = '<div class="ingrediente-empty-list">No se pudo cargar la trazabilidad pública solicitada.</div>';
    } finally {
      loadingNode.classList.add('d-none');
      dataNode.classList.remove('d-none');
    }
  };

  run();
})();
