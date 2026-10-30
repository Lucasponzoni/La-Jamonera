// Batches de adobo (IT v03 · planilla RE-BPM-XX v03).
// Un batch es un lote: DDMMAAAA-SIGLA (-02, -03… si ya hay uno ese día). La fórmula está escrita para 100 kg de adobo y se
// prepara lo que haga falta. Las especias se descuentan por FEFO; el adobo vence con la especia que vence primero.
// Stock infinito (azúcar: se compra en comercio local como consumidor final) va sin lote y queda aclarado.
// Las fórmulas viven en /inventario/config.adobos[ingredientId] = { sigla, titulo, base, componentes:[{ingredientId, ingredientName, kg}] }.
(function () {
  const db = () => window.dbLaJamoneraRest;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r4 = (v) => Number(Number(v).toFixed(4));
  const kgTxt = (v, d = 3) => Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const dmy = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso || '—'));
  const compacta = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
  const hoyAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const makeId = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const esGramos = (e) => String(e?.unit || 'kilos').startsWith('gram');
  const kgDe = (e, q) => (esGramos(e) ? q / 1000 : q);
  const enUnidad = (e, kg) => (esGramos(e) ? kg * 1000 : kg);
  const factorBase = (e) => (Number(e?.qtyBase) && Number(e?.qty) ? Number(e.qtyBase) / Number(e.qty) : (esGramos(e) ? 1 : 1000));
  const esInfinito = (rec) => Boolean(rec?.infiniteStock || rec?.stockInfinito);
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const AZUCAR_NOTA = 'Comercio local (consumidor final): stock infinito, sin lote de proveedor';

  let cacheConfig = null;
  const config = async (forzar = false) => {
    if (!cacheConfig || forzar) cacheConfig = (await db().read('/inventario/config')) || {};
    return cacheConfig;
  };
  const adobos = async () => (await config()).adobos || {};
  const esAdobo = async (ingredientId) => Boolean((await adobos())[ingredientId]);
  const leerRegistro = async (id) => (await db().read(`/inventario/items/${id}`)) || { entries: [] };

  // Lotes FEFO disponibles a la fecha (ingresados hasta ese día y sin vencer).
  const lotesFefo = (rec, fecha) => (rec?.entries || [])
    .filter((e) => !e.ventaLocal && (e.entryDate || '') <= fecha && (!e.expiryDate || e.noPerecedero || e.expiryDate >= fecha) && Number(e.availableQty) > 1e-9)
    .sort((a, b) => (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999') || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));

  // Arma el batch sin escribir nada: componentes con lotes, faltantes, vencimiento y lote.
  const planificar = async ({ adoboId, fecha, kg, registros = {} }) => {
    const A = (await adobos())[adoboId];
    if (!A) throw new Error('Este producto no tiene fórmula de batch.');
    const leer = async (id) => (registros[id] = registros[id] || (await leerRegistro(id)));
    const componentes = []; const faltan = []; let vto = ''; let vencePor = '';
    for (const c of A.componentes || []) {
      const need = Number(c.kg) * kg / Number(A.base || 100);
      const rec = await leer(c.ingredientId);
      if (esInfinito(rec)) {
        componentes.push({ ...c, kg: r4(need), infinito: true, lotes: [], nota: /azucar|azúcar/i.test(c.ingredientName) ? AZUCAR_NOTA : 'Stock infinito, sin lote' });
        continue;
      }
      let falta = need; const lotes = [];
      for (const e of lotesFefo(rec, fecha)) {
        if (falta <= 1e-9) break;
        const t = Math.min(falta, kgDe(e, Number(e.availableQty))); falta -= t;
        lotes.push({ entryId: e.id, lotNumber: e.lotNumber || '', expiryDate: e.expiryDate || '', provider: e.provider || '', invoiceNumber: e.invoiceNumber || '', kg: r4(t) });
        if (e.expiryDate && (!vto || e.expiryDate < vto)) { vto = e.expiryDate; vencePor = c.ingredientName; }
      }
      if (falta > 1e-4) faltan.push({ ingredientName: c.ingredientName, kg: r4(falta) });
      componentes.push({ ...c, kg: r4(need), infinito: false, lotes });
    }
    const adoboRec = await leer(adoboId);
    const base = `${compacta(fecha)}-${A.sigla}`;
    const mismos = (adoboRec.entries || []).filter((e) => String(e.lotNumber || '').startsWith(base)).length;
    const lote = mismos ? `${base}-${String(mismos + 1).padStart(2, '0')}` : base;
    return { A, componentes, faltan, vto, vencePor, lote, registros };
  };

  const preparar = async ({ adoboId, fecha, kg, responsable = '' }) => {
    const plan = await planificar({ adoboId, fecha, kg });
    if (plan.faltan.length) throw new Error(`Faltan especias: ${plan.faltan.map((f) => `${f.ingredientName} ${kgTxt(f.kg)} kg`).join(', ')}.`);
    const { A, componentes, vto, vencePor, lote, registros } = plan;
    const batchId = makeId('batch'); const now = Date.now();
    const tocados = new Set([adoboId]);
    for (const c of componentes) {
      if (c.infinito) continue;
      const rec = registros[c.ingredientId];
      for (const l of c.lotes) {
        const e = rec.entries.find((x) => x.id === l.entryId);
        const q = enUnidad(e, l.kg); const k = factorBase(e);
        e.availableQty = r4(Number(e.availableQty) - q);
        e.availableBase = r4(Number(e.availableBase ?? Number(e.qty) * k) - q * k);
        if ('availableKg' in e) e.availableKg = r4(Number(e.availableKg) - l.kg);
        if (Number(e.availableQty) <= 1e-6) { e.availableQty = 0; e.availableBase = 0; if ('availableKg' in e) e.availableKg = 0; e.lotStatus = 'consumido_en_produccion'; }
        e.productionUsage = [{ id: makeId('usage'), productionId: lote, batchAdobo: true, batchId, producedAt: now, productionDate: fecha, expiryDateAtProduction: e.expiryDate || '',
          kilosUsed: l.kg, usedQty: r4(q), usedUnit: e.unit || 'kilos', usedBaseQty: r4(q * k), lotNumber: e.lotNumber || '', ingredientLot: e.lotNumber || '',
          ingredientEntryId: e.id, ingredientId: c.ingredientId }, ...(e.productionUsage || [])];
        e.movementHistory = [{ id: batchId, type: 'batch', createdAt: now, date: fecha, qty: r4(q), qtyUnit: e.unit || 'kilos', qtyKg: l.kg, reference: lote,
          titulo: `Batch de adobo ${lote}`, observation: `Batch ${lote}: ${kgTxt(l.kg)} kg` }, ...(e.movementHistory || [])];
      }
      tocados.add(c.ingredientId);
    }
    const batchDe = { batchId, sigla: A.sigla, titulo: A.titulo, fecha, kg: r4(kg), responsable, formulaBase: A.base || 100, vencePor,
      componentes: componentes.map((c) => ({ ingredientId: c.ingredientId, ingredientName: c.ingredientName, kg: c.kg, infinito: c.infinito, nota: c.nota || '', lotes: c.lotes })) };
    const nota = [`Batch de adobo ${A.sigla} (${String(A.titulo || '').toLowerCase()}), ${kgTxt(kg)} kg. Fórmula base para 100 kg de adobo.`,
      vto ? `Vence ${dmy(vto)}: la especia que vence primero (${vencePor}).` : '',
      componentes.some((c) => c.infinito && c.nota === AZUCAR_NOTA) ? 'Azúcar: comercio local (consumidor final), stock infinito, sin lote.' : ''].filter(Boolean).join(' ');
    const entry = { id: makeId('entry'), qty: r4(kg), unit: 'kilos', qtyKg: r4(kg), qtyBase: r4(kg * 1000), availableQty: r4(kg), availableBase: r4(kg * 1000), availableKg: r4(kg),
      packageQty: null, productionUsage: [], noPerecedero: false, usoInternoEmpresa: false, isFrozen: false, frozenAt: '', entryDate: fecha, expiryDate: vto || '',
      invoiceNumber: '', remitoNumber: '', lotNumber: lote, customLot: lote, provider: 'Elaboración propia (batch de adobo)', lotStatus: 'disponible',
      invoiceImageUrl: '', invoiceImageUrls: [], ptFileUrls: [], createdAt: now, lotNota: nota, vtoCriterio: 'la especia que vence primero (IT v03 §5.3)', batchDe };
    const adoboRec = registros[adoboId];
    adoboRec.entries = [entry, ...(adoboRec.entries || [])]; adoboRec.hasEntries = true; adoboRec.stockUnit = adoboRec.stockUnit || 'kilos';
    for (const id of tocados) {
      const rec = registros[id];
      rec.stockBase = Number((rec.entries || []).reduce((a, e) => a + (Number(e.availableBase) || 0), 0).toFixed(6));
      delete rec.__indexLite;
      await db().write(`/inventario/items/${id}`, rec);
    }
    await db().write(`/batches/items/${batchId}`, { id: batchId, sigla: A.sigla, adoboIngredientId: adoboId, adoboEntryId: entry.id, lote, fecha, kg: r4(kg), expiryDate: vto || '',
      vencePor, responsable, titulo: A.titulo, componentes: batchDe.componentes, createdAt: now, modo: 'app' });
    return { entry, lote, vto };
  };

  // ── impresión ──
  const imprimirHtml = (html) => new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument; doc.open(); doc.write(html); doc.close();
    setTimeout(() => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } finally { setTimeout(() => { frame.remove(); resolve(); }, 1500); } }, 400);
  });
  const ESTILO = `*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#0F1B2D;margin:0}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #9aa6b2;padding:4px 6px;font-size:11px;text-align:left}th{background:#e8edf2;font-size:10px;text-transform:uppercase}
    .r{text-align:right}`;

  const planillaHtml = (entry, ingredientName) => {
    const b = entry.batchDe || {};
    const filas = []; let n = 0;
    (b.componentes || []).forEach((c) => {
      const lotes = c.infinito ? [{ lotNumber: 'Sin lote · stock infinito', provider: 'Comercio local (consumidor final)', expiryDate: '', kg: c.kg }] : (c.lotes || []);
      lotes.forEach((l) => { n += 1; filas.push(`<tr><td>${n}</td><td>${esc(cap(c.ingredientName))}</td><td>${esc(l.provider || '—')}</td><td>${esc(l.lotNumber || '—')}</td><td>${esc(l.expiryDate ? dmy(l.expiryDate) : '—')}</td><td class="r">${kgTxt(l.kg)} kg</td></tr>`); });
    });
    for (let i = n + 1; i <= Math.max(14, n); i += 1) filas.push(`<tr><td>${i}</td><td></td><td></td><td></td><td></td><td></td></tr>`);
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(entry.lotNumber)}</title><style>${ESTILO}
      @page{size:A4;margin:14mm}.cab{text-align:center;border-bottom:2px solid #0F1B2D;padding-bottom:6px;margin-bottom:10px}.cab b{font-size:15px;display:block}.cab small{color:#5A6573}
      .g{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:10px}.g div{border:1px solid #9aa6b2;padding:4px 6px;font-size:11px}.g small{display:block;font-size:8.5px;color:#5A6573;text-transform:uppercase}
      .crit{font-size:9.5px;color:#5A6573;margin-top:8px;line-height:1.4}.firma{display:flex;justify-content:space-between;margin-top:30px;font-size:11px}</style></head><body>
      <div class="cab"><b>FRIGORÍFICO LA JAMONERA</b>PLANILLA DE ELABORACIÓN DE BATCH / MEZCLA DE ESPECIAS<br><small>Documento: RE-BPM-XX · Versión: 03 · RNE 21-85083</small></div>
      <div class="g"><div><small>Fecha de elaboración</small>${dmy(b.fecha || entry.entryDate)}</div><div><small>Producto / destino</small>${esc(b.titulo || ingredientName)}</div><div><small>Sigla</small>${esc(b.sigla || '')}</div>
      <div><small>Lote del batch</small><b>${esc(entry.lotNumber)}</b></div><div><small>Vencimiento</small>${dmy(entry.expiryDate)}</div><div><small>Responsable</small>${esc(b.responsable || '')}&nbsp;</div></div>
      <table><thead><tr><th>N°</th><th>Especia / aditivo / conservante</th><th>Proveedor</th><th>Lote del proveedor</th><th>Vencimiento</th><th class="r">Cantidad</th></tr></thead>
      <tbody>${filas.join('')}<tr><td colspan="5"><b>CANTIDAD TOTAL DEL BATCH</b></td><td class="r"><b>${kgTxt(entry.qty)} kg</b></td></tr></tbody></table>
      <div class="crit">Siglas: CHE chorizo especial · CHP chorizo parrillero (y Chori Max) · CHC chorizo colorado · M morcilla. Lote del batch: DDMMAAAA-SIGLA (fecha de elaboración, sin barras; correlativo -01, -02 si hay más de uno en el día).
      Vencimiento del batch: el más próximo de los ingredientes${b.vencePor ? ` (${esc(b.vencePor)})` : ''}. La Canasta: lote = vencimiento. Rotación FEFO.
      Fórmula base para 100 kg de adobo; este batch: ${kgTxt(entry.qty)} kg. El lote y vencimiento del batch se copian en la planilla de producción, fila «Condimento para…».</div>
      <div class="firma"><span>Elaboró: ______________________________</span><span>Controló / Aprobó: ______________________________</span></div></body></html>`;
  };

  const rotuloHtml = (entry, ingredientName, formato = 'zebra') => {
    const b = entry.batchDe || {};
    const contiene = (b.componentes || []).map((c) => cap(c.ingredientName)).join(', ');
    const una = `<div class="et"><div class="cab"><span>ADOBO · BATCH</span><span>${esc(b.sigla || '')}</span></div><div class="nom">${esc(cap(b.titulo || ingredientName))}</div>
      <div class="lot">${esc(entry.lotNumber)}</div><svg class="bar" data-lote="${esc(entry.lotNumber)}"></svg>
      <div class="dat"><div>Elaboración<b>${dmy(b.fecha || entry.entryDate)}</b></div><div>Peso<b>${kgTxt(entry.qty, 2)} kg</b></div><div class="v">Vence<b>${dmy(entry.expiryDate)}</b></div></div>
      <div class="pie">Contiene: ${esc(contiene)} · Conservar en lugar seco y fresco · Resp.: ${esc(b.responsable || '________')}</div></div>`;
    const a4 = formato === 'a4';
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(entry.lotNumber)}</title>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"><\/script><style>${ESTILO}
      @page{size:${a4 ? 'A4' : '100mm 70mm'};margin:${a4 ? '8mm' : '0'}}
      .hoja{display:${a4 ? 'grid' : 'block'};grid-template-columns:1fr 1fr;gap:4mm}
      .et{width:100mm;height:70mm;border:${a4 ? '1px dashed #9aa6b2' : '0'};padding:3mm;overflow:hidden;page-break-inside:avoid}
      .et .cab{background:#0F1B2D;color:#fff;padding:1.5mm 3mm;display:flex;justify-content:space-between;font-size:9pt;font-weight:bold;letter-spacing:.06em}
      .nom{font-size:11pt;font-weight:bold;margin-top:1.5mm}.lot{font-size:18pt;font-weight:900;text-align:center}.bar{display:block;margin:0 auto;height:12mm;width:80mm}
      .dat{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5mm;font-size:7pt}.dat div{background:#f1f4f7;padding:1mm 1.5mm}.dat b{display:block;font-size:10pt}.dat .v{border:1px solid #15803d;background:#e8f6ec}
      .pie{font-size:6.5pt;color:#5A6573;margin-top:1mm}</style></head><body><div class="hoja">${a4 ? una.repeat(6) : una}</div>
      <script>document.querySelectorAll('svg.bar').forEach(function(s){try{JsBarcode(s,s.dataset.lote,{format:'CODE128',displayValue:false,margin:0,height:40});}catch(e){}});<\/script></body></html>`;
  };

  const imprimirPlanilla = (entry, ingredientName = '') => imprimirHtml(planillaHtml(entry, ingredientName));
  const imprimirRotulo = async (entry, ingredientName = '') => {
    const res = await Swal.fire({ title: 'Rótulo del batch', input: 'radio', inputOptions: { zebra: 'Zebra 100 × 70 mm', a4: 'Hoja A4 de 6' }, inputValue: 'zebra',
      showCancelButton: true, confirmButtonText: 'Imprimir', cancelButtonText: 'Cancelar' });
    if (res.isConfirmed) await imprimirHtml(rotuloHtml(entry, ingredientName, res.value));
  };

  // ── modal «Preparar batch» ──
  const tablaPlanHtml = (plan) => {
    const filas = plan.componentes.map((c) => `<tr><td>${esc(cap(c.ingredientName))}</td><td>${c.infinito ? `<small>${esc(c.nota)}</small>`
      : (c.lotes.map((l) => `<code>${esc(l.lotNumber || '—')}</code> <small>${kgTxt(l.kg)} kg · vence ${dmy(l.expiryDate)}</small>`).join('<br>') || '<small class="falta">sin stock</small>')}</td>
      <td class="r">${kgTxt(c.kg)}</td></tr>`).join('');
    const faltan = plan.faltan.length ? `<p class="batch-falta"><b>No alcanza:</b> ${plan.faltan.map((f) => `${esc(cap(f.ingredientName))} ${kgTxt(f.kg)} kg`).join(' · ')}. Cargá la factura o prepará menos kg.</p>` : '';
    return `<p class="batch-lote">Lote <b>${esc(plan.lote)}</b> · vence <b>${dmy(plan.vto)}</b>${plan.vencePor ? ` <small>(por ${esc(plan.vencePor)})</small>` : ''}</p>
      <table class="batch-tabla"><thead><tr><th>Especia</th><th>Lote (FEFO)</th><th class="r">kg</th></tr></thead><tbody>${filas}</tbody></table>${faltan}`;
  };

  // abre el modal; devuelve el resultado de preparar() o null
  const abrirPreparar = async (adoboId, { kgSugerido = 0, fecha = hoyAr(), motivo = '', nombre = '' } = {}) => {
    const A = (await adobos())[adoboId];
    if (!A) { await Swal.fire({ title: 'Sin fórmula', text: 'Este producto no tiene fórmula de batch.', icon: 'info' }); return null; }
    const kg0 = Math.max(1, Math.ceil((kgSugerido || 20) / 5) * 5);
    const res = await Swal.fire({
      title: `Preparar batch · ${cap(nombre || A.nombre || A.titulo)}`,
      html: `<div class="batch-modal">${motivo ? `<p class="batch-motivo">${motivo}</p>` : ''}
        <div class="batch-campos"><label>Fecha de elaboración <input type="date" id="batchFecha" value="${esc(fecha)}"></label>
        <label>Kg de adobo a preparar <input type="number" id="batchKg" min="0.1" step="0.1" value="${kg0}"></label>
        <label>Responsable <input type="text" id="batchResp" placeholder="Nombre"></label></div>
        <p class="batch-nota">La fórmula está escrita para ${esc(A.base || 100)} kg de adobo; se escala a los kg que elijas. Las especias salen por FEFO.</p>
        <div id="batchPlan"><p>Calculando…</p></div></div>`,
      width: 720, showCancelButton: true, confirmButtonText: 'Preparar e imprimir planilla', cancelButtonText: 'Cancelar', focusConfirm: false,
      didOpen: (popup) => {
        let seq = 0;
        const recalcular = async () => {
          const mi = ++seq; const kg = Number(popup.querySelector('#batchKg').value) || 0; const f = popup.querySelector('#batchFecha').value;
          if (kg <= 0 || !f) return;
          try { const plan = await planificar({ adoboId, fecha: f, kg }); if (mi === seq) popup.querySelector('#batchPlan').innerHTML = tablaPlanHtml(plan); }
          catch (e) { popup.querySelector('#batchPlan').innerHTML = `<p class="batch-falta">${esc(e.message)}</p>`; }
        };
        popup.querySelector('#batchKg').addEventListener('input', recalcular);
        popup.querySelector('#batchFecha').addEventListener('change', recalcular);
        recalcular();
      },
      preConfirm: async () => {
        const popup = Swal.getPopup();
        const kg = Number(popup.querySelector('#batchKg').value) || 0; const f = popup.querySelector('#batchFecha').value;
        const responsable = popup.querySelector('#batchResp').value.trim();
        if (kg <= 0 || !f) { Swal.showValidationMessage('Elegí la fecha y los kg.'); return false; }
        const plan = await planificar({ adoboId, fecha: f, kg });
        if (plan.faltan.length) { Swal.showValidationMessage(`No alcanza: ${plan.faltan.map((x) => `${x.ingredientName} ${kgTxt(x.kg)} kg`).join(', ')}`); return false; }
        return { kg, fecha: f, responsable };
      }
    });
    if (!res.isConfirmed) return null;
    try {
      const hecho = await preparar({ adoboId, ...res.value });
      const otra = await Swal.fire({ title: `Batch ${hecho.lote} preparado`, html: `<p>${kgTxt(res.value.kg, 2)} kg · vence ${dmy(hecho.vto)}</p>`, icon: 'success',
        showDenyButton: true, showCancelButton: true, confirmButtonText: 'Imprimir planilla', denyButtonText: 'Imprimir rótulo', cancelButtonText: 'Listo' });
      if (otra.isConfirmed) await imprimirPlanilla(hecho.entry, A.nombre);
      if (otra.isDenied) await imprimirRotulo(hecho.entry, A.nombre);
      return hecho;
    } catch (e) {
      await Swal.fire({ title: 'No se pudo preparar el batch', text: e.message, icon: 'error' });
      return null;
    }
  };

  // Desde producción: si falta adobo, ofrece armar el batch con lo que falta (redondeado a 5 kg).
  const ofrecerSiFalta = async ({ faltantes = [], fecha = hoyAr() } = {}) => {
    const lista = await adobos(); let armado = false;
    for (const f of faltantes) {
      if (!lista[f.ingredientId] || !(f.kg > 0)) continue;
      const A = lista[f.ingredientId];
      const q = await Swal.fire({ title: `No alcanza el adobo ${A.sigla}`, html: `<p>Faltan <b>${kgTxt(f.kg)} kg</b> de ${esc(A.nombre)} para esta producción.</p><p>¿Armo el batch siguiente?</p>`,
        icon: 'question', showCancelButton: true, confirmButtonText: 'Sí, armar batch', cancelButtonText: 'No' });
      if (!q.isConfirmed) continue;
      const hecho = await abrirPreparar(f.ingredientId, { kgSugerido: f.kg, fecha, motivo: `Para la producción hacen falta ${kgTxt(f.kg)} kg.`, nombre: A.nombre });
      if (hecho) armado = true;
    }
    return armado;
  };

  window.laJamoneraBatchAdobo = { config, adobos, esAdobo, planificar, preparar, abrirPreparar, ofrecerSiFalta, imprimirPlanilla, imprimirRotulo, planillaHtml, rotuloHtml };
})();
