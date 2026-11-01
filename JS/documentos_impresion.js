// Documentos imprimibles con el diseño ABR: «Recetas de producción» y «Producción semanal».
// Funciones puras: reciben los datos y devuelven el HTML completo; quien las llama abre la ventana o el iframe.
(() => {
  const LOGO_ABR = 'IMG/ABR LOGO.png';
  const LOGO_LJ = 'IMG/La Jamonera App.png';
  const FONT = 'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400&display=swap';

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (s) => parseFloat(String(s ?? '').replace(',', '.')) || 0;
  const fmt = (n, min = 0, max = min) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: min, maximumFractionDigits: max });
  const pad = (n) => String(n).padStart(2, '0');
  const obj = (v) => (v && typeof v === 'object' ? v : {});

  const ACENTOS = { azucar: 'azúcar', oregano: 'orégano', aji: 'ají', pimenton: 'pimentón', jamon: 'jamón', almidon: 'almidón' };
  const nombreIngrediente = (s) => {
    const t = String(s || '')
      .replace(/(^|[^a-záéíóúñ])(azucar|oregano|aji|pimenton|jamon|almidon)(?![a-záéíóúñ])/gi, (m, p, w) => p + ACENTOS[w.toLowerCase()])
      .replace(/^mp /i, 'MP ');
    return t ? t[0].toUpperCase() + t.slice(1) : '';
  };
  const MINUSCULAS = new Set(['de', 'del', 'con', 'a', 'la', 'el', 'y', 'en', 'sin']);
  const nombreProducto = (s) => {
    const t = String(s || '').trim();
    if (!t) return '';
    if (t === t.toUpperCase() && !/\s/.test(t)) return t; // CHORIMAX y otras marcas de una palabra
    return t.toLowerCase()
      .replace(/(^|\s|\()jamon(?=\s|$)/g, '$1jamón')
      .replace(/(^|\s)salamin(?=\s|$)/g, '$1salamín')
      .replace(/albondiga/g, 'albóndiga')
      .replace(/\(rapido\)/, '(rápido)')
      .split(/\s+/)
      .map((w, i) => (!i || !MINUSCULAS.has(w) ? w.replace(/^\(?./, (c) => c.toUpperCase()) : w))
      .join(' ');
  };
  const tituloDe = (x, fila = {}) => nombreProducto(x.nombreComercial || fila.recipeNombreComercial || x.title || fila.recipeTitle || 'Sin nombre');
  const grupoDe = (x, grupos) => grupos[x.recipeGroupId] || { name: 'Sin carpeta', order: 99 };
  const hoy = () => new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const urlDe = (base, ruta) => new URL(ruta, base).href;

  const CSS_BASE = `@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0}body{font-family:Inter,Arial,sans-serif;color:#0F1B2D;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:9pt}
  @media screen{html{background:#E8E8E8}.cover,.pg,.wk{margin:10px auto;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.25)}}
  .cover{width:210mm;height:296.5mm;padding:17mm 21mm 14mm;position:relative;overflow:hidden;break-after:page}.logo{height:1.8cm;display:block}.marca{font-size:7.5pt;font-weight:800;letter-spacing:.22em;color:#00ABD4;text-transform:uppercase;margin-top:5px}
  .kick{margin:0;font-size:7.5pt;font-weight:800;letter-spacing:.2em;color:#5A6573;text-transform:uppercase}.c1{margin-top:24px}
  h1{font-weight:900;font-size:40pt;line-height:.98;margin:9px 0 10px;letter-spacing:-.01em}h1 span{display:block;color:#00ABD4}.subt{font-style:italic;font-size:13pt;color:#5A6573;line-height:1.3;margin:0 0 16px}.rule{height:3px;background:#00ABD4;margin:0 0 13px}
  .tiles3{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.tile{background:#F1ECE1;border-left:3px solid #00ABD4;padding:8px 10px}.tile small{display:block;font-size:6.4pt;font-weight:800;letter-spacing:.15em;color:#00ABD4;text-transform:uppercase;margin-bottom:4px}.tile b{font-size:9pt;font-weight:700}
  .idx{margin-top:13px;width:100%;border-collapse:collapse;font-size:8.3pt}.idx th{font-size:6.4pt;font-weight:800;letter-spacing:.14em;color:#00ABD4;text-transform:uppercase;text-align:left;border-bottom:2px solid #00ABD4;padding:4px 6px}.idx td{padding:3.6px 6px;border-bottom:1px solid #E6E0D3}.idx tbody tr:nth-child(even) td{background:#FBF9F4}.idx th.n,.idx td.n{text-align:right;font-variant-numeric:tabular-nums}.idx .gris{color:#5A6573}.idx tfoot td{font-weight:800;border-top:1.5px solid #0F1B2D;border-bottom:0}
  .nota{position:absolute;left:21mm;right:21mm;bottom:12mm;display:flex;gap:10px;align-items:center;justify-content:center;background:#FBF9F4;border:1px solid #E6E0D3;padding:8px}.nota img{height:9mm;border-radius:2mm}.nota b{display:block;font-size:10pt}.nota small{font-size:6.6pt;font-weight:800;letter-spacing:.16em;color:#00ABD4;text-transform:uppercase}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #00ABD4}
  footer{position:absolute;display:flex;justify-content:space-between;font-size:7pt;color:#5A6573;border-top:1px solid #E6E0D3}`;

  const CSS_RECETAS = `.pg{width:210mm;min-height:296.5mm;padding:13mm 15mm 14mm;position:relative;break-after:page}.pg:last-child{break-after:auto}footer{left:15mm;right:15mm;bottom:7mm;padding-top:4px}
  header{padding-bottom:8px}header img{height:13mm;border-radius:3mm}h2{font-size:23pt;font-weight:900;line-height:1.05;margin:4px 0 0;letter-spacing:-.01em}.deno{margin:3px 0 0;color:#5A6573;font-style:italic;font-size:10.5pt}
  .tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-top:9px}.tiles .tile{padding:6px 8px}.tiles .tile b{font-size:8.6pt}
  h3{font-size:7pt;font-weight:800;letter-spacing:.17em;text-transform:uppercase;color:#00ABD4;margin:11px 0 4px}
  .f{width:100%;border-collapse:collapse;font-size:8.8pt}.f th{font-size:6.4pt;letter-spacing:.13em;text-transform:uppercase;color:#5A6573;border-bottom:1.5px solid #0F1B2D;padding:3px 6px;text-align:left}.f th.n{text-align:right;white-space:nowrap}.f td{padding:3.2px 6px;border-bottom:1px solid #E6E0D3;vertical-align:top}.f b{font-weight:600}.f .i{width:22px;color:#5A6573}.f td.n{text-align:right;white-space:nowrap;font-weight:700;font-variant-numeric:tabular-nums}.f td.n span{font-weight:500;color:#5A6573}.f td.p{font-weight:500;color:#5A6573}.f tfoot td{border-top:1.5px solid #0F1B2D;border-bottom:0;font-weight:800;background:#FBF9F4}.sub{font-size:7.1pt;color:#5A6573;margin-top:1px;line-height:1.35}
  .note{margin:0 0 3px;padding:5px 8px;background:#FBF9F4;border-left:3px solid #E6E0D3;font-size:8pt;line-height:1.4}
  .cols{display:grid;grid-template-columns:1fr 76mm;gap:8mm}.octs{display:flex;flex-wrap:wrap;gap:6px}.oct{position:relative;width:21mm;height:21mm;color:#fff;text-align:center}.oct svg{position:absolute;inset:0;width:100%;height:100%}.octt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Arial,Helvetica,sans-serif}.octt b{font-size:6.4pt;line-height:1.08;font-weight:900}.octt small{font-size:3.9pt;line-height:1.05;margin-top:2px;font-weight:700}
  dl{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin:0}dt{font-size:6pt;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#5A6573}dd{margin:1px 0 0;font-size:8pt;font-weight:600;line-height:1.25}.muted{color:#5A6573;margin:0;font-size:8pt}
  .recipe-nutrition-label-card{border:2px solid #111;padding:7px 8px;font-family:Arial,Helvetica,sans-serif;color:#111}.recipe-nutrition-label-card h3{color:#111;margin:0;font-size:11pt;white-space:nowrap;letter-spacing:0;font-weight:900;text-transform:none}.recipe-nutrition-serving,.recipe-nutrition-subtitle,.recipe-nutrition-dv,.recipe-nutrition-micros,.recipe-nutrition-footnote{margin:2px 0;font-size:7.4pt;line-height:1.25}.recipe-nutrition-dv{text-align:right;font-weight:700}.recipe-nutrition-footnote{font-size:6pt;color:#333}.recipe-nutrition-bar{height:5px;background:#111;margin:3px 0}.recipe-nutrition-rule{border-top:1px solid #111;margin:2px 0}.recipe-nutrition-two-cols{display:flex;justify-content:space-between;font-weight:800;font-size:7.8pt}.recipe-nutrition-table-fixed{width:100%;border-collapse:collapse}.recipe-nutrition-table-fixed td{border-top:1px solid #111;padding:1.7px 0;font-weight:700;font-size:7.5pt}.recipe-nutrition-table-fixed td:last-child{text-align:right}.recipe-nutrition-table-fixed .indent{padding-left:11px;font-weight:500}
  .roomy h3{margin:17px 0 6px;font-size:7.6pt}.roomy .f{font-size:10.2pt}.roomy .f td{padding:6px 7px}.roomy .sub{font-size:8pt;margin-top:2px}.roomy .tiles{margin-top:12px}.roomy .tiles .tile{padding:9px}.roomy .tiles .tile b{font-size:9.4pt}.roomy .note{font-size:9pt;padding:7px 9px}
  .roomy .cols{grid-template-columns:1fr 84mm}.roomy .oct{width:25mm;height:25mm}.roomy .octt b{font-size:7.6pt}.roomy .octt small{font-size:4.6pt}.roomy dl{gap:7px 10px}.roomy dt{font-size:6.5pt}.roomy dd{font-size:9pt}
  .roomy .recipe-nutrition-label-card{padding:9px 10px}.roomy .recipe-nutrition-label-card h3{font-size:12.5pt;margin:0}.roomy .recipe-nutrition-serving,.roomy .recipe-nutrition-subtitle,.roomy .recipe-nutrition-dv,.roomy .recipe-nutrition-micros{font-size:8.2pt;margin:3px 0}.roomy .recipe-nutrition-footnote{font-size:6.6pt;margin:3px 0}.roomy .recipe-nutrition-two-cols{font-size:8.8pt}.roomy .recipe-nutrition-table-fixed td{font-size:8.4pt;padding:3px 0}.roomy .recipe-nutrition-table-fixed td.indent{padding-left:13px}`;

  const CSS_SEMANAL = `@page apaisada{size:A4 landscape;margin:0}.wk{page:apaisada;width:297mm;height:209.5mm;padding:10mm 13mm 12mm;position:relative;overflow:hidden;break-after:page}.wk:last-child{break-after:auto}footer{left:13mm;right:13mm;bottom:5.5mm;padding-top:3px}
  .idx{margin-top:15px;font-size:9pt}.idx td{padding:5px 6px}
  header{padding-bottom:6px}header img{height:11mm;border-radius:2.5mm}h2{font-size:19pt;font-weight:900;line-height:1.05;margin:3px 0 0;letter-spacing:-.01em}h2 span{font-weight:500;color:#5A6573;font-size:14pt}
  .wt{display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:6px;margin:7px 0}.wt .tile{padding:5px 9px}
  .g{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10pt}.g th{font-size:6.6pt;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fff;background:#0F1B2D;padding:6px 7px;text-align:right}.g th.pr{width:60mm;text-align:left}.g th.t{width:25mm;background:#00ABD4}.g th i{display:block;font-style:normal;font-weight:500;letter-spacing:.02em;opacity:.8;font-size:6.6pt;margin-top:1px}
  .g td{border-bottom:1px solid #E6E0D3;padding:4.6px 7px;text-align:right;font-variant-numeric:tabular-nums}.g td.v{border-left:1px solid #F1ECE1;font-weight:600}.g td.pr{text-align:left}.g td.pr b{font-weight:700;display:block;font-size:9.6pt}.g td.pr small{display:block;font-size:7pt;color:#5A6573;line-height:1.15}.g td.t{font-weight:800;background:#FBF9F4;border-left:1.5px solid #0F1B2D}
  .g tr.grp td{text-align:left;font-size:6.4pt;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#00ABD4;padding:6px 7px 2px;border-bottom:1px solid #00ABD4;background:#fff}.g tr.off td.pr b{color:#8A94A0;font-weight:600}.g tr.off td.pr small{color:#A5ADB6}.g tr.off td.t{color:#A5ADB6;font-weight:500}
  .g tfoot td{border-top:1.5px solid #0F1B2D;border-bottom:0;background:#F1ECE1;font-weight:800;padding:6px 7px}.g tfoot td.v{border-left:1px solid #E6E0D3}
  .m{font-size:9pt}.m th.pr{width:52mm}.m th.t{width:20mm}.m th{padding:6px 2px;text-align:center;letter-spacing:.04em}.m td.v{padding:5.4px 2px;text-align:center}.res .g td.t{padding:5.4px 6px}.res header{margin-bottom:9px}`;

  const SCRIPT_IMPRIMIR = `<script>(()=>{const imgs=Promise.all([...document.images].map((i)=>i.complete?0:new Promise((r)=>{i.onload=r;i.onerror=r;})));const f=document.fonts?document.fonts.ready:Promise.resolve();Promise.all([imgs,f]).finally(()=>setTimeout(()=>{window.focus();window.print();},350));})();<\/script>`;

  const documento = (titulo, css, cuerpo, autoImprimir) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><link href="${FONT}" rel="stylesheet"><style>${CSS_BASE}${css}</style></head><body>${cuerpo}${autoImprimir ? SCRIPT_IMPRIMIR : ''}</body></html>`;
  const caratula = ({ base, t1, t2, sub, tiles, indice }) => `<section class="cover"><img class="logo" src="${urlDe(base, LOGO_ABR)}"><div class="marca">Asesoría Bromatológica · Rosario</div><p class="kick c1">Registro · Producción</p><h1>${esc(t1)}<span>${esc(t2)}</span></h1><p class="subt">${esc(sub)}</p><div class="rule"></div>
    <div class="tiles3">${tiles.map(([k, v]) => `<div class="tile"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>${indice}
    <div class="nota"><img src="${urlDe(base, LOGO_LJ)}"><div><b>La Jamonera</b><small>Actualizado al ${esc(hoy())}</small></div></div></section>`;

  // ---------- Recetas ----------
  const SELLOS = {
    'EXCESO EN AZÚCARES': 'EXCESO EN<br>AZÚCARES',
    'EXCESO EN SODIO': 'EXCESO EN<br>SODIO',
    'EXCESO EN GRASAS TOTALES': 'EXCESO EN<br>GRASAS<br>TOTALES',
    'EXCESO EN GRASAS SATURADAS': 'EXCESO EN<br>GRASAS<br>SATURADAS',
    'EXCESO EN CALORÍAS': 'EXCESO EN<br>CALORÍAS'
  };
  const ORDEN_SELLOS = Object.keys(SELLOS);
  const octogonos = (labels) => {
    const lista = [...new Set((Array.isArray(labels) ? labels : []).map((l) => String(l || '').trim().toUpperCase()))]
      .filter((l) => SELLOS[l])
      .sort((a, b) => ORDEN_SELLOS.indexOf(a) - ORDEN_SELLOS.indexOf(b));
    if (!lista.length) return '<p class="muted">Sin sellos de advertencia.</p>';
    return lista.map((l) => `<div class="oct"><svg viewBox="0 0 100 100"><polygon points="29,1 71,1 99,29 99,71 71,99 29,99 1,71 1,29" fill="#111"/><polygon points="31,5 69,5 95,31 95,69 69,95 31,95 5,69 5,31" fill="none" stroke="#fff" stroke-width="1.6"/></svg><div class="octt"><b>${SELLOS[l]}</b><small>Ministerio<br>de Salud</small></div></div>`).join('');
  };
  const UNIDADES = { kilos: ['kg', 1], kilo: ['kg', 1], kg: ['kg', 1], gramos: ['g', 0.001], gramo: ['g', 0.001], g: ['g', 0.001], litros: ['l', 1], litro: ['l', 1], mililitros: ['ml', 0.001], ml: ['ml', 0.001] };
  const dato = (k, v) => `<div><dt>${esc(k)}</dt><dd>${esc(v || '-')}</dd></div>`;
  const dmyIso = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s).split('-').reverse().join('/') : (s || '-'));
  const sinRnpa = (x) => Boolean(x.rnpaExempt || x.rnpaNotRequired);

  const hojaReceta = (e, i, total, ctx) => {
    const { x, g, nombre } = e;
    const filas = (Array.isArray(x.rows) ? x.rows : []).filter((r) => r && r.type === 'ingredient' && r.ingredientName);
    const notas = (Array.isArray(x.rows) ? x.rows : []).filter((r) => r && r.type === 'comment' && r.comment);
    const unidad = (r) => UNIDADES[String(r.unit || '').trim().toLowerCase()] || [String(r.unit || ''), null];
    const totalKg = filas.reduce((s, r) => s + (unidad(r)[1] === null ? 0 : num(r.quantity) * unidad(r)[1]), 0);
    const adobos = Object.values(obj(ctx.adobos));
    const trs = filas.map((r, n) => {
      const a = adobos.find((ad) => ad.nombre === r.ingredientName);
      const q = num(r.quantity);
      const [u, f] = unidad(r);
      const comp = a && Array.isArray(a.componentes) && a.base
        ? `<div class="sub">${a.componentes.map((c) => `${esc(nombreIngrediente(c.ingredientName))} ${fmt((q * c.kg) / a.base, 0, 3)}`).join(' · ')} kg</div>`
        : '';
      const pct = f === null || !totalKg ? '-' : `${fmt(((q * f) / totalKg) * 100, 0, 2)} %`;
      return `<tr><td class="i">${n + 1}</td><td><b>${esc(nombreIngrediente(r.ingredientName))}</b>${comp}</td><td class="n">${esc(r.quantity)} <span>${esc(u)}</span></td><td class="n p">${pct}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="muted">Sin ingredientes cargados.</td></tr>';
    const exento = sinRnpa(x);
    const rn = obj(x.rnpa);
    const nu = obj(x.nutrition);
    const ai = obj(nu.ai);
    const espera = x.packagingDelayType === 'freeze_before_packaging' ? 'Congelado previo' : 'Estacionado';
    const rinde = [x.yieldQuantity, (UNIDADES[String(x.yieldUnit || '').toLowerCase()] || [x.yieldUnit || ''])[0]].filter(Boolean).join(' ');
    const vida = x.shelfLifeDays ? `${x.shelfLifeDays} días${x.frozenShelfLifeExtension ? ' (−18 °C)' : ''}` : '-';
    const tiles = [['Carpeta', g.name], ['Rinde', rinde || '-'], ['Vida útil', vida], [espera, num(x.agingDays) ? `${x.agingDays} días` : 'No posee'], ['RNPA', exento ? 'No requiere' : (rn.number || '-')]];
    // El renglón «Ingredientes» guardado con la tabla queda viejo cuando cambia la fórmula: no se imprime.
    const tabla = String(ai.tableHtml || '')
      .replace(/<br>\s*Ingredientes:[^<]*/i, '')
      .replace(/<p class="recipe-nutrition-product-name">[^<]*<\/p>/, '');
    const deno = nombreProducto(x.title);
    const gridRnpa = exento
      ? dato('Estado', 'Subproducto: no requiere RNPA') + dato('Motivo', 'Venta en mostrador')
      : dato('Número', rn.number) + dato('Vencimiento', dmyIso(rn.expiryDate)) + dato('Denominación', rn.denomination) + dato('Marca', rn.brand) + dato('Razón social', rn.businessName) + dato('Localidad', [rn.city, rn.province].filter(Boolean).join(', '));
    const gridNut = dato('Porción', [nu.declarationAmount, nu.declarationUnit].filter(Boolean).join(' '))
      + dato('Porciones por envase', nu.servingsPerPackage)
      + dato('Medida casera', [nu.householdAmount, nu.householdMeasure].filter(Boolean).join(' '))
      + dato('Subcategoría', nu.subcategory ? nu.subcategory[0].toUpperCase() + nu.subcategory.slice(1) : '');
    const pie = total > 1 ? `${i + 2} / ${total + 1}` : '';
    return `<section class="pg${filas.length <= 10 ? ' roomy' : ''}"><header><div><p class="kick">${total > 1 ? `Receta ${pad(i + 1)} · ` : ''}${esc(g.name)}</p><h2>${esc(nombre)}</h2>${deno && deno !== nombre ? `<p class="deno">${esc(deno)}</p>` : ''}</div><img src="${urlDe(ctx.base, LOGO_LJ)}"></header>
      <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>
      <h3>Fórmula</h3><table class="f"><thead><tr><th>#</th><th>Ingrediente</th><th class="n">Cantidad</th><th class="n">% fórmula</th></tr></thead><tbody>${trs}</tbody><tfoot><tr><td></td><td>Total fórmula</td><td class="n">${fmt(totalKg, 0, 3)} kg</td><td class="n">100 %</td></tr></tfoot></table>
      ${notas.length ? `<h3>Notas</h3>${notas.map((r) => `<p class="note">${esc(r.comment)}</p>`).join('')}` : ''}
      <div class="cols"><div><h3>Etiquetado frontal</h3><div class="octs">${octogonos(ai.frontLabels)}</div><h3>RNPA</h3><dl>${gridRnpa}</dl><h3>Datos nutricionales</h3><dl>${gridNut}</dl></div><div><h3>Tabla nutricional</h3>${tabla || '<p class="muted">Sin tabla generada.</p>'}</div></div>
      <footer><span>Recetas de producción · La Jamonera</span><span>${pie}</span></footer></section>`;
  };

  // ctx: { recipes: [], groups: {}, adobos: {}, base: URL de la app, autoImprimir }
  const recetasHtml = (ctx) => {
    const grupos = obj(ctx.groups);
    const lista = (ctx.recipes || []).filter(Boolean)
      .map((x) => ({ x, g: grupoDe(x, grupos), nombre: tituloDe(x) }))
      .sort((a, b) => (a.g.order ?? 99) - (b.g.order ?? 99) || a.nombre.localeCompare(b.nombre, 'es'));
    const hojas = lista.map((e, i) => hojaReceta(e, i, lista.length, ctx)).join('');
    let portada = '';
    if (lista.length > 1) {
      const conRnpa = lista.filter((e) => !sinRnpa(e.x)).length;
      const filas = lista.map((e, i) => `<tr><td class="gris">${pad(i + 1)}</td><td><b>${esc(e.nombre)}</b></td><td class="gris">${esc(e.g.name)}</td><td>${sinRnpa(e.x) ? 'No requiere' : esc(obj(e.x.rnpa).number || '-')}</td><td class="n">${i + 2}</td></tr>`).join('');
      portada = caratula({
        base: ctx.base,
        t1: 'Recetas de',
        t2: 'producción',
        sub: 'fórmula, etiquetado frontal y tabla nutricional de cada producto elaborado',
        tiles: [['Recetas', `${lista.length} productos`], ['Con RNPA', `${conRnpa} de ${lista.length}`], ['Carpetas', `${new Set(lista.map((e) => e.g.name)).size}`]],
        indice: `<table class="idx"><thead><tr><th>N°</th><th>Producto</th><th>Carpeta</th><th>RNPA</th><th class="n">Página</th></tr></thead><tbody>${filas}</tbody></table>`
      });
    }
    const titulo = lista.length === 1 ? `${lista[0].nombre} - La Jamonera` : 'Recetas de producción - La Jamonera';
    return documento(titulo, CSS_RECETAS, portada + hojas, ctx.autoImprimir);
  };

  // ---------- Producción semanal ----------
  const fechaDe = (s) => new Date(`${s}T00:00:00`);
  const isoDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sumar = (s, n) => { const d = fechaDe(s); d.setDate(d.getDate() + n); return isoDe(d); };
  const lunesDe = (s) => { const w = fechaDe(s).getDay(); return sumar(s, w === 0 ? -6 : 1 - w); };
  const dm = (s) => `${s.slice(8)}/${s.slice(5, 7)}`;
  const dmy = (s) => `${dm(s)}/${s.slice(0, 4)}`;
  const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const kilos = (r) => Number(r.quantityKg || 0);
  const totalDe = (filas) => filas.reduce((a, r) => a + kilos(r), 0);
  const colorDe = (v, max) => (v > 0 && max > 0 ? `background:rgba(0,171,212,${(0.08 + 0.3 * Math.sqrt(v / max)).toFixed(3)})` : '');

  // ctx: { rows: registros, recipes: {id: receta}, groups: {}, from, to, excluded: Set de ids, base }
  // Devuelve null si no hay producción en el período.
  const semanalHtml = (ctx) => {
    const recetas = obj(ctx.recipes);
    const grupos = obj(ctx.groups);
    const excluidos = ctx.excluded || new Set();
    const idDe = (r) => String(r.recipeId || r.recipeTitle || r.id || '').trim();
    const filas = (ctx.rows || []).filter((r) => r && r.productionDate >= ctx.from && r.productionDate <= ctx.to && String(r.status || '') !== 'anulada' && !excluidos.has(idDe(r)) && kilos(r) > 0);
    if (!filas.length) return null;
    const porId = {};
    filas.forEach((r) => {
      const id = idDe(r);
      if (porId[id]) return;
      const x = obj(recetas[r.recipeId]);
      porId[id] = { id, nombre: tituloDe(x, r), deno: nombreProducto(x.title || r.recipeTitle), g: grupoDe(x, grupos) };
    });
    const prods = Object.values(porId).sort((a, b) => (a.g.order ?? 99) - (b.g.order ?? 99) || a.nombre.localeCompare(b.nombre, 'es'));
    const fechas = filas.map((r) => r.productionDate).sort();
    const primera = fechas[0];
    const ultima = fechas[fechas.length - 1];
    const semanas = [];
    for (let c = lunesDe(primera); c <= ultima; c = sumar(c, 7)) {
      const fin = sumar(c, 6);
      const deLaSemana = filas.filter((r) => r.productionDate >= c && r.productionDate <= fin);
      const conFinde = deLaSemana.some((r) => [0, 6].includes(fechaDe(r.productionDate).getDay()));
      semanas.push({ n: semanas.length + 1, inicio: c, finVisible: conFinde ? fin : sumar(c, 4), dias: Array.from({ length: conFinde ? 7 : 5 }, (_, i) => sumar(c, i)), filas: deLaSemana, kg: totalDe(deLaSemana), diasProd: new Set(deLaSemana.map((r) => r.productionDate)).size });
    }
    const TOTAL = totalDe(filas);
    const diasTot = new Set(fechas).size;
    const hayResumen = semanas.length > 1;
    const totalHojas = semanas.length + (hayResumen ? 2 : 1);
    const primeraSemana = hayResumen ? 3 : 2;
    const FT = 'Producción semanal · La Jamonera';
    const celda = (lista, p, dia) => totalDe(lista.filter((r) => idDe(r) === p.id && r.productionDate === dia));
    const maxCelda = Math.max(...semanas.flatMap((w) => prods.flatMap((p) => w.dias.map((d) => celda(w.filas, p, d)))));
    const celdaProd = (p) => `<td class="pr"><b>${esc(p.nombre)}</b>${p.deno && p.deno !== p.nombre ? `<small>${esc(p.deno)}</small>` : ''}</td>`;
    const conGrupos = (cols, fila) => {
      let cur = null;
      return prods.map((p) => {
        const sep = p.g.name !== cur ? `<tr class="grp"><td colspan="${cols}">${esc(p.g.name)}</td></tr>` : '';
        cur = p.g.name;
        return sep + fila(p);
      }).join('');
    };
    const logo = urlDe(ctx.base, LOGO_LJ);
    const hojaSemana = (w) => {
      const cuerpo = conGrupos(w.dias.length + 2, (p) => {
        const vals = w.dias.map((d) => celda(w.filas, p, d));
        const t = vals.reduce((a, b) => a + b, 0);
        return `<tr class="${t ? '' : 'off'}">${celdaProd(p)}${vals.map((v) => `<td class="v" style="${colorDe(v, maxCelda)}">${v ? fmt(v, 2) : ''}</td>`).join('')}<td class="t">${t ? fmt(t, 2) : '–'}</td></tr>`;
      });
      const porDia = w.dias.map((d) => totalDe(w.filas.filter((r) => r.productionDate === d)));
      const top = prods.map((p) => [p, totalDe(w.filas.filter((r) => idDe(r) === p.id))]).sort((a, b) => b[1] - a[1])[0];
      const tiles = [['Kilos elaborados', `${fmt(w.kg, 1)} kg`], ['Producciones', `${w.filas.length}`], ['Días con producción', `${w.diasProd}`], ['Mayor volumen', w.kg ? `${top[0].nombre} · ${fmt(top[1], 1)} kg` : '-']];
      return `<section class="wk"><header><div><p class="kick">Semana ${pad(w.n)} de ${semanas.length}</p><h2>${dmy(w.inicio)} <span>al</span> ${dmy(w.finVisible)}</h2></div><img src="${logo}"></header>
        <div class="wt">${tiles.map(([k, v]) => `<div class="tile"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>
        <table class="g"><thead><tr><th class="pr">Producto</th>${w.dias.map((d) => `<th class="v">${DIAS[fechaDe(d).getDay()]}<i>${dm(d)}</i></th>`).join('')}<th class="t">Total kg</th></tr></thead><tbody>${cuerpo}</tbody>
        <tfoot><tr><td class="pr">Total del día</td>${porDia.map((v) => `<td class="v">${v ? fmt(v, 2) : ''}</td>`).join('')}<td class="t">${fmt(w.kg, 2)}</td></tr></tfoot></table>
        <footer><span>${FT}</span><span>${w.n + primeraSemana - 1} / ${totalHojas}</span></footer></section>`;
    };
    let resumen = '';
    if (hayResumen) {
      const porSemana = (p, w) => totalDe(w.filas.filter((r) => idDe(r) === p.id));
      const maxSem = Math.max(...semanas.flatMap((w) => prods.map((p) => porSemana(p, w))));
      const cuerpo = conGrupos(semanas.length + 2, (p) => {
        const vals = semanas.map((w) => porSemana(p, w));
        return `<tr>${celdaProd(p)}${vals.map((v) => `<td class="v" style="${colorDe(v, maxSem)}">${v ? fmt(v, 0) : ''}</td>`).join('')}<td class="t">${fmt(vals.reduce((a, b) => a + b, 0), 1)}</td></tr>`;
      });
      resumen = `<section class="wk res"><header><div><p class="kick">Resumen del período</p><h2>Kilos por producto y semana</h2></div><img src="${logo}"></header>
        <table class="g m"><thead><tr><th class="pr">Producto</th>${semanas.map((w) => `<th class="v">S${w.n}<i>${dm(w.inicio)}</i></th>`).join('')}<th class="t">Total kg</th></tr></thead><tbody>${cuerpo}</tbody>
        <tfoot><tr><td class="pr">Total semana</td>${semanas.map((w) => `<td class="v">${w.kg ? fmt(w.kg, 0) : ''}</td>`).join('')}<td class="t">${fmt(TOTAL, 1)}</td></tr></tfoot></table>
        <footer><span>${FT}</span><span>2 / ${totalHojas}</span></footer></section>`;
    }
    const idx = semanas.map((w) => `<tr><td class="gris">${pad(w.n)}</td><td><b>${dm(w.inicio)} al ${dm(w.finVisible)}</b></td><td class="n">${w.filas.length || '–'}</td><td class="n">${w.diasProd || '–'}</td><td class="n">${w.kg ? fmt(w.kg, 1) : '–'}</td><td class="n">${w.n + primeraSemana - 1}</td></tr>`).join('');
    const portada = caratula({
      base: ctx.base,
      t1: 'Producción',
      t2: 'semanal',
      sub: 'kilos elaborados por producto y por día, semana a semana',
      tiles: [['Período', `${dmy(primera)} al ${dmy(ultima)}`], ['Semanas', `${semanas.length}`], ['Productos', `${prods.length}`], ['Kilos elaborados', `${fmt(TOTAL, 1)} kg`], ['Producciones', `${filas.length}`], ['Días con producción', `${diasTot}`]],
      indice: `<table class="idx"><thead><tr><th>N°</th><th>Semana</th><th class="n">Producciones</th><th class="n">Días</th><th class="n">Kilos</th><th class="n">Página</th></tr></thead><tbody>${idx}</tbody><tfoot><tr><td></td><td>Total</td><td class="n">${filas.length}</td><td class="n">${diasTot}</td><td class="n">${fmt(TOTAL, 1)}</td><td></td></tr></tfoot></table>`
    });
    return documento('Producción semanal - La Jamonera', CSS_SEMANAL, portada + resumen + semanas.map(hojaSemana).join(''), ctx.autoImprimir);
  };

  window.laJamoneraDocumentos = { recetasHtml, semanalHtml };
})();
