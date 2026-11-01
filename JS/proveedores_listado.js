// Listados de proveedores para auditoría (portada A4 vertical + tablas A4 apaisado, en una sola impresión).
//   · «Listado de proveedores»: registro sanitario, rubro, productos, localidad y conservación.
//   · «Proveedores y materias primas»: lo que se le compra a cada uno, según los ingresos del inventario.
// Los datos salen de provider.listado (se cargan en el Centro de proveedores):
//   { incluir, nombre (razón social; vacío = nombre del proveedor), cuit, localidad, registro, verificacion, alias: [nombres], mpExcluidos: [ingredientId],
//     perecedero: { activo, rubro, productos, conservacion }, noPerecedero: { activo, rubro, productos, conservacion } }
// Si un proveedor está en los dos grupos, sus materias primas se separan por el flag «no perecedero» del ingreso.
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dmy = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const hoyAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const up = (s) => String(s || '').trim().toUpperCase();
  const txt = (s) => String(s || '').trim();

  const GRUPOS = [
    { key: 'perecedero', cls: 'p', titulo: 'PROVEEDORES DE MATERIAS PRIMAS PERECEDERAS', tituloMp: 'MATERIAS PRIMAS PERECEDERAS', etiqueta: 'Perecederos' },
    { key: 'noPerecedero', cls: 'np', titulo: 'PROVEEDORES DE MATERIAS PRIMAS NO PERECEDERAS', tituloMp: 'MATERIAS PRIMAS NO PERECEDERAS', etiqueta: 'No perecederos' }
  ];
  const CONSERVACION = ['Refrigerado 0-4 °C / Congelado ≤ -18 °C', 'Refrigerado, en sal / salmuera', 'Ambiente, seco, fresco', 'Ambiente, seco, protegido de polvo', 'Ambiente, seco', 'Depósito de químicos, separado de alimentos'];
  const NOTAS = [
    '<b>Perecederos:</b> carnes vacunas y porcinas, aves, lechones, achuras y tripas naturales. <b>No perecederos:</b> aditivos, especias, sales, derivados de soja, legumbres, tripas artificiales, envases y productos de limpieza.',
    '<b>Registros:</b> N° SENASA = establecimiento con habilitación nacional; RNE = Registro Nacional de Establecimiento (ASSAL u otra autoridad provincial); RUCA = matrícula del matarife o abastecedor (faena en un establecimiento SENASA); ANMAT = establecimiento de domisanitarios.'
  ];

  const listadoDe = (provider) => {
    const l = provider?.listado || {};
    const g = (x) => ({ activo: Boolean(x?.activo), rubro: txt(x?.rubro), productos: txt(x?.productos), conservacion: txt(x?.conservacion) });
    return {
      incluir: Boolean(l.incluir), nombre: txt(l.nombre), cuit: txt(l.cuit), localidad: txt(l.localidad), registro: txt(l.registro), verificacion: txt(l.verificacion),
      alias: (Array.isArray(l.alias) ? l.alias : []).map(up).filter(Boolean),
      mpExcluidos: (Array.isArray(l.mpExcluidos) ? l.mpExcluidos : []).map(String),
      perecedero: g(l.perecedero), noPerecedero: g(l.noPerecedero)
    };
  };

  // Materias primas de un proveedor: ingredientes de sus ingresos (y los de sus alias), sin los cortes de desposte propio.
  // lots: { ingredientId: [entry] } · ingredientes: { id: { name } } · noPerecedero(ingredientId, entry) → bool
  const materiasPrimas = (provider, { lots, ingredientes, noPerecedero }) => {
    const l = listadoDe(provider);
    const nombres = new Set([up(provider.name), ...l.alias]);
    const porId = new Map();
    Object.entries(lots || {}).forEach(([ingredientId, entries]) => {
      const ing = ingredientes?.[ingredientId];
      if (!ing) return;
      (Array.isArray(entries) ? entries : []).forEach((e) => {
        if (e?.despostadoDe || e?.batchDe) return;
        const prov = txt(e?.provider);
        if (!(nombres.has(up(prov)) || prov === provider.id)) return;
        const prev = porId.get(ingredientId) || { ingredientId, nombre: cap(ing.name), np: false, desde: '', hasta: '', n: 0 };
        const fecha = txt(e.entryDate).slice(0, 10);
        prev.n += 1;
        if (fecha && (!prev.desde || fecha < prev.desde)) prev.desde = fecha;
        if (fecha && fecha > prev.hasta) prev.hasta = fecha;
        if (noPerecedero ? noPerecedero(ingredientId, e) : Boolean(e.noPerecedero)) prev.np = true;
        porId.set(ingredientId, prev);
      });
    });
    return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  };

  // Filas de cada grupo, ordenadas por nombre.
  const armarFilas = (providers, datos) => {
    const filas = { perecedero: [], noPerecedero: [] };
    let desde = ''; let hasta = '';
    providers.forEach((provider) => {
      const l = listadoDe(provider);
      if (!l.incluir) return;
      const activos = GRUPOS.filter((g) => l[g.key].activo);
      if (!activos.length) return;
      const mps = materiasPrimas(provider, datos).filter((m) => !l.mpExcluidos.includes(m.ingredientId));
      mps.forEach((m) => { if (m.desde && (!desde || m.desde < desde)) desde = m.desde; if (m.hasta > hasta) hasta = m.hasta; });
      activos.forEach((g) => {
        const mp = activos.length > 1 ? mps.filter((m) => (g.key === 'noPerecedero') === m.np) : mps;
        filas[g.key].push({
          nombre: l.nombre || provider.name, cuit: l.cuit, localidad: l.localidad || '—', registro: l.registro || txt(provider?.rne?.number),
          verificacion: l.verificacion, ...l[g.key], mp: mp.map((m) => m.nombre)
        });
      });
    });
    GRUPOS.forEach((g) => filas[g.key].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })));
    return { filas, desde, hasta };
  };

  const CSS_BASE = `@page{size:A4;margin:20mm 21mm 19mm}@page apaisada{size:A4 landscape;margin:12mm 12mm 14mm;@bottom-center{content:"Página " counter(page) " de " counter(pages);font-family:Inter,Arial,sans-serif;font-size:7pt;color:#5A6573}}
    *{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;color:#0F1B2D;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .portada .logo{height:2.05cm;display:block;margin-top:2mm}.portada .marca{font-size:7.5pt;font-weight:800;letter-spacing:.22em;color:#00ABD4;text-transform:uppercase;margin-top:5px}
    .portada .kick{margin-top:36px;font-size:7.5pt;font-weight:800;letter-spacing:.22em;color:#5A6573;text-transform:uppercase}
    .portada h1{font-weight:900;font-size:40pt;line-height:.98;margin:10px 0 12px;letter-spacing:-.01em}.portada h1 span{display:block}.portada h1 .c{color:#00ABD4}
    .portada .sub{font-style:italic;font-size:15pt;color:#5A6573;line-height:1.3;margin:0 0 22px}.portada .rule{height:3px;background:#00ABD4;margin:0 0 16px}
    .portada .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.portada .tile{background:#F1ECE1;border-left:3px solid #00ABD4;padding:10px 11px 12px;min-height:66px}
    .portada .tile small{display:block;font-size:6.6pt;font-weight:800;letter-spacing:.16em;color:#00ABD4;text-transform:uppercase;margin-bottom:5px}.portada .tile b{font-size:9pt;font-weight:700;line-height:1.3}
    .portada .nota{margin-top:26px;background:#FBF9F4;border:1px solid #E6E0D3;padding:16px 22px;text-align:center}
    .portada .nota h3{margin:0 0 3px;font-size:10.5pt;font-weight:800}.portada .nota small{display:block;font-size:6.8pt;font-weight:800;letter-spacing:.18em;color:#00ABD4;text-transform:uppercase;margin-bottom:8px}
    .portada .nota img{height:1.05cm;display:block;margin:0 auto 7px}.portada .nota p{margin:0;font-size:8.6pt;color:#5A6573;line-height:1.5}
    .hoja{page:apaisada;page-break-before:always;break-before:page;font-size:8pt}
    .top{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:3px solid #00ABD4;padding-bottom:6px;margin-bottom:10px}
    .top img{height:1.05cm}.top .t{text-align:right}.top b{display:block;font-size:13pt;font-weight:900}.top span{font-size:7.5pt;color:#5A6573}
    h2{font-size:11pt;font-weight:900;margin:14px 0 2px;letter-spacing:.02em}h2.p{color:#B03A2E}h2.np{color:#1F5C8B}.res{font-size:7.5pt;color:#5A6573;margin:0 0 6px}
    .grupo+.grupo{page-break-before:always;break-before:page}
    table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{page-break-inside:avoid;break-inside:avoid}
    th{color:#fff;font-weight:700;font-size:7.6pt;text-align:left;padding:5px 6px}table.p th{background:#B03A2E}table.np th{background:#1F5C8B}
    td{border-bottom:1px solid #D9DEE4;padding:4.5px 6px;vertical-align:top;line-height:1.3}tbody tr:nth-child(even) td{background:#F6F4EF}
    td.n{color:#5A6573;text-align:right}.prov b{font-weight:800;display:block}.prov small,.reg small{display:block;color:#5A6573;font-size:6.8pt}
    .reg b{font-weight:800}.reg small{font-style:italic}.chip{display:inline-block;font-size:6.4pt;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:1px 5px;border:1px solid;border-radius:2px;margin-bottom:2px}
    .chip.ok{color:#1E7B4F}.chip.id{color:#0F1B2D}.mp{columns:2;column-gap:14px}.mp span{display:block;break-inside:avoid}.mp span:before{content:'· ';color:#00ABD4;font-weight:900}
    .notas{margin-top:12px;font-size:7.2pt;color:#5A6573;line-height:1.45;page-break-inside:avoid}.notas b{color:#0F1B2D}`;

  const portada = ({ logo, kicker, t1, t2, sub, tiles, nota }) => `<section class="portada">
    <img class="logo" src="${esc(logo)}" alt="ABR"><div class="marca">Asesoría Bromatológica · Rosario</div>
    <div class="kick">${kicker}</div><h1><span>${t1}</span><span class="c">${t2}</span></h1><p class="sub">${sub}</p><div class="rule"></div>
    <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>
    <div class="nota"><img src="${esc(logo)}" alt="ABR"><h3>${esc(nota[0])}</h3><small>${esc(nota[1])}</small><p>${esc(nota[2])}</p></div></section>`;

  const provCell = (r) => `<td class="prov"><b>${esc(r.nombre)}</b>${r.cuit ? `<small>CUIT ${esc(r.cuit)}</small>` : ''}</td>`;
  const regCell = (r) => `<td class="reg"><span class="chip ${r.verificacion ? 'ok' : 'id'}">${r.verificacion ? 'Verificado' : 'Identificado'}</span><br><b>${esc(r.registro || '—')}</b>${r.verificacion ? `<small>${esc(r.verificacion)}</small>` : ''}</td>`;
  const resumen = (arr) => `${arr.length} proveedores · verificados ${arr.filter((r) => r.verificacion).length} · identificados ${arr.filter((r) => !r.verificacion).length}`;

  const tablaRegistro = (g, arr, i) => `<div class="grupo"><h2 class="${g.cls}">${i + 1}. ${g.titulo}</h2><p class="res">${resumen(arr)}</p><table class="${g.cls}">
    <colgroup><col style="width:3%"><col style="width:20%"><col style="width:11%"><col style="width:18%"><col style="width:24%"><col style="width:12%"><col style="width:12%"></colgroup>
    <thead><tr><th>N°</th><th>Proveedor</th><th>Rubro</th><th>Productos</th><th>RNE / Habilitación</th><th>Localidad</th><th>Conservación</th></tr></thead><tbody>
    ${arr.map((r, n) => `<tr><td class="n">${n + 1}</td>${provCell(r)}<td>${esc(r.rubro)}</td><td>${esc(r.productos)}</td>${regCell(r)}<td>${esc(r.localidad)}</td><td>${esc(r.conservacion)}</td></tr>`).join('')}</tbody></table></div>`;

  const tablaMp = (g, arr, i) => `<div class="grupo"><h2 class="${g.cls}">${i + 1}. ${g.tituloMp}</h2><p class="res">${arr.length} proveedores · ${arr.reduce((s, r) => s + r.mp.length, 0)} materias primas</p><table class="${g.cls}">
    <colgroup><col style="width:3%"><col style="width:22%"><col style="width:12%"><col style="width:43%"><col style="width:20%"></colgroup>
    <thead><tr><th>N°</th><th>Proveedor</th><th>Rubro</th><th>Materias primas que se le compran</th><th>RNE / Habilitación</th></tr></thead><tbody>
    ${arr.map((r, n) => `<tr><td class="n">${n + 1}</td>${provCell(r)}<td>${esc(r.rubro)}</td><td><div class="mp">${(r.mp.length ? r.mp : (r.productos ? [r.productos] : [])).map((m) => `<span>${esc(m)}</span>`).join('')}</div></td>${regCell(r)}</tr>`).join('')}</tbody></table></div>`;

  // tipo: 'registro' | 'materias'
  const html = (tipo, providers, datos, opts = {}) => {
    const logo = opts.logoUrl || new URL('./IMG/ABR LOGO.png', window.location.href).href;
    const hoy = dmy(opts.hoy || hoyAr());
    const { filas, desde, hasta } = armarFilas(providers, datos);
    const P = filas.perecedero; const N = filas.noPerecedero;
    const todos = [...P, ...N];
    const unicos = new Set(todos.map((r) => up(r.nombre))).size;
    const grupos = GRUPOS.map((g) => [g, filas[g.key]]).filter(([, arr]) => arr.length);
    const esReg = tipo !== 'materias';
    const titulo = esReg ? 'Listado de proveedores · Registro sanitario' : 'Proveedores y materias primas';
    const tapa = esReg
      ? portada({ logo, kicker: 'Registro · Proveedores', t1: 'Listado de', t2: 'proveedores', sub: 'proveedores de materias primas perecederas y no perecederas, ordenados alfabéticamente, con su registro sanitario',
          tiles: [['Proveedores', `${unicos} en total`], ['Perecederos', `${P.length} proveedores`], ['No perecederos', `${N.length} proveedores`],
            ['Verificados', `${todos.filter((r) => r.verificacion).length} con PT o padrón SENASA`], ['Identificados', `${todos.filter((r) => !r.verificacion).length} con registro cargado`], ['Orden', 'Alfabético por proveedor']],
          nota: ['La Jamonera', `Actualizado al ${hoy}`, 'Datos del Centro de proveedores de La Jamonera, los permisos de tránsito recibidos y el padrón público de establecimientos SENASA.'] })
      : portada({ logo, kicker: 'Registro · Proveedores', t1: 'Proveedores y', t2: 'materias primas', sub: 'materias primas que se le compran a cada proveedor, según los ingresos registrados en el sistema',
          tiles: [['Proveedores', `${unicos} en total`], ['Perecederos', `${P.length} proveedores`], ['No perecederos', `${N.length} proveedores`],
            ['Materias primas', `${todos.reduce((s, r) => s + r.mp.length, 0)} renglones`], ['Período', desde ? `Ingresos del ${dmy(desde)} al ${dmy(hasta)}` : 'Sin ingresos'], ['Orden', 'Alfabético por proveedor']],
          nota: ['La Jamonera', `Actualizado al ${hoy}`, 'Se listan las materias primas y envases de producción. No incluye productos de reventa del local ni servicios.'] });
    const tablas = grupos.map(([g, arr], i) => (esReg ? tablaRegistro(g, arr, i) : tablaMp(g, arr, i))).join('');
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)} - La Jamonera</title>
      <link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,700;0,800;0,900;1,400&display=swap" rel="stylesheet">
      <style>${CSS_BASE}</style></head><body>${tapa}
      <section class="hoja"><div class="top"><img src="${esc(logo)}" alt="ABR"><div class="t"><b>${esc(titulo)}</b><span>La Jamonera · actualizado al ${hoy}</span></div></div>
      ${tablas || '<p class="res">No hay proveedores marcados para el listado.</p>'}<div class="notas">${NOTAS.map((x) => `<div>• ${x}</div>`).join('')}</div></section></body></html>`;
  };

  const imprimir = (contenido) => new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument; doc.open(); doc.write(contenido); doc.close();
    const win = frame.contentWindow;
    const imgs = [...doc.images].map((img) => (img.complete ? null : new Promise((ok) => { img.onload = ok; img.onerror = ok; })));
    Promise.race([Promise.all([...imgs, doc.fonts?.ready]), new Promise((ok) => setTimeout(ok, 5000))]).then(() => {
      try { win.focus(); win.print(); } finally { setTimeout(() => { frame.remove(); resolve(); }, 1500); }
    });
  });

  window.laJamoneraProveedoresListado = { GRUPOS, CONSERVACION, listadoDe, materiasPrimas, armarFilas, html, imprimir };
})();
