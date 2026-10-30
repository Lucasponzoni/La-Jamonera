// Batches de adobo (IT v03 · planilla RE-BPM-XX v03).
// Un batch es un lote: DDMMAAAA-SIGLA (-02, -03… si ya hay uno ese día). La fórmula está escrita para 100 kg de adobo y se
// prepara lo que haga falta. Las especias se descuentan por FEFO; el adobo vence con la especia que vence primero.
// Stock infinito: el azúcar se compra en comercio local como consumidor final → lote = fecha del batch, vence a los 60 días.
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
  const AZUCAR_NOTA = 'Comercio local (consumidor final): lote = fecha del batch, vence a los 60 días';
  const AZUCAR_PROV = 'Comercio local (consumidor final)';
  const mas60 = (iso) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 60); return t.toISOString().slice(0, 10); };

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
        // Azúcar: comercio local como consumidor final, sin lote del proveedor → lote = fecha del batch, vence a los 60 días.
        if (/azucar|azúcar/i.test(c.ingredientName)) {
          const vAz = mas60(fecha);
          componentes.push({ ...c, kg: r4(need), infinito: true, nota: AZUCAR_NOTA,
            lotes: [{ entryId: '', lotNumber: compacta(fecha), expiryDate: vAz, provider: AZUCAR_PROV, invoiceNumber: '', kg: r4(need) }] });
          if (!vto || vAz < vto) { vto = vAz; vencePor = c.ingredientName; }
        } else componentes.push({ ...c, kg: r4(need), infinito: true, lotes: [], nota: 'Stock infinito, sin lote' });
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
      vto ? `Vence ${dmy(vto)}: el componente que vence primero (${vencePor}).` : '',
      componentes.some((c) => c.infinito && c.nota === AZUCAR_NOTA) ? 'Azúcar: comercio local (consumidor final), lote = fecha del batch, vence a los 60 días.' : ''].filter(Boolean).join(' ');
    const entry = { id: makeId('entry'), qty: r4(kg), unit: 'kilos', qtyKg: r4(kg), qtyBase: r4(kg * 1000), availableQty: r4(kg), availableBase: r4(kg * 1000), availableKg: r4(kg),
      packageQty: null, productionUsage: [], noPerecedero: false, usoInternoEmpresa: false, isFrozen: false, frozenAt: '', entryDate: fecha, expiryDate: vto || '',
      invoiceNumber: '', remitoNumber: '', lotNumber: lote, customLot: lote, provider: 'Elaboración propia (batch de adobo)', lotStatus: 'disponible',
      invoiceImageUrl: '', invoiceImageUrls: [], ptFileUrls: [], createdAt: now, lotNota: nota, vtoCriterio: 'el componente que vence primero (IT v03 §5.3)', batchDe };
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
  // Planilla RE-BPM-XX v03 con el diseño de PLANILLA-ADOBO.pdf: cabecera, datos del batch, 14 renglones, siglas, criterios y firmas.
  const planillaHtml = (entry, ingredientName) => {
    const b = entry.batchDe || {};
    const filas = []; let n = 0;
    (b.componentes || []).forEach((c) => {
      const lotes = (c.lotes && c.lotes.length) ? c.lotes : [{ lotNumber: 'Sin lote', provider: c.infinito ? AZUCAR_PROV : '—', expiryDate: '', kg: c.kg }];
      lotes.forEach((l) => { n += 1; filas.push(`<tr><td class="c n">${n}</td><td>${esc(cap(c.ingredientName))}</td><td>${esc(l.provider || '—')}</td><td class="c">${esc(l.lotNumber || '—')}</td><td class="c">${esc(l.expiryDate ? dmy(l.expiryDate) : '—')}</td><td class="r">${kgTxt(l.kg)} kg</td></tr>`); });
    });
    for (let i = n + 1; i <= Math.max(14, n); i += 1) filas.push(`<tr><td class="c n">${i}</td><td></td><td></td><td></td><td></td><td></td></tr>`);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Planilla batch ${esc(entry.lotNumber)}</title><style>
      @page{size:A4;margin:16mm 15mm}*{box-sizing:border-box}body{font-family:Carlito,Calibri,Lato,Arial,sans-serif;color:#000;margin:0;font-size:10.5pt}
      h1{font-size:15pt;margin:0}h2{font-size:10.5pt;margin:2px 0 1px}.doc{font-size:7.5pt;border-bottom:1.5px solid #000;padding-bottom:4px;margin-bottom:12px}
      table{border-collapse:collapse;width:100%}th,td{border:.75px solid #444;padding:4px 5px;vertical-align:middle}
      th{background:#d9d9d9;font-size:8.5pt;font-weight:700;text-align:center}.c{text-align:center}.r{text-align:right}
      .datos td{height:38px;text-align:center;font-size:10pt}.datos .lote{font-weight:700;font-size:11pt;white-space:nowrap}
      .ing{margin-top:14px}.ing .banda th{text-align:left}.ing td{height:23px;font-size:9pt}.ing td.n{font-weight:700;width:30px}
      .total td{background:#d9d9d9;font-weight:700;text-align:right;font-size:8.5pt}.total td.r{background:#fff;font-size:10pt}
      .siglas{margin-top:14px}.siglas td{text-align:center;width:25%}.siglas b{display:block;font-size:12pt}.siglas small{font-size:7.5pt}
      .crit{margin-top:14px;font-size:8.6pt}.crit h3{font-size:9.5pt;margin:0 0 4px}.crit ul{margin:0;padding-left:18px}.crit li{margin:2px 0}
      .firmas{margin-top:18px}.firmas td{height:34px;width:50%;font-size:9pt}</style></head><body>
      <h1>FRIGORÍFICO LA JAMONERA</h1><h2>PLANILLA DE ELABORACIÓN DE BATCH / MEZCLA DE ESPECIAS</h2>
      <div class="doc">Documento: RE-BPM-XX &nbsp;|&nbsp; Versión: 03 &nbsp;|&nbsp; RNE 21-85083</div>
      <table class="datos"><thead><tr><th>Fecha de elaboración</th><th>Producto / destino</th><th>Sigla producto</th><th>Lote del batch</th><th>Vencimiento del batch</th><th>Responsable</th></tr></thead>
      <tbody><tr><td>${dmy(b.fecha || entry.entryDate)}</td><td>${esc(cap(b.titulo || ingredientName))}</td><td>${esc(b.sigla || '')}</td><td class="lote">${esc(entry.lotNumber)}</td><td>${dmy(entry.expiryDate)}</td><td>${esc(b.responsable || '')}</td></tr></tbody></table>
      <table class="ing"><thead><tr class="banda"><th colspan="6">INGREDIENTES / ESPECIAS DEL BATCH</th></tr>
      <tr><th style="width:30px">N°</th><th>Especia / aditivo / conservante</th><th>Proveedor</th><th>Lote del proveedor</th><th>Vencimiento<br>(dd/mm/aaaa)</th><th style="width:90px">Cantidad</th></tr></thead>
      <tbody>${filas.join('')}<tr class="total"><td colspan="5">CANTIDAD TOTAL DEL BATCH</td><td class="r">${kgTxt(entry.qty)} kg</td></tr></tbody></table>
      <table class="siglas"><thead><tr><th colspan="4">SIGLAS DE PRODUCTO DESTINO</th></tr></thead><tbody><tr>
      <td><b>CHE</b><small>Chorizo especial</small></td><td><b>CHP</b><small>Chorizo parrillero y Chori Max</small></td><td><b>CHC</b><small>Chorizo colorado</small></td><td><b>M</b><small>Morcilla</small></td></tr></tbody></table>
      <div class="crit"><h3>Criterios de codificación (ver instructivo IT-BPM-XX, versión 03)</h3><ul>
      <li><b>Lote del batch: DDMMAAAA-SIGLA</b> (fecha de elaboración en números, sin barras, y sigla del producto destino). Ej.: 09072026-CHE.</li>
      <li><b>Más de un batch del mismo destino en el día:</b> correlativo de dos dígitos al final (09072026-CHE-02, 09072026-CHE-03).</li>
      <li><b>Vencimiento del batch:</b> el más próximo entre todos los ingredientes del batch${b.vencePor ? ` (en este batch: ${esc(b.vencePor)})` : ''}.</li>
      <li><b>Lote del proveedor:</b> el que trae el producto o el anotado en la factura. Si el lote es una fecha (La Canasta: lote = vencimiento) se escribe sólo en números, ddmmaaaa.</li>
      <li><b>Azúcar:</b> se compra en comercio local como consumidor final; lote = fecha del batch y vence a los 60 días.</li>
      <li>Rotación de especias por <b>FEFO</b> (primero vence, primero sale). Fórmula base para 100 kg de adobo; este batch: ${kgTxt(entry.qty, 2)} kg.</li></ul></div>
      <table class="firmas"><tbody><tr><td>Elaboró: ________________________________</td><td>Controló / Aprobó: ________________________________</td></tr></tbody></table>
      </body></html>`;
  };

  // Rótulo del batch. Mismo diseño en tres tamaños: Zebra 100 × 70 mm, A4 con 6 rótulos o A4 con un rótulo grande.
  const FORMATOS_ROTULO = {
    zebra: { page: '100mm 70mm', margin: '0', s: 1, cols: 1, n: 1, borde: false },
    a4: { page: 'A4', margin: '10mm 7mm', s: 0.96, cols: 2, n: 6, borde: true },
    a4uno: { page: 'A4 landscape', margin: '12mm', s: 2.5, cols: 1, n: 1, borde: true }
  };
  const rotuloHtml = (entry, ingredientName, formato = 'zebra') => {
    const b = entry.batchDe || {};
    const f = FORMATOS_ROTULO[formato] || FORMATOS_ROTULO.zebra;
    const contiene = (b.componentes || []).map((c) => cap(c.ingredientName)).join(', ');
    const una = `<div class="et"><div class="cab"><span>FRIGORÍFICO LA JAMONERA</span><span class="tipo">ADOBO · BATCH ${esc(b.sigla || '')}</span></div>
      <div class="nom">${esc(cap(b.titulo || ingredientName))}</div>
      <div class="lw"><small>LOTE</small><div class="lot">${esc(entry.lotNumber)}</div><svg class="bar" data-lote="${esc(entry.lotNumber)}"></svg></div>
      <div class="dat"><div><small>ELABORACIÓN</small><b>${dmy(b.fecha || entry.entryDate)}</b></div><div><small>PESO</small><b>${kgTxt(entry.qty, 2)} kg</b></div><div class="v"><small>VENCE</small><b>${dmy(entry.expiryDate)}</b></div></div>
      <div class="pie"><b>Contiene:</b> ${esc(contiene)}.<br>Conservar en lugar seco y fresco, envase cerrado · Uso interno · RNE 21-85083 · Resp.: ${esc(b.responsable || '__________')}</div></div>`;
    const u = (mm) => `${(mm * f.s).toFixed(2)}mm`; const p = (pt) => `${(pt * f.s).toFixed(2)}pt`;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Rótulo ${esc(entry.lotNumber)}</title>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"><\/script><style>
      @page{size:${f.page};margin:${f.margin}}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#0F1B2D}
      .hoja{display:grid;grid-template-columns:repeat(${f.cols},max-content);gap:${f.cols > 1 ? '5mm 5mm' : '0'};justify-content:center}
      .et{width:${u(100)};height:${u(70)};border:${f.borde ? `${u(0.35)} solid #0F1B2D` : '0'};border-radius:${f.borde ? u(2.5) : '0'};overflow:hidden;display:flex;flex-direction:column;page-break-inside:avoid;background:#fff}
      .cab{background:#0F1B2D;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:${u(1.6)} ${u(3)};font-weight:700;letter-spacing:.05em;font-size:${p(6.5)}}
      .cab .tipo{font-size:${p(7.5)};color:#7fd8ee}
      .nom{font-size:${p(10.5)};font-weight:800;padding:${u(1.6)} ${u(3)} 0;line-height:1.15}
      .lw{text-align:center;padding:0 ${u(3)}}.lw small{font-size:${p(5.5)};font-weight:700;color:#5A6573;letter-spacing:.12em}
      .lot{font-size:${p(19)};font-weight:900;line-height:1}.bar{display:block;margin:${u(0.6)} auto 0;height:${u(10)};width:${u(78)}}
      .dat{display:grid;grid-template-columns:repeat(3,1fr);gap:${u(1.5)};padding:${u(1.4)} ${u(3)} 0}
      .dat div{background:#f1f4f7;border-radius:${u(1)};padding:${u(0.8)} ${u(1.5)}}.dat small{display:block;font-size:${p(5)};font-weight:700;color:#5A6573;letter-spacing:.08em}
      .dat b{font-size:${p(9.5)}}.dat .v{background:#e8f6ec;outline:${u(0.3)} solid #15803d}.dat .v b{color:#0f6b31}
      .pie{margin-top:auto;font-size:${p(5.6)};color:#3b4652;padding:${u(1.2)} ${u(3)} ${u(1.8)};line-height:1.3}
      </style></head><body><div class="hoja">${una.repeat(f.n)}</div>
      <script>document.querySelectorAll('svg.bar').forEach(function(s){try{JsBarcode(s,s.dataset.lote,{format:'CODE128',displayValue:false,margin:0,height:60,width:2});}catch(e){}});<\/script></body></html>`;
  };

  const imprimirPlanilla = (entry, ingredientName = '') => imprimirHtml(planillaHtml(entry, ingredientName));
  const imprimirRotulo = async (entry, ingredientName = '') => {
    const res = await Swal.fire({ title: 'Rótulo del batch', input: 'radio',
      inputOptions: { zebra: 'Zebra 100 × 70 mm', a4: 'A4 · 6 rótulos', a4uno: 'A4 · 1 rótulo grande' }, inputValue: 'zebra',
      showCancelButton: true, confirmButtonText: 'Imprimir', cancelButtonText: 'Cancelar' });
    if (res.isConfirmed) await imprimirHtml(rotuloHtml(entry, ingredientName, res.value));
  };

  // ── modal «Preparar batch» ──
  const tablaPlanHtml = (plan) => {
    const filas = plan.componentes.map((c) => `<tr><td>${esc(cap(c.ingredientName))}</td><td>${c.infinito && !c.lotes.length ? `<small>${esc(c.nota)}</small>`
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
