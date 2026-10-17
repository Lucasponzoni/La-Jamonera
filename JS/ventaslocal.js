// Ventas del local (ventaslocal.html): comprobantes de InfoManager IM5 que la Edge Function `api`
// copia a Supabase (im5_comprobantes / im5_items). Lee con RLS (admin o permiso «Ver ventas»),
// arma KPIs/gráficos con el RPC ventas_resumen y muestra la salud de la sincronización
// (ventas_config.estado). La config (días, horas, intervalo, KPIs) se guarda con ventas_config_guardar;
// las credenciales de IM5 van a Vault por /ventas/credenciales (solo admin).
(function ventasLocalModule() {
  const $ = (id) => document.getElementById(id);
  const TZ = 'America/Argentina/Buenos_Aires';
  const POR_PAGINA = window.matchMedia('(max-width: 767.98px)').matches ? 25 : 50;
  const notify = (type, title, message) => window.laJamoneraNotify?.show({ type, title, message });
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtPesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const fmtPesos2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtNum = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
  const fmtFechaHora = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fmtHora = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const pesos = (n) => fmtPesos.format(Number(n) || 0);
  const pesos2 = (n) => fmtPesos2.format(Number(n) || 0);

  const ERRORES = {
    sin_permiso_ventas: 'No tenés permiso para ver las ventas.',
    sin_credenciales: 'Faltan las credenciales de IM5: cargalas en Configuración → Conexión IM5.',
    ocupada: 'Ya hay una actualización en curso. Esperá un momento.',
    admin_required: 'Solo un administrador puede cambiar la conexión con IM5.',
    base_invalida: 'La base de datos no tiene un formato válido.',
    base_no_encontrada: 'IM5 no encuentra esa empresa. Poné el nombre de la base, el mismo que usás en el login de IM5 (ej. frigolajamonera01_base).',
    usuario_invalido: 'Falta el usuario.',
    password_requerida: 'Falta la contraseña.',
    horario_invalido: 'El horario no es válido: «desde» tiene que ser antes que «hasta».',
    intervalo_invalido: 'El intervalo no es válido.',
    dias_invalidos: 'Elegí al menos un día válido.',
    empresas_invalidas: 'Elegí al menos una empresa.',
    tipos_invalidos: 'Los tipos de comprobante no son válidos.',
    mail_invalido: 'Algún mail no es válido.',
    sin_mail_avisos: 'No hay mails guardados para los avisos.',
    fecha_invalida: 'La fecha no es válida.',
    antes_de_inicio: 'Esa fecha es anterior al inicio configurado.',
    mp_token_invalido: 'El token no tiene el formato de Mercado Pago (APP_USR-…).',
    mp_token_rechazado: 'Mercado Pago rechazó ese token.',
    mp_otra_cuenta: 'Ese token es de otra cuenta de Mercado Pago.',
    mp_token_vencido: 'El token de Mercado Pago venció: cargá el nuevo en Configuración → Mercado Pago.',
    ninjapos_clave_formato: 'Esa no parece la clave de NinjaPos: copiala completa del archivo.',
    ninjapos_clave_invalida: 'NinjaPos rechazó la clave (mal copiada o revocada).',
    ninjapos_ip_no_permitida: 'NinjaPos no permite pedidos desde este servidor (lista de IP).',
    ninjapos_mp_desconectado: 'Mercado Pago está desconectado en NinjaPos.',
    ninjapos_sin_token: 'NinjaPos no entregó el token.'
  };
  const textoError = (e) => {
    const m = String(e?.message || e?.error || e || '');
    const k = Object.keys(ERRORES).find((key) => m.includes(key));
    if (k) return ERRORES[k];
    if (/im5_401|im5_login/.test(m)) return 'IM5 rechazó el usuario o la contraseña.';
    if (/im5_sin_respuesta|im5_5\d\d/.test(m)) return 'InfoManager no respondió. Probá de nuevo en un rato.';
    return m || 'Error inesperado.';
  };

  // ---------- Fechas (hora de Argentina) ----------
  const isoAR = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
  const finDeMes = (iso) => { const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
  const mesAnteriorDe = (iso) => { const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
  const diaSemana = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
  const fechaCorta = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}${y !== isoAR().slice(0, 4) ? `/${y.slice(2)}` : ''}`; };
  const haceCuanto = (ts) => {
    if (!ts) return 'nunca';
    const min = Math.round((Date.now() - Date.parse(ts)) / 60000);
    if (min < 1) return 'recién';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
    return `hace ${Math.floor(h / 24)} d`;
  };
  const enCuanto = (ts) => {
    if (!ts) return '';
    const min = Math.round((Date.parse(ts) - Date.now()) / 60000);
    if (min <= 0) return 'en un momento';
    if (min < 60) return `en ${min} min`;
    const d = new Date(ts);
    return isoAR(d) === isoAR() ? `hoy ${fmtHora.format(d)}` : `${new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday: 'short' }).format(d)} ${fmtHora.format(d)}`;
  };

  function rangoDe(clave) {
    const hoy = isoAR();
    if (clave === 'hoy') return { desde: hoy, hasta: hoy };
    if (clave === 'ayer') { const a = sumarDias(hoy, -1); return { desde: a, hasta: a }; }
    if (clave === 'semana') { const dow = (diaSemana(hoy) + 6) % 7; return { desde: sumarDias(hoy, -dow), hasta: hoy }; }
    if (clave === 'mes') return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
    if (clave === 'mesant') { const ini = mesAnteriorDe(hoy); return { desde: ini, hasta: finDeMes(ini) }; }
    return null;
  }
  // Período con qué comparar: el mes contra el mes anterior a la misma altura; el resto, el mismo largo justo antes.
  function rangoComparar(r, clave) {
    if (clave === 'mes') {
      const ini = mesAnteriorDe(r.desde); const largo = diasEntre(r.desde, r.hasta);
      const hasta = sumarDias(ini, largo); const fin = finDeMes(ini);
      return { desde: ini, hasta: hasta > fin ? fin : hasta, texto: 'el mes anterior a la misma altura' };
    }
    if (clave === 'mesant') { const ini = mesAnteriorDe(r.desde); return { desde: ini, hasta: finDeMes(ini), texto: 'el mes anterior' }; }
    if (clave === 'semana') { return { desde: sumarDias(r.desde, -7), hasta: sumarDias(r.hasta, -7), texto: 'la semana pasada a la misma altura' }; }
    const largo = diasEntre(r.desde, r.hasta) + 1;
    return { desde: sumarDias(r.desde, -largo), hasta: sumarDias(r.hasta, -largo), texto: largo === 1 ? (clave === 'hoy' ? 'ayer' : 'el día anterior') : `los ${largo} días anteriores` };
  }

  // ---------- Estado ----------
  const st = {
    sb: null, me: null, cfg: {}, estado: {},
    clave: 'hoy', rango: rangoDe('hoy'), empresa: null, comparar: true,
    pagina: 0, total: 0, buscar: '', topModo: 'importe',
    resumen: null, resumenComp: null, charts: {}, corriendo: false
  };

  // ---------- KPIs ----------
  // color: franja de arriba de la tarjeta (índice de la paleta de los gráficos).
  const KPIS = [
    { key: 'total', titulo: 'Total vendido', icono: 'fa-sack-dollar', color: 0 },
    { key: 'comprobantes', titulo: 'Comprobantes', icono: 'fa-receipt', color: 5 },
    { key: 'ticket', titulo: 'Ticket promedio', icono: 'fa-basket-shopping', color: 4 },
    { key: 'producto', titulo: 'Producto estrella ($)', icono: 'fa-star', color: 2 },
    { key: 'productoCant', titulo: 'Más vendido (cantidad)', icono: 'fa-weight-hanging', color: 6 },
    { key: 'medios', titulo: 'Medio de cobro principal', icono: 'fa-credit-card', color: 1 },
    { key: 'nc', titulo: 'Notas de crédito', icono: 'fa-rotate-left', color: 8 },
    { key: 'cajas', titulo: 'Caja que más vendió', icono: 'fa-cash-register', color: 3 },
    { key: 'hora', titulo: 'Hora pico', icono: 'fa-clock', color: 9 },
    { key: 'letras', titulo: 'Factura A / B', icono: 'fa-file-invoice', color: 7 }
  ];
  const KPI_POR_KEY = Object.fromEntries(KPIS.map((k) => [k.key, k]));

  function delta(actual, antes, { invertir = false } = {}) {
    if (!st.comparar || antes == null) return '';
    const a = Number(actual) || 0; const b = Number(antes) || 0;
    if (!b && !a) return '<span class="vl-delta is-igual">= sin cambios</span>';
    if (!b) return '<span class="vl-delta is-sube"><i class="fa-solid fa-arrow-trend-up"></i> nuevo</span>';
    const p = ((a - b) / Math.abs(b)) * 100;
    if (Math.abs(p) < 0.5) return '<span class="vl-delta is-igual">= igual</span>';
    const sube = p > 0;
    const bien = invertir ? !sube : sube;
    return `<span class="vl-delta ${bien ? 'is-sube' : 'is-baja'}"><i class="fa-solid fa-arrow-trend-${sube ? 'up' : 'down'}"></i> ${fmtNum.format(Math.round(Math.abs(p) * 10) / 10)}%</span>`;
  }
  // Minigráfico (SVG en línea, sin librería): área + línea con la evolución del período.
  function sparkline(valores, color) {
    const v = valores.map((x) => Number(x) || 0);
    if (v.length < 2 || !v.some(Boolean)) return '';
    const W = 120; const H = 34; const max = Math.max(...v); const min = Math.min(...v, 0);
    const pts = v.map((y, i) => [(i / (v.length - 1)) * W, H - 3 - ((y - min) / (max - min || 1)) * (H - 6)]);
    const linea = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const id = `vlsg${String(color).replace(/\W/g, '')}`; // fijo por color: repintar igual no cambia el HTML
    return `<svg class="vl-kpi-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${linea}L${W},${H}L0,${H}Z" fill="url(#${id})"/><path d="${linea}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }
  // Barra de proporciones (medios, A/B, cajas) con leyenda corta.
  function barraParte(partes) {
    const tot = partes.reduce((s, p) => s + Math.max(0, Number(p.valor) || 0), 0);
    if (!tot) return '';
    return `<div class="vl-kpi-barra">${partes.map((p) => `<i style="width:${((Math.max(0, Number(p.valor) || 0) / tot) * 100).toFixed(2)}%;background:${p.color}" title="${esc(p.nombre)} · ${fmtNum.format(Math.round((p.valor / tot) * 1000) / 10)}%"></i>`).join('')}</div>`;
  }
  // Serie para los minigráficos: por día si el período tiene varios días, si no por hora.
  function serie(r, campo) {
    if (st.rango.desde !== st.rango.hasta && (r.por_dia || []).length > 1) {
      const por = Object.fromEntries(r.por_dia.map((x) => [x.fecha, x]));
      const out = []; for (let d = st.rango.desde; d <= st.rango.hasta; d = sumarDias(d, 1)) { const x = por[d]; out.push(x ? (campo === 'ticket' ? Number(x.total) / Math.max(1, Number(x.cant)) : Number(x[campo])) : 0); }
      return out;
    }
    const horas = [...(r.por_hora || [])].sort((a, b) => a.hora - b.hora);
    return horas.map((x) => (campo === 'ticket' ? Number(x.total) / Math.max(1, Number(x.cant)) : Number(x[campo])));
  }
  function kpiHtml(key, r, c) {
    const def = KPI_POR_KEY[key];
    if (!def) return '';
    // Cargando: skeleton como los indicadores del inicio (ícono, título, valor, nota y la franja de abajo).
    if (!r) {
      const w = [62, 48, 55, 70, 44, 58, 50, 66, 40, 60][KPIS.indexOf(def) % 10];
      return `<article class="vl-kpi is-skeleton" aria-busy="true"><div class="vl-kpi-tit"><sl-skeleton effect="sheen" class="vl-sk-ico"></sl-skeleton><sl-skeleton effect="sheen" class="vl-sk-txt" style="width:${w}%"></sl-skeleton></div>
        <sl-skeleton effect="sheen" class="vl-sk-valor"></sl-skeleton><sl-skeleton effect="sheen" class="vl-sk-txt vl-sk-chico" style="width:${w + 14}%"></sl-skeleton>
        <sl-skeleton effect="sheen" class="vl-sk-extra"></sl-skeleton></article>`;
    }
    const P = PALETA(); const color = P[def.color];
    let valor = '—'; let sub = ''; let chico = false; let extra = ''; let foto = '';
    if (r) {
      if (key === 'total') { valor = pesos(r.neto); sub = `${delta(r.neto, c?.neto)}${c ? `<span>antes ${pesos(c.neto)}</span>` : ''}`; extra = sparkline(serie(r, 'total'), color); }
      if (key === 'comprobantes') { valor = fmtNum.format(r.comprobantes); sub = `${delta(r.comprobantes, c?.comprobantes)}${c ? `<span>antes ${fmtNum.format(c.comprobantes)}</span>` : ''}`; extra = sparkline(serie(r, 'cant'), color); }
      if (key === 'ticket') { valor = pesos2(r.ticket); sub = `${delta(r.ticket, c?.ticket)}${c ? `<span>antes ${pesos(c.ticket)}</span>` : ''}`; extra = sparkline(serie(r, 'ticket'), color); }
      if (key === 'producto' || key === 'productoCant') {
        const p = (key === 'producto' ? r.top_importe : r.top_cantidad)?.[0];
        chico = true; valor = p ? esc(p.desc || p.cod) : 'Sin datos';
        sub = p ? (key === 'producto' ? `${pesos(p.importe)} · ${fmtNum.format(p.cantidad)} ${esc(p.unidad || '')}` : `${fmtNum.format(p.cantidad)} ${esc(p.unidad || '')} · ${pesos(p.importe)}`) : (r.sin_items ? 'Faltan bajar productos' : '');
        const vk = p && st.catalogoListo ? vinculoDe(p.cod, st.catalogoListo) : null;
        if (vk?.item?.img) foto = `<img class="vl-kpi-foto" src="${esc((window.ljThumb || String)(vk.item.img, 160))}" alt="" loading="lazy">`;
        if (vk?.item) sub += `<span class="vl-kpi-tag"><i class="fa-solid ${vk.item.tipo === 'receta' ? 'fa-industry' : 'fa-boxes-stacked'}"></i>${esc(vk.item.nombre)}</span>`;
      }
      if (key === 'medios') {
        const ms = (r.por_medio || []).filter((x) => Number(x.total) > 0); const m = ms[0]; const tot = ms.reduce((s, x) => s + Number(x.total || 0), 0);
        chico = true; valor = m ? esc(m.medio) : 'Sin datos';
        sub = m && tot ? `${fmtNum.format(Math.round((Number(m.total) / tot) * 1000) / 10)}% · ${pesos(m.total)}` : '';
        extra = barraParte(ms.map((x, i) => ({ nombre: x.medio, valor: Number(x.total), color: P[[1, 0, 2, 4, 5][i % 5]] })));
      }
      if (key === 'nc') {
        valor = pesos(r.nc_total); sub = `<span>${r.nc_cant} nota${r.nc_cant === 1 ? '' : 's'}</span>${delta(r.nc_total, c?.nc_total, { invertir: true })}`;
        const pct = Number(r.facturado) ? (Number(r.nc_total) / Number(r.facturado)) * 100 : 0;
        extra = `<div class="vl-kpi-medidor" title="${fmtNum.format(Math.round(pct * 10) / 10)}% de lo facturado"><i style="width:${Math.min(100, pct * 10).toFixed(1)}%;background:${color}"></i></div><small class="vl-kpi-mini">${fmtNum.format(Math.round(pct * 10) / 10)}% de lo facturado</small>`;
      }
      if (key === 'cajas') {
        const us = (r.por_usuario || []).filter((x) => Number(x.total) > 0); const u = us[0];
        chico = true; valor = u ? `${avatar(u.usuario)}${esc(u.usuario)}` : 'Sin datos';
        sub = u ? `${pesos(u.total)} · ${fmtNum.format(u.cant)} comp.` : '';
        extra = barraParte(us.slice(0, 6).map((x, i) => ({ nombre: x.usuario, valor: Number(x.total), color: P[(i + 3) % 10] })));
      }
      if (key === 'hora') {
        const hs = [...(r.por_hora || [])].sort((a, b) => a.hora - b.hora);
        const h = [...hs].sort((a, b) => Number(b.total) - Number(a.total))[0];
        valor = h ? `${String(h.hora).padStart(2, '0')}–${String(h.hora + 1).padStart(2, '0')} h` : '—';
        sub = h ? `${pesos(h.total)} · ${h.cant} comp.` : '';
        const max = Math.max(1, ...hs.map((x) => Number(x.total)));
        extra = hs.length ? `<div class="vl-kpi-horas">${hs.map((x) => `<i style="height:${Math.max(8, (Number(x.total) / max) * 100).toFixed(0)}%;background:${x === h ? color : 'var(--lj-border-strong)'}" title="${x.hora} h · ${pesos(x.total)}"></i>`).join('')}</div>` : '';
      }
      if (key === 'letras') {
        const a = (r.por_letra || []).find((x) => x.letra === 'A'); const b = (r.por_letra || []).find((x) => x.letra === 'B');
        chico = true; valor = `<span class="vl-ab"><b style="color:${P[3]}">A</b> ${pesos(a?.total || 0)}</span><span class="vl-ab"><b style="color:${P[4]}">B</b> ${pesos(b?.total || 0)}</span>`;
        const tot = Number(a?.total || 0) + Number(b?.total || 0);
        sub = tot ? `${fmtNum.format(Math.round((Number(a?.total || 0) / tot) * 1000) / 10)}% a empresas` : '';
        extra = barraParte([{ nombre: 'Factura A', valor: Number(a?.total || 0), color: P[3] }, { nombre: 'Factura B', valor: Number(b?.total || 0), color: P[4] }]);
      }
    }
    return `<article class="vl-kpi ${r ? '' : 'is-cargando'} ${foto ? 'con-foto' : ''}" style="--k:${color}">
      <div class="vl-kpi-tit"><span class="vl-kpi-ico"><i class="fa-solid ${def.icono}"></i></span><span>${esc(def.titulo)}</span></div>
      ${foto}<div class="vl-kpi-valor ${chico ? 'is-chico' : ''}">${valor}</div><div class="vl-kpi-sub">${sub}</div>${extra ? `<div class="vl-kpi-extra">${extra}</div>` : ''}</article>`;
  }
  const kpisActivos = () => (Array.isArray(st.cfg.kpis) && st.cfg.kpis.length ? st.cfg.kpis : KPIS.map((k) => k.key)).filter((k) => KPI_POR_KEY[k]);
  // Sólo se reemplazan las tarjetas que cambiaron: repintar todas hacía que la animación de entrada se
  // repitiera (los KPIs «cargaban dos veces» al llegar el catálogo, la config o el tema).
  function pintarKpis() {
    const cont = $('vlKpis');
    const htmls = kpisActivos().map((k) => kpiHtml(k, st.resumen, st.comparar ? st.resumenComp : null));
    const previos = cont._htmls || [];
    if (previos.length !== htmls.length) { cont.innerHTML = htmls.join(''); cont._htmls = htmls; return; }
    htmls.forEach((h, i) => {
      if (h === previos[i]) return;
      const nodo = cont.children[i];
      const t = document.createElement('template'); t.innerHTML = h;
      const nuevo = t.content.firstElementChild;
      // Ya visible (no viene del skeleton): sin animación de entrada.
      if (nodo && !nodo.classList.contains('is-skeleton')) nuevo.style.animation = 'none';
      if (nodo) nodo.replaceWith(nuevo); else cont.append(nuevo);
    });
    cont._htmls = htmls;
  }

  // ---------- Gráficos (ECharts) ----------
  // Se dibujan sólo con la pestaña «Gráficos» a la vista: un gráfico iniciado en un panel oculto mide 0 y
  // queda aplastado. Al mostrar la pestaña se dibuja (o se ajusta el tamaño).
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
  const oscuro = () => document.documentElement.classList.contains('sl-theme-dark');
  const PALETA = () => (oscuro()
    ? ['#60a5fa', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fb923c', '#a3e635', '#fb7185', '#2dd4bf']
    : ['#2563eb', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#65a30d', '#e11d48', '#0d9488']);
  const DIAS_SEM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const esMovil = () => window.matchMedia('(max-width: 767.98px)').matches;
  const graficosVisibles = () => $('vlTabs')?.querySelector('sl-tab[panel="graficos"]')?.active;
  const corto = (v) => (Math.abs(v) >= 1e6 ? `${fmtNum.format(Math.round(v / 1e5) / 10)} M` : Math.abs(v) >= 1e3 ? `${fmtNum.format(Math.round(v / 1e3))} k` : fmtNum.format(v));
  const degrade = (c1, c2, horizontal = false) => new window.echarts.graphic.LinearGradient(0, 0, horizontal ? 1 : 0, horizontal ? 0 : 1, [{ offset: 0, color: c1 }, { offset: 1, color: c2 }]);
  const aclarar = (hex, a) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

  function chart(id) {
    const el = $(id);
    if (!window.echarts || !el) return null;
    if (el.querySelector('.vl-vacio')) el.innerHTML = '';
    if (!st.charts[id]) st.charts[id] = window.echarts.init(el, null, { renderer: 'canvas' });
    return st.charts[id];
  }
  function baseOpts() {
    const texto = css('--lj-muted'); const borde = css('--lj-border');
    return {
      color: PALETA(),
      textStyle: { fontFamily: 'Inter, sans-serif', color: texto },
      grid: { left: 8, right: 14, top: 28, bottom: 6, containLabel: true },
      tooltip: { trigger: 'axis', backgroundColor: css('--lj-surface'), borderColor: borde, borderWidth: 1, padding: [8, 12], textStyle: { color: css('--lj-text'), fontSize: 12 }, extraCssText: 'border-radius:0;box-shadow:0 6px 18px rgba(0,0,0,.12)' },
      xAxis: { axisLine: { lineStyle: { color: borde } }, axisTick: { show: false }, axisLabel: { color: texto }, splitLine: { show: false } },
      yAxis: { axisLabel: { color: texto, formatter: corto }, splitLine: { lineStyle: { color: borde, type: 'dashed' } } }
    };
  }
  function vacio(id, texto = 'Sin ventas en este período') {
    const c = st.charts[id]; if (c) { c.dispose(); delete st.charts[id]; }
    $(id).innerHTML = `<div class="vl-vacio">${esc(texto)}</div>`;
  }
  function pintarGraficos() {
    const r = st.resumen;
    if (!r || !graficosVisibles()) { st.graficosPendientes = true; return; }
    st.graficosPendientes = false;
    const c = st.comparar ? st.resumenComp : null;
    const P = PALETA();
    const texto = css('--lj-text'); const muted = css('--lj-muted'); const superficie = css('--lj-surface');

    // Por día: cada barra con el color de su día de la semana; la comparación como línea con área.
    // Con un solo día no aporta: se oculta («por hora» y «medios» quedan lado a lado).
    const unDia = st.rango.desde === st.rango.hasta;
    $('vlGDia').closest('.vl-card').hidden = unDia;
    if (unDia) { const c0 = st.charts.vlGDia; if (c0) { c0.dispose(); delete st.charts.vlGDia; } }
    else if (!(r.por_dia || []).length) vacio('vlGDia');
    else {
      const dias = []; for (let d = st.rango.desde; d <= st.rango.hasta; d = sumarDias(d, 1)) dias.push(d);
      const porDia = Object.fromEntries((r.por_dia || []).map((x) => [x.fecha, Number(x.total)]));
      const conVenta = dias.filter((d) => porDia[d]);
      const promedio = conVenta.length ? conVenta.reduce((s, d) => s + porDia[d], 0) / conVenta.length : 0;
      $('vlNotaDia').textContent = conVenta.length > 1 ? `Promedio por día con ventas: ${pesos(promedio)}` : '';
      const series = [{
        name: 'Período', type: 'bar', barMaxWidth: 38,
        data: dias.map((d) => { const col = P[(diaSemana(d) + 6) % 7]; return { value: porDia[d] || 0, itemStyle: { color: degrade(col, aclarar(col, 0.55)), borderRadius: [4, 4, 0, 0] } }; }),
        markLine: conVenta.length > 1 ? { symbol: 'none', silent: true, data: [{ yAxis: promedio }], lineStyle: { color: muted, type: 'dotted', width: 1.5 }, label: { formatter: () => 'promedio', color: muted, fontSize: 11, position: 'insideEndTop' } } : undefined
      }];
      if (c && (c.por_dia || []).length) {
        const cr = rangoComparar(st.rango, st.clave);
        const cd = Object.fromEntries((c.por_dia || []).map((x) => [x.fecha, Number(x.total)]));
        series.push({ name: 'Comparación', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, z: 3,
          data: dias.map((_, i) => cd[sumarDias(cr.desde, i)] || 0),
          lineStyle: { color: P[4], width: 2, type: 'dashed' }, itemStyle: { color: P[4] },
          areaStyle: { color: degrade(aclarar(P[4], 0.22), aclarar(P[4], 0)) } });
      }
      const o = baseOpts();
      chart('vlGDia')?.setOption({ ...o,
        legend: series.length > 1 ? { top: 0, right: 0, textStyle: { color: muted }, itemWidth: 14, itemHeight: 8, data: [{ name: 'Período', itemStyle: { color: P[0] } }, 'Comparación'] } : undefined,
        tooltip: { ...o.tooltip, valueFormatter: pesos, formatter: undefined, axisPointer: { type: 'shadow' } },
        xAxis: { ...o.xAxis, type: 'category', data: dias.map((d) => `${DIAS_SEM[diaSemana(d)]} ${fechaCorta(d)}`), axisLabel: { color: muted, hideOverlap: true } },
        yAxis: { ...o.yAxis, type: 'value' }, series }, true);
    }

    // Por hora: barras que van de frío a caliente según cuánto se vendió.
    if (!(r.por_hora || []).length) vacio('vlGHora', 'Sin horas registradas');
    else {
      const horas = r.por_hora.map((x) => x.hora); const min = Math.min(...horas); const max = Math.max(...horas);
      const lista = []; for (let h = min; h <= max; h++) lista.push(h);
      const por = Object.fromEntries(r.por_hora.map((x) => [x.hora, Number(x.total)]));
      const tope = Math.max(...Object.values(por));
      const o = baseOpts();
      chart('vlGHora')?.setOption({ ...o,
        tooltip: { ...o.tooltip, valueFormatter: pesos, axisPointer: { type: 'shadow' } },
        visualMap: { show: false, min: 0, max: tope || 1, dimension: 1, inRange: { color: oscuro() ? ['#22d3ee', '#60a5fa', '#a78bfa', '#f472b6', '#fbbf24'] : ['#67e8f9', '#2563eb', '#7c3aed', '#db2777', '#f59e0b'] } },
        xAxis: { ...o.xAxis, type: 'category', data: lista.map((h) => `${String(h).padStart(2, '0')} h`) }, yAxis: { ...o.yAxis, type: 'value' },
        series: [{ type: 'bar', data: lista.map((h) => por[h] || 0), barMaxWidth: 28, itemStyle: { borderRadius: [4, 4, 0, 0] } }] }, true);
    }

    // Medios de cobro: anillo con el total en el centro.
    const medios = (r.por_medio || []).filter((m) => Number(m.total) > 0);
    if (!medios.length) vacio('vlGMedios');
    else {
      const tot = medios.reduce((s, m) => s + Number(m.total), 0);
      chart('vlGMedios')?.setOption({
        color: P, textStyle: { fontFamily: 'Inter, sans-serif', color: muted },
        tooltip: { ...baseOpts().tooltip, trigger: 'item', formatter: (p) => `<b>${esc(p.name)}</b><br>${pesos(p.value)} · ${fmtNum.format(p.percent)}%` },
        legend: { bottom: 0, type: 'plain', textStyle: { color: muted }, itemWidth: 12, itemHeight: 12, icon: 'rect' },
        title: { text: corto(tot), subtext: 'cobrado', left: 'center', top: '35%', textStyle: { color: texto, fontSize: 18, fontWeight: 800 }, subtextStyle: { color: muted, fontSize: 11 } },
        series: [{ type: 'pie', radius: ['50%', '74%'], center: ['50%', '44%'], padAngle: 2, itemStyle: { borderRadius: 0, borderColor: superficie, borderWidth: 2 },
          label: { show: true, formatter: (p) => `${fmtNum.format(Math.round(p.percent))}%`, color: texto, fontWeight: 700, fontSize: 11 },
          labelLine: { length: 6, length2: 6 },
          data: medios.map((m) => ({ name: m.medio, value: Number(m.total) })) }]
      }, true);
    }

    // Top productos: cada barra de un color, con el importe/cantidad al final.
    const top = (st.topModo === 'cantidad' ? r.top_cantidad : r.top_importe) || [];
    if (!top.length) vacio('vlGTop', r.sin_items ? 'Todavía se están bajando los productos de estas ventas' : 'Sin productos en este período');
    else {
      const filas = [...top].reverse();
      const campo = st.topModo === 'cantidad' ? 'cantidad' : 'importe';
      const o = baseOpts();
      chart('vlGTop')?.setOption({ ...o,
        tooltip: { ...o.tooltip, axisPointer: { type: 'shadow' }, formatter: (ps) => { const p = filas[ps[0].dataIndex]; return `<b>${esc(p.desc || p.cod)}</b><br>${pesos(p.importe)} · ${fmtNum.format(p.cantidad)} ${esc(p.unidad || '')}`; } },
        grid: { ...o.grid, right: 70 },
        xAxis: { ...o.yAxis, type: 'value', axisLabel: { ...o.yAxis.axisLabel, show: !esMovil() } },
        yAxis: { type: 'category', data: filas.map((p) => { const t = String(p.desc || p.cod || ''); return t.length > 26 ? `${t.slice(0, 25)}…` : t; }), axisLabel: { color: texto, fontSize: 11 }, axisLine: { lineStyle: { color: css('--lj-border') } }, axisTick: { show: false } },
        series: [{ type: 'bar', barMaxWidth: 20,
          data: filas.map((p, i) => { const col = P[(filas.length - 1 - i) % P.length]; return { value: Number(p[campo]), itemStyle: { color: degrade(aclarar(col, 0.55), col, true), borderRadius: [0, 4, 4, 0] } }; }),
          label: { show: true, position: 'right', color: muted, fontSize: 11, formatter: (x) => (campo === 'importe' ? corto(x.value) : fmtNum.format(x.value)) } }]
      }, true);
    }

    // Ventas por caja: barras horizontales por usuario.
    const cajas = (r.por_usuario || []).filter((u) => Number(u.total) > 0);
    if (!cajas.length) vacio('vlGCajas');
    else {
      const filas = [...cajas].slice(0, 8).reverse();
      const o = baseOpts();
      chart('vlGCajas')?.setOption({ ...o,
        tooltip: { ...o.tooltip, axisPointer: { type: 'shadow' }, formatter: (ps) => { const u = filas[ps[0].dataIndex]; return `<b>${esc(u.usuario)}</b><br>${pesos(u.total)} · ${fmtNum.format(u.cant)} comprobantes`; } },
        grid: { ...o.grid, right: 64 },
        xAxis: { ...o.yAxis, type: 'value', axisLabel: { ...o.yAxis.axisLabel, show: !esMovil() } },
        yAxis: { type: 'category', data: filas.map((u) => u.usuario), axisLabel: { color: texto, fontSize: 11 }, axisLine: { lineStyle: { color: css('--lj-border') } }, axisTick: { show: false } },
        series: [{ type: 'bar', barMaxWidth: 22,
          data: filas.map((u, i) => { const col = P[(filas.length - 1 - i + 3) % P.length]; return { value: Number(u.total), itemStyle: { color: degrade(aclarar(col, 0.55), col, true), borderRadius: [0, 4, 4, 0] } }; }),
          label: { show: true, position: 'right', color: muted, fontSize: 11, formatter: (x) => corto(x.value) } }]
      }, true);
    }

    // Empresa (anillo interno) y factura A / B (anillo externo).
    const emps = (r.por_empresa || []).filter((e) => Number(e.total) > 0);
    const letras = (r.por_letra || []).filter((l) => Number(l.total) > 0);
    if (!emps.length && !letras.length) vacio('vlGEmpresa');
    else {
      const nombreEmp = { 1: 'Facturación', 2: 'Registradoras' };
      chart('vlGEmpresa')?.setOption({
        textStyle: { fontFamily: 'Inter, sans-serif', color: muted },
        tooltip: { ...baseOpts().tooltip, trigger: 'item', formatter: (p) => `<b>${esc(p.name)}</b><br>${pesos(p.value)} · ${fmtNum.format(p.percent)}%` },
        legend: { bottom: 0, type: 'plain', textStyle: { color: muted }, itemWidth: 12, itemHeight: 12, icon: 'rect' },
        series: [
          { name: 'Empresa', type: 'pie', radius: ['0%', '38%'], center: ['50%', '45%'], itemStyle: { borderColor: superficie, borderWidth: 2 },
            label: { position: 'inner', color: '#fff', fontWeight: 700, fontSize: 11, formatter: (p) => `${fmtNum.format(Math.round(p.percent))}%` },
            data: emps.map((e, i) => ({ name: esMovil() ? `Emp. ${e.empresa}` : `Empresa ${e.empresa} · ${nombreEmp[e.empresa] || ''}`.trim(), value: Number(e.total), itemStyle: { color: [P[0], P[5], P[2]][i % 3] } })) },
          { name: 'Factura', type: 'pie', radius: ['50%', '72%'], center: ['50%', '45%'], padAngle: 2, itemStyle: { borderColor: superficie, borderWidth: 2 },
            label: { color: texto, fontWeight: 700, fontSize: 11, formatter: (p) => `${p.name.replace('Factura ', '')} ${fmtNum.format(Math.round(p.percent))}%` },
            labelLine: { length: 6, length2: 6 },
            data: letras.map((l) => ({ name: `Factura ${l.letra}`, value: Number(l.total), itemStyle: { color: l.letra === 'A' ? P[3] : P[4] } })) }
        ]
      }, true);
    }
    requestAnimationFrame(ajustarGraficos);
  }
  const ajustarGraficos = () => Object.values(st.charts).forEach((c) => c.resize());
  window.addEventListener('resize', ajustarGraficos);

  // ---------- Datos ----------
  async function resumen(desde, hasta) {
    const { data, error } = await st.sb.rpc('ventas_resumen', { p_desde: desde, p_hasta: hasta, p_empresa: st.empresa });
    if (error) throw error;
    return data;
  }
  async function cargarResumen() {
    st.resumen = null; st.resumenComp = null; pintarKpis();
    const comp = rangoComparar(st.rango, st.clave);
    const periodo = st.rango.desde === st.rango.hasta ? fechaCorta(st.rango.desde) : `${fechaCorta(st.rango.desde)} al ${fechaCorta(st.rango.hasta)}`;
    $('vlComparando').innerHTML = `<i class="fa-regular fa-calendar"></i>${esc(periodo)}${st.comparar ? ` · comparando con ${esc(comp.texto)} (${esc(fechaCorta(comp.desde))}${comp.desde !== comp.hasta ? ` al ${esc(fechaCorta(comp.hasta))}` : ''})` : ''}`;
    try {
      // El catálogo (foto y vínculo del producto más vendido) se espera junto: así la tarjeta sale completa de una.
      const [r, c] = await Promise.all([resumen(st.rango.desde, st.rango.hasta), st.comparar ? resumen(comp.desde, comp.hasta) : Promise.resolve(null),
        Promise.resolve(cargarCatalogo()).catch(() => null)]);
      st.resumen = r; st.resumenComp = c;
    } catch (e) {
      notify('error', 'No se pudieron leer las ventas', textoError(e));
      st.resumen = {};
    }
    pintarKpis(); pintarGraficos();
  }

  const COLS = 'empresa,id,tipo,letra,punto_venta,numero,fecha,fecha_hora,cliente,cod_cliente,usuario,vendedor,condicion_venta,total,observaciones,anulada,cae,items_ok';
  function consultaComprobantes(cols = COLS, count = true) {
    let q = st.sb.from('im5_comprobantes').select(cols, count ? { count: 'exact' } : undefined)
      .gte('fecha', st.rango.desde).lte('fecha', st.rango.hasta);
    if (st.empresa) q = q.eq('empresa', st.empresa);
    const b = st.buscar.replace(/[,()*%\\]/g, ' ').trim();
    if (b) {
      if (/^\d+$/.test(b)) q = q.or(`numero.eq.${b},cliente.ilike.*${b}*,cod_cliente.eq.${b}`);
      else q = q.or(`cliente.ilike.*${b}*,usuario.ilike.*${b}*,observaciones.ilike.*${b}*,vendedor.ilike.*${b}*`);
    }
    return q.order('fecha', { ascending: false }).order('fecha_hora', { ascending: false, nullsFirst: false }).order('id', { ascending: false });
  }
  // ---------- Medios de pago (logo de marca o ícono, con su color) ----------
  // Logos a color guardados en el sitio (IMG/pagos/): Mercado Pago, Visa, Mastercard, American Express.
  const LOGO = (n) => `./IMG/pagos/${n}.svg`;
  const COND_PAGO = { EF: 'Efectivo', TJ: 'Tarjeta', CH: 'Cheque', TR: 'Transferencia', DB: 'Débito', CC: 'Cuenta corriente' };
  const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function medioPago(texto, cond) {
    const t = normal(texto); const c = String(cond || '').toUpperCase();
    if (/mercado ?pago/.test(t)) return { nombre: 'Mercado Pago', det: /qr/.test(t) ? 'QR' : /point/.test(t) ? 'Point' : '', logo: 'mercadopago', color: '#00B1EA' };
    if (/visa/.test(t)) return { nombre: 'Visa', logo: 'visa', color: '#1A1F71' };
    if (/master/.test(t)) return { nombre: 'Mastercard', logo: 'mastercard', color: '#EB001B' };
    if (/amex|american/.test(t)) return { nombre: 'American Express', logo: 'amex', color: '#2E77BC' };
    if (/cuenta corriente/.test(t) || c === 'CC') return { nombre: 'Cuenta corriente', icono: 'fa-file-invoice-dollar', color: '#7c3aed' };
    if (/banco|bco\.|cta\./.test(t) || c === 'TR') return { nombre: 'Transferencia', det: texto && !/transfer/.test(t) ? texto : '', icono: 'fa-building-columns', color: '#0891b2' };
    if (/tarjeta|credito|debito/.test(t) || c === 'TJ' || c === 'DB') return { nombre: /debito/.test(t) || c === 'DB' ? 'Débito' : 'Tarjeta de crédito', icono: 'fa-credit-card', color: '#2563eb' };
    if (/redondeo/.test(t)) return { nombre: 'Redondeo', icono: 'fa-scale-balanced', color: '#64748b' };
    if (/anticipo/.test(t)) return { nombre: 'Anticipo de cliente', icono: 'fa-hand-holding-dollar', color: '#ea580c' };
    if (/caja|efectivo/.test(t) || c === 'EF') return { nombre: 'Efectivo', det: /tesorer/.test(t) ? 'Tesorería' : '', icono: 'fa-money-bill-wave', color: '#16a34a' };
    if (c === 'CH') return { nombre: 'Cheque', icono: 'fa-money-check', color: '#0d9488' };
    return { nombre: texto || COND_PAGO[c] || 'Otro', icono: 'fa-wallet', color: '#64748b' };
  }
  function badgePago(texto, cond, extra = '') {
    const m = medioPago(texto, cond);
    const ico = m.logo ? `<img class="vl-pago-logo is-${m.logo}" src="${LOGO(m.logo)}" alt="" width="18" height="18">` : `<i class="fa-solid ${m.icono}"></i>`;
    return `<span class="vl-pago ${m.logo ? 'con-logo' : ''}" style="--c:${m.color}"><span class="vl-pago-ico">${ico}</span><span class="vl-pago-txt">${esc(m.nombre)}${m.det ? `<small>${esc(m.det)}</small>` : ''}</span>${extra ? `<small class="vl-pago-mas">${esc(extra)}</small>` : ''}</span>`;
  }
  // Avatar con iniciales y un color estable por nombre (cajas / usuarios).
  function avatar(nombre) {
    const n = String(nombre || '').trim();
    if (!n) return '';
    const ini = n.replace(/^cajera?\s+/i, '').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `<span class="vl-avatar" style="--c:${PALETA()[h % 10]}">${esc(ini)}</span>`;
  }

  const nombreComp = (r) => `${r.tipo === 'FA' ? 'Factura' : r.tipo === 'NC' ? 'N. crédito' : 'N. débito'} ${r.letra || ''} ${String(r.punto_venta || 0).padStart(4, '0')}-${String(r.numero || 0).padStart(8, '0')}`;
  function filaHtml(r) {
    const chip = r.tipo === 'NC' ? 'is-nc' : r.tipo === 'ND' ? 'is-nd' : 'is-fa';
    const d = r.fecha_hora ? new Date(r.fecha_hora) : null;
    const cliente = !r.cliente || /^c\.?\s?f\.?$/i.test(r.cliente.trim()) ? '<span class="vl-cf">Consumidor final</span>' : esc(r.cliente);
    return `<tr class="vl-fila ${r.anulada ? 'is-anulada' : ''}" data-emp="${r.empresa}" data-id="${r.id}" tabindex="0">
      <td><i class="fa-solid fa-chevron-right vl-exp"></i></td>
      <td class="vl-fecha"><b>${d ? esc(fmtHora.format(d)) : '—'}</b><span class="vl-dim">${esc(fechaCorta(r.fecha))}<span class="vl-ocultar-movil"> · Emp. ${r.empresa}</span></span></td>
      <td><span class="vl-chip ${chip}">${r.tipo}${r.letra ? ` ${esc(r.letra)}` : ''}</span><span class="vl-comp">${esc(String(r.punto_venta || 0).padStart(4, '0'))}-${esc(String(r.numero || 0).padStart(8, '0'))}</span>${r.anulada ? '<span class="vl-dim">Anulada</span>' : ''}</td>
      <td class="vl-cliente">${cliente}${r.observaciones && !/^factura im5$/i.test(r.observaciones.trim()) ? '<i class="fa-solid fa-comment-dots vl-obs-ico" title="Tiene observaciones"></i>' : ''}</td>
      <td class="vl-ocultar-movil"><span class="vl-caja">${avatar(r.usuario)}<span>${esc(r.usuario || '—')}${r.vendedor ? `<span class="vl-dim">${esc(r.vendedor)}</span>` : ''}</span></span></td>
      <td class="vl-ocultar-movil vl-cobro-celda" data-cobro="${r.empresa}:${r.id}">${badgePago(r.condicion_venta)}</td>
      <td class="vl-num ${r.tipo === 'NC' ? 'vl-total-nc' : ''}"><b class="vl-total">${r.tipo === 'NC' ? '−' : ''}${pesos2(r.total)}</b></td></tr>`;
  }
  async function cargarTabla() {
    const body = $('vlTablaBody');
    body.innerHTML = '<tr class="vl-tabla-vacia"><td colspan="7"><sl-spinner></sl-spinner></td></tr>';
    const desde = st.pagina * POR_PAGINA;
    const { data, error, count } = await consultaComprobantes().range(desde, desde + POR_PAGINA - 1);
    if (error) { body.innerHTML = `<tr class="vl-tabla-vacia"><td colspan="7">${esc(textoError(error))}</td></tr>`; return; }
    st.total = count || 0;
    body.innerHTML = (data || []).length ? data.map(filaHtml).join('')
      : `<tr class="vl-tabla-vacia"><td colspan="7">${st.buscar ? 'Nada coincide con la búsqueda.' : 'No hay comprobantes en este período.'}</td></tr>`;
    body._filas = Object.fromEntries((data || []).map((r) => [`${r.empresa}:${r.id}`, r]));
    $('vlTablaCuenta').textContent = st.total ? fmtNum.format(st.total) : '';
    completarMedios(data || []);
    const hasta = Math.min(desde + POR_PAGINA, st.total);
    $('vlPagInfo').textContent = st.total ? `${desde + 1}–${hasta} de ${fmtNum.format(st.total)}` : '';
    $('vlPagAnt').disabled = st.pagina === 0;
    $('vlPagSig').disabled = hasta >= st.total;
  }

  // Columna «Cobro»: con qué se cobró de verdad (Mercado Pago, efectivo…), sacado de los recibos de la página.
  // Mientras tanto queda la condición de venta del comprobante.
  async function completarMedios(filas) {
    const porEmp = {};
    filas.forEach((f) => { (porEmp[f.empresa] = porEmp[f.empresa] || []).push(f.id); });
    try {
      for (const [emp, ids] of Object.entries(porEmp)) {
        const { data: recs } = await st.sb.from('im5_comprobante_recibos').select('comprobante_id,recibo_id').eq('empresa', Number(emp)).in('comprobante_id', ids);
        if (!recs?.length) continue;
        const { data: pagos } = await st.sb.from('im5_pagos').select('recibo_id,medio,cond_pago,importe').eq('empresa', Number(emp)).in('recibo_id', [...new Set(recs.map((x) => x.recibo_id))]);
        const porRecibo = {};
        (pagos || []).forEach((p) => { (porRecibo[p.recibo_id] = porRecibo[p.recibo_id] || []).push(p); });
        const porComp = {};
        recs.forEach((x) => { (porComp[x.comprobante_id] = porComp[x.comprobante_id] || []).push(...(porRecibo[x.recibo_id] || [])); });
        Object.entries(porComp).forEach(([id, ps]) => {
          const celda = document.querySelector(`[data-cobro="${emp}:${id}"]`);
          const reales = ps.filter((p) => !/redondeo/i.test(p.medio || ''));
          if (!celda || !reales.length) return;
          const principal = [...reales].sort((a, b) => Number(b.importe) - Number(a.importe))[0];
          const otros = new Set(reales.map((p) => medioPago(p.medio, p.cond_pago).nombre)).size - 1;
          celda.innerHTML = badgePago(principal.medio, principal.cond_pago, otros > 0 ? `+${otros}` : '');
        });
      }
    } catch { /* queda la condición de venta */ }
  }

  // ---------- Vínculos: artículo de IM5 → receta (Producción) o ingrediente (Inventario) ----------
  const capital = (s) => String(s || '').replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  function cargarCatalogo(forzar = false) {
    if (st.catalogo && !forzar) return st.catalogo;
    st.catalogo = (async () => {
      const [ing, rec, vin] = await Promise.all([
        st.sb.from('ingredientes').select('id,nombre,nombreRaw:raw->>name,img:raw->>imageUrl'),
        st.sb.from('recetas').select('id,titulo:raw->>title,comercial:raw->>nombreComercial,img:raw->>imageUrl'),
        st.sb.from('im5_articulo_vinculos').select('cod_articulo,tipo,ref_id,estado,similitud,factor')
      ]);
      const items = new Map();
      (rec.data || []).forEach((r) => items.set(`receta:${r.id}`, { tipo: 'receta', id: r.id, nombre: capital(r.comercial || r.titulo), sub: r.comercial && r.titulo !== r.comercial ? capital(r.titulo) : '', img: r.img || '' }));
      (ing.data || []).forEach((r) => {
        const n = r.nombre || r.nombreRaw;
        if (!n || /^\(ingrediente eliminado/i.test(n)) return;
        items.set(`ingrediente:${r.id}`, { tipo: 'ingrediente', id: r.id, nombre: capital(n), sub: '', img: r.img || '' });
      });
      st.vinc = new Map((vin.data || []).map((v) => [v.cod_articulo, v]));
      st.catalogoListo = items;
      return items;
    })().catch((e) => { st.catalogo = null; throw e; });
    return st.catalogo;
  }
  const puedeEditar = () => Boolean(st.me?.admin || st.me?.puede_editar);
  function vinculoDe(cod, items) {
    const v = st.vinc?.get(String(cod));
    if (!v) return { estado: 'sin' };
    if (v.tipo === 'ninguno') return { estado: 'ninguno', v };
    const item = items.get(`${v.tipo}:${v.ref_id}`);
    if (!item) return { estado: 'sin', v };
    return { estado: v.estado === 'sugerido' ? 'sugerido' : 'ok', v, item };
  }
  function chipVinculo(vk) {
    if (vk.estado === 'sin') return '<span class="vl-vinc is-sin"><i class="fa-solid fa-link-slash"></i>Sin vincular</span>';
    if (vk.estado === 'ninguno') return '<span class="vl-vinc is-ninguno"><i class="fa-solid fa-ban"></i>No es de la fábrica</span>';
    const r = vk.item.tipo === 'receta';
    return `<span class="vl-vinc ${r ? 'is-receta' : 'is-ing'} ${vk.estado === 'sugerido' ? 'is-sugerido' : ''}"><i class="fa-solid ${r ? 'fa-industry' : 'fa-boxes-stacked'}"></i>${vk.estado === 'sugerido' ? 'Sugerido · ' : ''}${r ? 'Producción' : 'Inventario'} · ${esc(vk.item.nombre)}</span>`;
  }
  const imgHtml = (vk, clase = 'vl-prod-img') => {
    const url = vk.item?.img;
    const ph = vk.estado === 'ninguno' ? 'fa-tag' : vk.item?.tipo === 'receta' ? 'fa-industry' : 'fa-box-open';
    return `<span class="${clase}">${url ? `<img src="${esc((window.ljThumb || String)(url, 96))}" alt="" loading="lazy">` : `<i class="fa-solid ${ph}"></i>`}</span>`;
  };

  // Cobros del comprobante: recibos que lo cancelan → renglones de cobro (medio, cupón, id de pago de MP…).
  async function leerCobros(emp, id) {
    const { data: recs, error } = await st.sb.from('im5_comprobante_recibos').select('recibo_id,recibo_punto_venta,recibo_numero,importe_pagado')
      .eq('empresa', emp).eq('comprobante_id', id);
    if (error) return { error };
    if (!recs?.length) return { pagos: [] };
    const { data: pagos, error: e2 } = await st.sb.from('im5_pagos')
      .select('id,recibo_id,cond_pago,medio,importe,cupon,tarjeta_numero,autorizacion,lote,id_pago_externo,arancel,costo_financiero')
      .eq('empresa', emp).in('recibo_id', recs.map((x) => x.recibo_id)).order('id');
    return e2 ? { error: e2 } : { pagos: pagos || [], recibos: recs };
  }
  // Marca del medio de pago en grande (logo o ícono en su color) para la tarjeta de cobro.
  function marcaPago(texto, cond) {
    const m = medioPago(texto, cond);
    const ico = m.logo ? `<img src="${LOGO(m.logo)}" alt="" width="26" height="26">` : `<i class="fa-solid ${m.icono}"></i>`;
    return `<span class="vl-marca" style="--c:${m.color}"><span class="vl-marca-ico ${m.logo ? 'con-logo' : ''}">${ico}</span><span class="vl-marca-txt"><b>${esc(m.nombre)}</b>${m.det ? `<small>${esc(m.det)}</small>` : ''}</span></span>`;
  }
  // Mercado Pago: tarjeta real (payment_method_id), estado y lo que se acredita, consultado por la API.
  const MP_METODO = {
    debvisa: ['Visa débito', 'visa'], visa: ['Visa crédito', 'visa'], master: ['Mastercard crédito', 'mastercard'], debmaster: ['Mastercard débito', 'mastercard'],
    amex: ['American Express', 'amex'], maestro: ['Maestro', 'mastercard'], naranja: ['Naranja', ''], cabal: ['Cabal crédito', ''], debcabal: ['Cabal débito', ''],
    account_money: ['Dinero en cuenta de Mercado Pago', 'mercadopago'], consumer_credits: ['Mercado Crédito', 'mercadopago']
  };
  const MP_ESTADO = { approved: ['Aprobado', 'ok'], refunded: ['Devuelto', 'mal'], charged_back: ['Contracargo', 'mal'], cancelled: ['Cancelado', 'mal'], rejected: ['Rechazado', 'mal'], pending: ['Pendiente', 'esp'], in_process: ['En proceso', 'esp'], no_encontrado: ['No encontrado en MP', 'esp'] };
  const fmtFechaHoraLarga = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function htmlMP(m) {
    const [estTxt, estCls] = MP_ESTADO[m.estado] || [m.estado || '—', 'esp'];
    if (m.estado === 'no_encontrado') return `<div class="vl-mp"><div class="vl-mp-head"><img src="${LOGO('mercadopago')}" alt="" width="18" height="18">Mercado Pago<span class="vl-mp-estado is-${estCls}">${estTxt}</span></div></div>`;
    const [metTxt, metLogo] = MP_METODO[m.metodo] || [m.metodo || '—', ''];
    const tarjeta = `${metLogo ? `<img class="vl-mp-tar" src="${LOGO(metLogo)}" alt="">` : ''}${esc(metTxt)}${m.ultimos4 ? ` •••• ${esc(m.ultimos4)}` : ''}`;
    const dato = (t, v) => (v ? `<div><dt>${t}</dt><dd>${v}</dd></div>` : '');
    return `<div class="vl-mp">
      <div class="vl-mp-head"><img src="${LOGO('mercadopago')}" alt="" width="18" height="18">Verificado en Mercado Pago<span class="vl-mp-estado is-${estCls}">${estTxt}</span></div>
      <dl class="vl-pago-datos vl-mp-datos">
        ${dato('Medio', tarjeta)}${Number(m.cuotas) > 1 ? dato('Cuotas', String(m.cuotas)) : ''}
        ${dato('Aprobado', m.aprobado_at ? esc(fmtFechaHoraLarga.format(new Date(m.aprobado_at))) : '')}
        ${dato('Se acredita', m.acreditacion_at ? esc(fmtFechaHoraLarga.format(new Date(m.acreditacion_at))) : '')}
      </dl>
      ${m.neto != null ? `<div class="vl-pago-neto">
        <span><small>Cobrado</small><b class="is-neutro">${pesos2(m.monto)}</b></span>
        ${Number(m.comision) ? `<span><small>Comisión MP</small><b>− ${pesos2(m.comision)}</b></span>` : ''}
        <span class="is-neto"><small>Neto acreditado</small><b>${pesos2(m.neto)}</b></span></div>` : ''}
    </div>`;
  }
  function htmlCobros(c, r, mp = {}) {
    if (c.error) return `<p class="vl-ayuda">${esc(textoError(c.error))}</p>`;
    if (!c.pagos.length) {
      return `<div class="vl-pago-card"><div class="vl-pago-card-top">${marcaPago(r.condicion_venta)}<b class="vl-pago-imp">${pesos2(r.total)}</b></div>
        <p class="vl-pago-nota">${r.items_ok ? 'Sin recibo de cobro: cuenta corriente o pendiente.' : 'El detalle del cobro se baja en la próxima actualización.'}</p></div>`;
    }
    const dato = (t, v) => (v ? `<div><dt>${t}</dt><dd>${esc(v)}</dd></div>` : '');
    return c.pagos.map((p) => {
      const datos = [dato('ID de pago', p.id_pago_externo), dato('Cupón', p.cupon), dato('Tarjeta', p.tarjeta_numero ? `•••• ${String(p.tarjeta_numero).slice(-4)}` : ''), dato('Autorización', p.autorizacion), dato('Lote', p.lote)].join('');
      const arancel = Number(p.arancel) || 0; const costo = Number(p.costo_financiero) || 0;
      const neto = Number(p.importe) - arancel - costo;
      const m = p.id_pago_externo ? mp[String(p.id_pago_externo)] : null;
      return `<div class="vl-pago-card">
        <div class="vl-pago-card-top">${marcaPago(p.medio, p.cond_pago)}<b class="vl-pago-imp">${pesos2(p.importe)}</b></div>
        ${datos ? `<dl class="vl-pago-datos">${datos}</dl>` : ''}
        ${m ? htmlMP(m) : ''}
        ${!m && (arancel || costo) ? `<div class="vl-pago-neto">
          ${arancel ? `<span><small>Arancel</small><b>− ${pesos2(arancel)}</b></span>` : ''}
          ${costo ? `<span><small>Costo financiero</small><b>− ${pesos2(costo)}</b></span>` : ''}
          <span class="is-neto"><small>Neto recibido</small><b>${pesos2(neto)}</b></span></div>` : ''}
      </div>`;
    }).join('');
  }
  function htmlProductos(items, r, catalogo, aplic = {}) {
    if (items.error) return `<p class="vl-ayuda">${esc(textoError(items.error))}</p>`;
    if (!items.length) return `<p class="vl-ayuda">${r.items_ok ? 'Sin productos.' : 'Los productos de este comprobante se bajan en la próxima actualización.'}</p>`;
    const editar = puedeEditar();
    return `<ul class="vl-prods">${items.map((i) => {
      const vk = catalogo ? vinculoDe(i.cod_articulo, catalogo) : { estado: 'sin' };
      return `<li class="vl-prod ${vk.estado === 'sin' ? 'is-sin' : ''}">
        ${imgHtml(vk)}
        <span class="vl-prod-main"><b>${esc(i.descripcion || i.cod_articulo || '')}</b>${catalogo ? chipVinculo(vk) : ''}${htmlAplicacion(aplic[i.orden])}</span>
        <span class="vl-prod-cant"><b>${fmtNum.format(i.cantidad)} ${esc(i.unidad || '')}</b><small>× ${pesos2(i.precio_con_iva)}</small></span>
        <b class="vl-prod-imp">${pesos2(i.importe)}</b>
        ${editar && i.cod_articulo ? `<sl-icon-button class="vl-prod-edit" name="link-45deg" label="Vincular producto" data-vincular="${esc(i.cod_articulo)}" data-desc="${esc(i.descripcion || '')}"></sl-icon-button>` : ''}
      </li>`;
    }).join('')}</ul>`;
  }
  // Resultado de descontar el renglón del stock: lote/producción y cantidad, o por qué no.
  function htmlAplicacion(lista) {
    if (!lista?.length) return '';
    const ok = lista.filter((a) => a.estado === 'aplicado');
    const mal = lista.find((a) => a.estado === 'sin_stock');
    const exc = lista.find((a) => a.estado === 'excluido');
    const rev = lista.find((a) => a.estado === 'revertido');
    const partes = [];
    if (ok.length) partes.push(`<span class="vl-apl is-ok"><i class="fa-solid fa-arrow-down"></i>Descontado ${ok.map((a) => `${fmtNum.format(a.cantidad)} ${esc(a.unidad || '')} de ${esc(a.motivo || (a.destino === 'produccion' ? 'producción' : 'lote'))}`).join(' · ')}${ok[0].reparto_id ? ' (reparto)' : ''}</span>`);
    if (mal) partes.push(`<span class="vl-apl is-esp"><i class="fa-solid fa-circle-exclamation"></i>Sin stock: ${fmtNum.format(mal.cantidad || 0)} ${esc(mal.unidad || '')} no se descontaron</span>`);
    if (exc && !ok.length && !/sin vínculo/.test(exc.motivo || '')) partes.push(`<span class="vl-apl"><i class="fa-solid fa-ban"></i>${esc(capital(exc.motivo || 'No se descuenta'))}</span>`);
    if (rev) partes.push('<span class="vl-apl"><i class="fa-solid fa-rotate-left"></i>Revertido (comprobante anulado)</span>');
    return partes.join('');
  }
  async function pintarDetalle(det) {
    let catalogo = null;
    try { catalogo = await cargarCatalogo(); } catch { /* sin catálogo: se muestra sin vínculos */ }
    const { r, items, cobros } = det._datos;
    const totalItems = Array.isArray(items) ? items.reduce((s, i) => s + Number(i.importe || 0), 0) : 0;
    det.querySelector('.vl-detalle-in').innerHTML = `
      ${r.observaciones && !/^factura im5$/i.test(r.observaciones.trim()) ? `<div class="vl-detalle-obs"><b>Observaciones:</b> ${esc(r.observaciones)}</div>` : ''}
      <div class="vl-det-grid">
        <section>
          <p class="vl-detalle-tit"><i class="fa-solid fa-basket-shopping"></i> Productos${Array.isArray(items) && items.length ? ` <span>${items.length}</span>` : ''}</p>
          ${htmlProductos(items, r, catalogo, det._datos.aplic || {})}
          ${totalItems ? `<p class="vl-prods-total">Total productos <b>${pesos2(totalItems)}</b></p>` : ''}
        </section>
        <section>
          <p class="vl-detalle-tit"><i class="fa-solid fa-credit-card"></i> Cobro</p>
          <div class="vl-pagos">${htmlCobros(cobros, r, det._datos.mp || {})}</div>
          <p class="vl-detalle-tit vl-detalle-tit-2"><i class="fa-solid fa-file-invoice"></i> Comprobante</p>
          <dl class="vl-det-meta">
            <div><dt>Número</dt><dd>${esc(nombreComp(r))}</dd></div>
            ${r.usuario ? `<div><dt>Caja</dt><dd class="vl-caja">${avatar(r.usuario)}${esc(r.usuario)}</dd></div>` : ''}
            ${r.cod_cliente ? `<div><dt>Cliente</dt><dd>${esc(r.cliente && !/^c\.?\s?f\.?$/i.test(r.cliente.trim()) ? r.cliente : 'Consumidor final')} <span class="vl-dim-in">#${esc(r.cod_cliente)}</span></dd></div>` : ''}
            ${r.vendedor ? `<div><dt>Vendedor</dt><dd>${esc(r.vendedor)}</dd></div>` : ''}
            ${r.cae ? `<div><dt>CAE</dt><dd>${esc(r.cae)}</dd></div>` : ''}
          </dl>
        </section>
      </div>`;
  }
  async function toggleDetalle(tr) {
    const sig = tr.nextElementSibling;
    if (sig?.classList.contains('vl-detalle')) { sig.remove(); tr.classList.remove('is-abierta'); return; }
    tr.classList.add('is-abierta');
    const r = $('vlTablaBody')._filas?.[`${tr.dataset.emp}:${tr.dataset.id}`] || {};
    const det = document.createElement('tr');
    det.className = 'vl-detalle';
    det.innerHTML = '<td colspan="7"><div class="vl-detalle-in"><sl-spinner></sl-spinner></div></td>';
    tr.after(det);
    const emp = Number(tr.dataset.emp); const id = Number(tr.dataset.id);
    const [{ data, error }, cobros] = await Promise.all([
      st.sb.from('im5_items').select('orden,cod_articulo,descripcion,cantidad,unidad,precio_con_iva,importe,iva_por')
        .eq('empresa', emp).eq('comprobante_id', id).order('orden'),
      leerCobros(emp, id)
    ]);
    const items = error ? Object.assign([], { error }) : (data || []);
    // Qué se descontó de cada renglón (Inventario / Producción), si la sincronización con el stock ya lo procesó.
    const { data: apl } = await st.sb.from('im5_aplicaciones').select('orden,destino,lote_id,cantidad,unidad,estado,motivo,reparto_id').eq('empresa', emp).eq('comprobante_id', id);
    const aplic = {};
    (apl || []).forEach((a) => { (aplic[a.orden] = aplic[a.orden] || []).push(a); });
    det._datos = { r, items, cobros, mp: {}, aplic };
    await pintarDetalle(det);
    // Después, el detalle de Mercado Pago de los cobros que traen id de pago (no frena la apertura).
    const ids = (cobros.pagos || []).map((p) => p.id_pago_externo).filter(Boolean);
    if (ids.length) {
      try {
        const res = await window.laJamoneraProxy.postJson('/ventas/mp/pagos', { ids });
        const out = await res.json().catch(() => ({}));
        if (res.ok && out.ok !== false && Array.isArray(out.pagos) && out.pagos.length && det.isConnected) {
          det._datos.mp = Object.fromEntries(out.pagos.map((m) => [String(m.id_pago), m]));
          pintarDetalle(det);
        }
      } catch { /* sin Mercado Pago: queda lo de IM5 */ }
    }
  }
  const repintarDetalles = () => document.querySelectorAll('tr.vl-detalle').forEach((det) => { if (det._datos) pintarDetalle(det); });

  // Modal «Vincular producto»: elige la receta o el ingrediente de un artículo de IM5.
  const palabras = (s) => normal(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/(es|s)$/, ''));
  function puntaje(desc, item) {
    const a = new Set(palabras(desc)); if (!a.size) return 0;
    const b = palabras(`${item.nombre} ${item.sub}`);
    return b.filter((w) => a.has(w)).length / Math.max(a.size, 1) + (item.tipo === 'receta' ? 0.01 : 0);
  }
  async function abrirVincular(cod, desc) {
    if (!puedeEditar()) return notify('warning', 'Sin permiso', 'Necesitás permiso de edición para vincular productos.');
    let catalogo;
    try { catalogo = await cargarCatalogo(); } catch (e) { return notify('error', 'No se pudo leer el catálogo', textoError(e)); }
    const vk = vinculoDe(cod, catalogo);
    st.vincEdit = { cod: String(cod), desc: desc || st.vinc?.get(String(cod))?.descripcion || '', sel: vk.item ? `${vk.item.tipo}:${vk.item.id}` : '', filtro: 'todos', catalogo };
    $('vlVincArt').innerHTML = `${imgHtml(vk, 'vl-vinc-art-img')}<div><small>Producto de InfoManager · código ${esc(cod)}</small><b>${esc(st.vincEdit.desc)}</b>${chipVinculo(vk)}</div>`;
    $('vlVincBuscar').value = '';
    document.querySelectorAll('[data-vinc-tipo]').forEach((b) => b.classList.toggle('active', b.dataset.vincTipo === 'todos'));
    $('vlVincQuitar').hidden = vk.estado === 'sin';
    $('vlVincFactor').value = vk.v?.factor ? String(vk.v.factor) : '';
    pintarVincLista();
    $('vlVincDialog').show();
  }
  function pintarVincLista() {
    const e = st.vincEdit; if (!e) return;
    const q = normal(String($('vlVincBuscar').value ?? '').trim());
    let lista = [...e.catalogo.values()].filter((it) => e.filtro === 'todos' || it.tipo === e.filtro);
    if (q) lista = lista.filter((it) => normal(`${it.nombre} ${it.sub}`).includes(q));
    lista = lista.map((it) => ({ it, p: `${it.tipo}:${it.id}` === e.sel ? 9 : puntaje(e.desc, it) }))
      .sort((a, b) => b.p - a.p || a.it.nombre.localeCompare(b.it.nombre)).slice(0, 80);
    $('vlVincLista').innerHTML = lista.length ? lista.map(({ it, p }) => {
      const k = `${it.tipo}:${it.id}`;
      const r = it.tipo === 'receta';
      return `<li><button type="button" class="vl-vinc-op ${k === e.sel ? 'is-sel' : ''}" data-k="${esc(k)}" role="option" aria-selected="${k === e.sel}">
        <span class="vl-prod-img">${it.img ? `<img src="${esc((window.ljThumb || String)(it.img, 96))}" alt="" loading="lazy">` : `<i class="fa-solid ${r ? 'fa-industry' : 'fa-box-open'}"></i>`}</span>
        <span class="vl-vinc-op-txt"><b>${esc(it.nombre)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>
        <span class="vl-vinc ${r ? 'is-receta' : 'is-ing'}"><i class="fa-solid ${r ? 'fa-industry' : 'fa-boxes-stacked'}"></i>${r ? 'Producción' : 'Inventario'}</span>
        ${p >= 0.5 && k !== e.sel ? '<span class="vl-vinc-parecido">Parecido</span>' : ''}
        <i class="fa-solid fa-circle-check vl-vinc-check"></i>
      </button></li>`;
    }).join('') : '<li class="vl-ayuda vl-vinc-vacio">Nada coincide con la búsqueda.</li>';
  }
  async function guardarVinculo(tipo, refId) {
    const e = st.vincEdit; if (!e) return;
    const factor = Number(String($('vlVincFactor').value ?? '').replace(',', '.'));
    const fila = { cod_articulo: e.cod, descripcion: e.desc || null, tipo, ref_id: tipo === 'ninguno' ? null : refId, estado: 'confirmado', similitud: null,
      factor: tipo !== 'ninguno' && Number.isFinite(factor) && factor > 0 && factor !== 1 ? factor : null, updated_at: new Date().toISOString() };
    const { error } = await st.sb.from('im5_articulo_vinculos').upsert(fila, { onConflict: 'cod_articulo' });
    if (error) return notify('error', 'No se pudo guardar el vínculo', textoError(error));
    st.vinc.set(e.cod, fila);
    $('vlVincDialog').hide();
    notify('success', 'Producto vinculado', tipo === 'ninguno' ? `${e.desc}: marcado como «no es de la fábrica».` : `${e.desc} → ${e.catalogo.get(`${tipo}:${refId}`)?.nombre || ''}`);
    despuesDeVincular();
  }
  async function quitarVinculo() {
    const e = st.vincEdit; if (!e) return;
    const { error } = await st.sb.from('im5_articulo_vinculos').delete().eq('cod_articulo', e.cod);
    if (error) return notify('error', 'No se pudo quitar el vínculo', textoError(error));
    st.vinc.delete(e.cod);
    $('vlVincDialog').hide();
    despuesDeVincular();
  }
  function despuesDeVincular() { pintarKpis(); repintarDetalles(); if ($('vlArtDialog').open) pintarArticulos(); actualizarPendientes(); }

  // Modal «Productos de InfoManager»: todos los artículos vendidos, con su vínculo; para ir completando.
  async function abrirArticulos() {
    $('vlArtDialog').show();
    $('vlArtLista').innerHTML = '<li class="vl-art-cargando"><sl-spinner></sl-spinner></li>';
    try {
      const [{ data, error }] = await Promise.all([st.sb.rpc('ventas_articulos'), cargarCatalogo(true)]);
      if (error) throw error;
      st.articulos = (data || []).sort((a, b) => Number(b.importe) - Number(a.importe));
      $('vlArtSugerir').hidden = !puedeEditar();
      pintarArticulos();
    } catch (e) { $('vlArtLista').innerHTML = `<li class="vl-ayuda">${esc(textoError(e))}</li>`; }
  }
  function estadoArticulo(a, catalogo) { return vinculoDe(a.cod_articulo, catalogo).estado; }
  async function pintarArticulos() {
    const catalogo = await cargarCatalogo();
    const arts = st.articulos || [];
    const cuenta = { sin: 0, sugerido: 0, ok: 0, ninguno: 0 };
    arts.forEach((a) => { cuenta[estadoArticulo(a, catalogo)] += 1; });
    Object.entries(cuenta).forEach(([k, n]) => { const el = document.querySelector(`[data-art-cuenta="${k}"]`); if (el) el.textContent = fmtNum.format(n); });
    const todos = document.querySelector('[data-art-cuenta="todos"]'); if (todos) todos.textContent = fmtNum.format(arts.length);
    const filtro = st.artFiltro || 'sin';
    const q = normal(String($('vlArtBuscar').value ?? '').trim());
    const editar = puedeEditar();
    const lista = arts.filter((a) => (filtro === 'todos' || estadoArticulo(a, catalogo) === filtro) && (!q || normal(`${a.descripcion} ${a.cod_articulo}`).includes(q)));
    $('vlArtConfirmarTodos').hidden = !(editar && filtro === 'sugerido' && lista.length);
    $('vlArtLista').innerHTML = lista.length ? lista.map((a) => {
      const vk = vinculoDe(a.cod_articulo, catalogo);
      return `<li class="vl-art">
        ${imgHtml(vk)}
        <span class="vl-art-main"><b>${esc(a.descripcion || a.cod_articulo)}</b>
          <small>Código ${esc(a.cod_articulo)} · ${pesos(a.importe)} vendidos · ${fmtNum.format(a.comprobantes)} comp.${a.ultima_venta ? ` · última ${esc(fechaCorta(a.ultima_venta))}` : ''}</small>
          ${chipVinculo(vk)}</span>
        <span class="vl-art-acc">
          ${editar && vk.estado === 'sugerido' ? `<sl-button size="small" variant="success" data-art-confirmar="${esc(a.cod_articulo)}"><i slot="prefix" class="fa-solid fa-check"></i>Confirmar</sl-button>` : ''}
          ${editar ? `<sl-button size="small" variant="default" data-vincular="${esc(a.cod_articulo)}" data-desc="${esc(a.descripcion || '')}"><i slot="prefix" class="fa-solid fa-link"></i>${vk.estado === 'sin' ? 'Vincular' : 'Cambiar'}</sl-button>` : ''}
        </span></li>`;
    }).join('') : `<li class="vl-ayuda vl-vinc-vacio">${filtro === 'sin' ? '¡Todos los productos tienen vínculo!' : 'No hay productos en este grupo.'}</li>`;
  }
  async function confirmarSugeridos(cods) {
    if (!cods.length) return;
    const ahora = new Date().toISOString();
    const { error } = await st.sb.from('im5_articulo_vinculos').update({ estado: 'confirmado', updated_at: ahora }).in('cod_articulo', cods);
    if (error) return notify('error', 'No se pudo confirmar', textoError(error));
    cods.forEach((c) => { const v = st.vinc.get(c); if (v) v.estado = 'confirmado'; });
    notify('success', 'Vínculos confirmados', `${cods.length} producto${cods.length === 1 ? '' : 's'}.`);
    despuesDeVincular();
  }
  async function sugerirAutomatico() {
    const btn = $('vlArtSugerir'); btn.loading = true;
    try {
      const { data, error } = await st.sb.rpc('ventas_articulos_sugerir', { p_umbral: 0.5 });
      if (error) throw error;
      await cargarCatalogo(true);
      notify('success', 'Sugerencias listas', data ? `${data} producto${data === 1 ? '' : 's'} con sugerencia nueva. Revisalos en «Sugeridos».` : 'No hay productos nuevos para sugerir.');
      pintarArticulos(); actualizarPendientes();
    } catch (e) { notify('error', 'No se pudo sugerir', textoError(e)); } finally { btn.loading = false; }
  }
  async function actualizarPendientes() {
    try {
      const catalogo = await cargarCatalogo();
      const { data } = await st.sb.rpc('ventas_articulos');
      if (data) st.articulos = data.sort((a, b) => Number(b.importe) - Number(a.importe));
      const n = (st.articulos || []).filter((a) => ['sin', 'sugerido'].includes(estadoArticulo(a, catalogo))).length;
      $('vlArtPend').textContent = n ? fmtNum.format(n) : '';
    } catch { /* sin datos: sin contador */ }
  }

  // ---------- Salud ----------
  async function cargarConfig() {
    const { data, error } = await st.sb.from('ventas_config').select('config, estado').eq('id', 1).maybeSingle();
    if (error) throw error;
    st.cfg = data?.config || {}; st.estado = data?.estado || {};
  }
  function saludActual() {
    const e = st.estado || {};
    if (st.corriendo || (e.corriendo && Date.now() - Date.parse(e.corriendo.desde) < 5 * 60000)) return { estado: 'corriendo', titulo: 'Actualizando…', detalle: 'Bajando ventas de IM5' };
    if (!e.ultimaCorrida && !e.ultimaOk) return { estado: 'atrasada', titulo: 'Sin datos todavía', detalle: e.error || 'Todavía no corrió ninguna actualización' };
    if (e.ok === false) return { estado: 'error', titulo: 'Falló la última actualización', detalle: e.error || '' };
    const pendiente = !e.historialTerminado ? 'trayendo el historial' : e.pendientesItems ? `faltan detalles de ${fmtNum.format(e.pendientesItems)}` : '';
    const atrasada = st.cfg.activa !== false && e.proxima && Date.now() - Date.parse(e.proxima) > 40 * 60000;
    // Etiquetas cortas del widget: [ícono, texto]
    const partes = [
      ['fa-clock', haceCuanto(e.ultimaOk || e.ultimaCorrida)],
      st.cfg.activa === false ? ['fa-pause', 'automática apagada'] : e.proxima ? ['fa-forward', `próxima ${enCuanto(e.proxima)}`] : null,
      pendiente ? ['fa-hourglass-half', pendiente] : null
    ].filter(Boolean);
    return {
      estado: atrasada ? 'atrasada' : 'ok',
      titulo: atrasada ? 'Atrasada' : 'Sincronizada',
      partes,
      detalle: [`Actualizado ${haceCuanto(e.ultimaOk || e.ultimaCorrida)}`, st.cfg.activa === false ? 'automática apagada' : e.proxima ? `próxima ${enCuanto(e.proxima)}` : '', pendiente].filter(Boolean).join(' · ')
    };
  }
  function pintarSalud() {
    const s = saludActual();
    const btn = $('vlSalud');
    btn.dataset.estado = s.estado;
    $('vlSaludTitulo').textContent = s.titulo;
    // Renglón 2: cuándo se actualizó y la próxima. Renglón 3 (si hay): lo que falta completar.
    const partes = s.partes || [];
    const pend = partes.find(([ico]) => ico === 'fa-hourglass-half');
    $('vlSaludDetalle').textContent = partes.length
      ? partes.filter((p) => p !== pend).map(([ico, t]) => (ico === 'fa-clock' ? `Actualizado ${t}` : t)).join(' · ')
      : (s.detalle ? textoError(s.detalle) : ' ');
    $('vlSaludExtra').textContent = pend ? `Completando ${pend[1].replace(/^faltan detalles de /, '')} detalles de cobro` : '';
    btn.title = s.detalle ? `${s.titulo} · ${textoError(s.detalle)}` : s.titulo;
  }
  function pintarSaludDetalle() {
    const e = st.estado || {};
    const bf = e.backfill || {};
    const empresas = Array.isArray(st.cfg.empresas) ? st.cfg.empresas : [1, 2];
    const historial = empresas.map((emp) => {
      const b = bf[emp] || {};
      return `<div class="vl-salud-dato"><small>Historial · empresa ${emp}</small><b>${b.terminado ? 'Completo' : b.hasta ? `Llegó a ${new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(`${b.hasta}T12:00:00Z`))}` : 'Sin empezar'}</b>
        <span class="vl-dim">${fmtNum.format(b.total || 0)} comprobantes</span></div>`;
    }).join('');
    // Últimas corridas: las de los últimos 3 días (la sincronización borra las más viejas), de a 10 por página.
    const todas = (e.corridas || []).filter((c) => Date.parse(c.fin) >= Date.now() - 3 * 86400e3);
    const POR_PAG = 10;
    const paginas = Math.max(1, Math.ceil(todas.length / POR_PAG));
    st.corridasPag = Math.min(st.corridasPag || 0, paginas - 1);
    const malas = todas.filter((c) => !c.ok).length;
    const corridas = todas.slice(st.corridasPag * POR_PAG, (st.corridasPag + 1) * POR_PAG).map((c) => `<li class="${c.ok ? '' : 'is-mal'}"><span class="${c.ok ? 'ok' : 'mal'}"><i class="fa-solid ${c.ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i></span>
      <span>${esc(fmtFechaHora.format(new Date(c.fin)))} · ${c.modo === 'manual' ? 'manual' : 'automática'}</span>
      <span>${c.ok ? (c.frenadoIm5 ? 'pausa por límite de IM5' : `${c.nuevos} nuevos · ${c.items} con productos`) : esc(textoError(c.error || 'error'))} · ${Math.round((c.ms || 0) / 1000)} s</span></li>`).join('');
    const pie = todas.length > POR_PAG ? `<div class="vl-corridas-pie"><span>${st.corridasPag * POR_PAG + 1}–${Math.min((st.corridasPag + 1) * POR_PAG, todas.length)} de ${fmtNum.format(todas.length)}</span>
      <div><sl-button size="small" variant="default" data-corr-pag="-1" ${st.corridasPag === 0 ? 'disabled' : ''} aria-label="Más nuevas"><i class="fa-solid fa-chevron-left"></i></sl-button>
      <sl-button size="small" variant="default" data-corr-pag="1" ${st.corridasPag >= paginas - 1 ? 'disabled' : ''} aria-label="Más viejas"><i class="fa-solid fa-chevron-right"></i></sl-button></div></div>` : '';
    const pend = Number(e.pendientesItems || 0);
    $('vlSaludCuerpo').innerHTML = `
      ${e.ok === false && e.error ? `<div class="vl-salud-error"><b>Último error:</b> ${esc(textoError(e.error))}${e.erroresSeguidos > 1 ? ` · ${e.erroresSeguidos} veces seguidas` : ''}</div>` : ''}
      <div class="vl-salud-grid">
        <div class="vl-salud-dato"><small>Última actualización buena</small><b>${e.ultimaOk ? esc(fmtFechaHora.format(new Date(e.ultimaOk))) : 'Nunca'}</b><span class="vl-dim">${esc(haceCuanto(e.ultimaOk))}</span></div>
        <div class="vl-salud-dato"><small>Próxima automática</small><b>${st.cfg.activa === false ? 'Apagada' : e.proxima ? esc(fmtFechaHora.format(new Date(e.proxima))) : '—'}</b><span class="vl-dim">${esc(resumenHorario(st.cfg))}</span></div>
        ${historial}
        <div class="vl-salud-dato"><small>Productos por bajar</small><b>${pend ? `${fmtNum.format(pend)} comprobantes` : 'Al día'}</b><span class="vl-dim">${pend ? 'se completan en las próximas corridas' : '&nbsp;'}</span></div>
      </div>
      <p class="vl-salud-sub">Últimas corridas <span class="vl-salud-sub-nota">· últimos 3 días · ${fmtNum.format(todas.length)} corridas${malas ? ` · ${malas} con error` : ''}</span></p>
      <ul class="vl-corridas">${corridas || '<li><span>Todavía no hay corridas.</span></li>'}</ul>${pie}`;
  }
  function resumenHorario(cfg) {
    const nombres = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    const dias = (cfg.dias || []).map(Number).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const cada = Number(cfg.cadaMin || 120);
    const txtCada = cada >= 1440 ? 'una vez al día' : cada >= 60 ? `cada ${cada / 60} h` : `cada ${cada} min`;
    const txtDias = dias.join(',') === '1,2,3,4,5' ? 'de lunes a viernes' : dias.length === 7 ? 'todos los días' : dias.map((d) => nombres[d]).join(', ');
    return `${txtCada}, ${txtDias}, de ${cfg.desde ?? 8} a ${cfg.hasta ?? 19} h`;
  }
  async function refrescarSalud() {
    try { await cargarConfig(); } catch { /* sin red: se mantiene lo último */ }
    pintarSalud();
    if ($('vlSaludDialog').open) pintarSaludDetalle();
  }

  async function actualizarAhora() {
    if (st.corriendo) return;
    st.corriendo = true; pintarSalud();
    const btn = $('vlActualizar'); btn.loading = true;
    try {
      const res = await window.laJamoneraProxy.postJson('/ventas/sync', {});
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error || `Error ${res.status}`);
      const r = out.resumen || {};
      notify('success', 'Ventas actualizadas', `${r.nuevos || 0} comprobantes nuevos${r.items ? ` · ${r.items} con productos` : ''}.`);
    } catch (e) {
      notify('error', 'No se pudo actualizar', textoError(e));
    } finally {
      st.corriendo = false; btn.loading = false;
      await refrescarSalud();
      await Promise.all([cargarResumen(), cargarTabla()]);
    }
  }

  // ---------- Config ----------
  function abrirConfig() {
    const cfg = st.cfg;
    const horas = Array.from({ length: 24 }, (_, h) => `<sl-option value="${h}">${String(h).padStart(2, '0')}:00</sl-option>`).join('');
    $('cfgDesde').innerHTML = horas; $('cfgHasta').innerHTML = horas;
    customElements.whenDefined('sl-option').then(() => {
      $('cfgActiva').checked = cfg.activa !== false;
      $('cfgDesde').value = String(cfg.desde ?? 8);
      $('cfgHasta').value = String(cfg.hasta ?? 19);
      $('cfgCada').value = String(cfg.cadaMin ?? 120);
      $('cfgMail').value = cfg.mailAvisos || '';
      document.querySelectorAll('#cfgDias button').forEach((b) => b.setAttribute('aria-pressed', String((cfg.dias || [1, 2, 3, 4, 5]).map(Number).includes(Number(b.dataset.dia)))));
      document.querySelectorAll('[data-cfg-empresa]').forEach((c) => { c.checked = (cfg.empresas || [1, 2]).map(Number).includes(Number(c.dataset.cfgEmpresa)); });
      document.querySelectorAll('[data-cfg-tipo]').forEach((c) => { c.checked = (cfg.tipos || ['FA', 'NC', 'ND']).includes(c.dataset.cfgTipo); });
      st.kpisEdit = [...kpisActivos(), ...KPIS.map((k) => k.key).filter((k) => !kpisActivos().includes(k))].map((k) => ({ key: k, on: kpisActivos().includes(k) }));
      pintarKpisEdit();
      actualizarResumenCfg();
    });
    customElements.whenDefined('sl-switch').then(() => {
      const p = posCfg();
      $('posActivo').checked = Boolean(p.activo); $('posDesde').value = p.desde || '';
      $('posMateriaPrima').checked = p.excluirMateriaPrima !== false; $('posIaVencidos').checked = p.iaSoloVencidos !== false;
      $('posSinStock').checked = p.avisarSinStock !== false; $('posRepartos').checked = p.repartos?.activo !== false;
      $('posUsuario').value = p.repartos?.usuario || 'BRENDA'; $('posExigeObs').checked = p.repartos?.exigeObs !== false;
      if (!$('posSimFecha').value) $('posSimFecha').value = isoAR();
    });
    const esAdmin = Boolean(st.me?.admin);
    document.querySelectorAll('[data-solo-admin]').forEach((t) => { t.hidden = !esAdmin; });
    if (esAdmin) { cargarEstadoCred(); cargarEstadoMP(); }
    $('vlConfigDialog').show();
  }
  function leerCfgForm() {
    return {
      activa: $('cfgActiva').checked,
      dias: [...document.querySelectorAll('#cfgDias button[aria-pressed="true"]')].map((b) => Number(b.dataset.dia)),
      desde: Number(String($('cfgDesde').value ?? '')), hasta: Number(String($('cfgHasta').value ?? '')),
      cadaMin: Number(String($('cfgCada').value ?? '')),
      empresas: [...document.querySelectorAll('[data-cfg-empresa]')].filter((c) => c.checked).map((c) => Number(c.dataset.cfgEmpresa)),
      tipos: [...document.querySelectorAll('[data-cfg-tipo]')].filter((c) => c.checked).map((c) => c.dataset.cfgTipo),
      mailAvisos: String($('cfgMail').value ?? '').trim(),
      kpis: (st.kpisEdit || []).filter((k) => k.on).map((k) => k.key)
    };
  }
  function actualizarResumenCfg() {
    const f = leerCfgForm();
    $('cfgResumen').textContent = f.activa ? `Se actualiza ${resumenHorario(f)} (hora de Argentina). Además podés tocar «Actualizar ahora» cuando quieras.` : 'La actualización automática está apagada: solo se actualiza con «Actualizar ahora».';
  }
  function pintarKpisEdit() {
    $('cfgKpis').innerHTML = st.kpisEdit.map((k, i) => {
      const def = KPI_POR_KEY[k.key];
      return `<li class="${k.on ? '' : 'is-apagado'}" data-i="${i}"><i class="fa-solid ${def.icono}"></i><span>${esc(def.titulo)}</span>
        <sl-icon-button name="arrow-up" label="Subir" data-mover="-1" ${i === 0 ? 'disabled' : ''}></sl-icon-button>
        <sl-icon-button name="arrow-down" label="Bajar" data-mover="1" ${i === st.kpisEdit.length - 1 ? 'disabled' : ''}></sl-icon-button>
        <sl-switch size="small" ${k.on ? 'checked' : ''} data-kpi-on></sl-switch></li>`;
    }).join('');
  }
  async function guardarConfig() {
    const f = leerCfgForm();
    if (!f.dias.length) return notify('warning', 'Revisá la configuración', ERRORES.dias_invalidos);
    if (!f.empresas.length) return notify('warning', 'Revisá la configuración', ERRORES.empresas_invalidas);
    if (!f.tipos.length) return notify('warning', 'Revisá la configuración', 'Elegí al menos un tipo de comprobante.');
    if (f.desde > f.hasta) return notify('warning', 'Revisá la configuración', ERRORES.horario_invalido);
    const btn = $('cfgGuardar'); btn.loading = true;
    try {
      const { data, error } = await st.sb.rpc('ventas_config_guardar', { p_config: f });
      if (error) throw error;
      st.cfg = data || f;
      if (st.me?.admin || st.me?.puede_editar) {
        const { data: pos, error: e2 } = await st.sb.rpc('ventas_pos_config_guardar', { p_pos: leerPosForm() });
        if (e2) throw e2;
        st.cfg.pos = pos;
      }
      notify('success', 'Configuración guardada', resumenHorario(st.cfg));
      $('vlConfigDialog').hide();
      pintarKpis(); pintarSalud();
    } catch (e) {
      notify('error', 'No se pudo guardar', textoError(e));
    } finally { btn.loading = false; }
  }
  async function cargarEstadoCred() {
    const el = $('cfgCredEstado');
    el.className = 'vl-cred-estado'; el.textContent = 'Revisando…';
    try {
      const res = await window.laJamoneraProxy.getJson('/ventas/credenciales');
      const out = await res.json();
      if (!res.ok || out.ok === false) throw new Error(out.error);
      if (out.configurada) {
        el.className = 'vl-cred-estado is-ok';
        el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Conectado como <b>${esc(out.usuario)}</b> en <b>${esc(out.base)}</b>.`;
        $('cfgBase').value = out.base; $('cfgUsuario').value = out.usuario;
      } else {
        el.className = 'vl-cred-estado is-falta';
        el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Todavía no hay credenciales cargadas.';
      }
    } catch (e) { el.textContent = textoError(e); }
  }
  // ---------- Ventas del POS → Inventario / Producción ----------
  const posCfg = () => ({ activo: false, desde: '', excluirMateriaPrima: true, iaSoloVencidos: true, avisarSinStock: true, repartos: { activo: true, usuario: 'BRENDA', exigeObs: true }, ...(st.cfg.pos || {}) });
  function leerPosForm() {
    return {
      activo: $('posActivo').checked, desde: String($('posDesde').value || ''),
      excluirMateriaPrima: $('posMateriaPrima').checked, iaSoloVencidos: $('posIaVencidos').checked, avisarSinStock: $('posSinStock').checked,
      repartos: { activo: $('posRepartos').checked, usuario: String($('posUsuario').value ?? '').trim().toUpperCase() || 'BRENDA', exigeObs: $('posExigeObs').checked }
    };
  }
  async function simularPos() {
    const fecha = String($('posSimFecha').value || isoAR());
    const btn = $('posSimular'); btn.loading = true;
    const caja = $('posSimRes'); caja.innerHTML = '<sl-spinner></sl-spinner>';
    try {
      const res = await window.laJamoneraProxy.postJson('/ventas/pos/simular', { desde: fecha, hasta: fecha, detalle: true });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error || `Error ${res.status}`);
      const grupos = {};
      (out.detalle || []).filter((d) => d.estado !== 'reparto').forEach((d) => {
        const k = `${d.estado}|${d.estado === 'aplicado' ? (d.destino === 'produccion' ? 'Producción' : 'Inventario') : d.motivo}`;
        (grupos[k] = grupos[k] || { estado: d.estado, motivo: k.split('|')[1], n: 0, arts: new Set() }).n += 1;
        grupos[k].arts.add(d.articulo);
      });
      const ETQ = { aplicado: ['Se descuenta', 'ok'], sin_stock: ['Sin stock (se ignora)', 'esp'], excluido: ['No se descuenta', 'neutro'] };
      const repartos = (out.detalle || []).filter((d) => d.estado === 'reparto');
      caja.innerHTML = `
        <div class="vl-pos-sim-cifras">
          <span><b>${fmtNum.format(out.comprobantes)}</b>ventas</span><span class="is-ok"><b>${fmtNum.format(out.aplicados)}</b>renglones se descuentan</span>
          <span class="is-esp"><b>${fmtNum.format(out.sinStock)}</b>sin stock</span><span><b>${fmtNum.format(out.excluidos)}</b>no se descuentan</span><span><b>${fmtNum.format(out.repartos)}</b>repartos</span>
        </div>
        <ul class="vl-pos-sim-lista">${Object.values(grupos).sort((a, b) => b.n - a.n).map((g) => `<li><span class="vl-mp-estado is-${ETQ[g.estado]?.[1] || 'esp'}">${ETQ[g.estado]?.[0] || g.estado}</span>
          <div><b>${esc(capital(g.motivo))} · ${g.n}</b><small>${esc([...g.arts].slice(0, 8).join(', '))}${g.arts.size > 8 ? ` y ${g.arts.size - 8} más` : ''}</small></div></li>`).join('')}
          ${repartos.map((r) => `<li><span class="vl-mp-estado is-ok">Reparto</span><div><b>${esc(r.comp)}</b><small>${esc(r.motivo)}</small></div></li>`).join('')}</ul>
        <p class="vl-ayuda">Simulación del ${esc(fechaCorta(fecha))}: no se tocó el stock. «Sin vínculo» se resuelve en el botón «Productos».</p>`;
    } catch (e) { caja.innerHTML = `<p class="vl-ayuda">${esc(textoError(e))}</p>`; } finally { btn.loading = false; }
  }

  async function cargarEstadoMP() {
    const el = $('cfgMpEstado');
    el.className = 'vl-cred-estado'; el.textContent = 'Revisando…';
    try {
      const res = await window.laJamoneraProxy.getJson('/ventas/mp/credenciales');
      const out = await res.json();
      if (!res.ok || out.ok === false) throw new Error(out.error);
      if (!out.configurada) { el.className = 'vl-cred-estado is-falta'; el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Mercado Pago no está conectado.'; return; }
      if (out.error) { el.className = 'vl-cred-estado is-falta'; el.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> NinjaPos: ${esc(textoError(new Error(out.error)))}`; return; }
      if (out.vencido) { el.className = 'vl-cred-estado is-falta'; el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> El token venció: cargá el nuevo que generó el otro sistema.'; return; }
      const vence = out.vence ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(out.vence)) : '';
      el.className = 'vl-cred-estado is-ok';
      el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Conectado a la cuenta <b>${esc(out.cuenta?.nickname || out.cuenta?.id || '')}</b>${out.ninjapos ? ' · token vía <b>NinjaPos</b> (se renueva solo)' : vence ? ` · token cargado a mano, vence el <b>${esc(vence)}</b>` : ''}.`;
    } catch (e) { el.textContent = textoError(e); }
  }
  async function guardarNinjaPos() {
    const btn = $('cfgMpNinjaGuardar'); btn.loading = true;
    try {
      const res = await window.laJamoneraProxy.postJson('/ventas/mp/credenciales', { ninjasoft_key: String($('cfgMpNinja').value ?? '').trim() });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error || `Error ${res.status}`);
      $('cfgMpNinja').value = '';
      notify('success', 'Conectado vía NinjaPos', `Cuenta ${out.cuenta?.nickname || out.cuenta?.id || ''}. Ya podés borrar el archivo del escritorio.`);
      cargarEstadoMP();
    } catch (e) { notify('error', 'No se pudo conectar con NinjaPos', textoError(e)); } finally { btn.loading = false; }
  }
  async function guardarMP() {
    const btn = $('cfgMpGuardar'); btn.loading = true;
    try {
      const res = await window.laJamoneraProxy.postJson('/ventas/mp/credenciales', { access_token: String($('cfgMpToken').value ?? '').trim() });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error || `Error ${res.status}`);
      $('cfgMpToken').value = '';
      notify('success', 'Mercado Pago conectado', `Cuenta ${out.cuenta?.nickname || out.cuenta?.id || ''}.`);
      cargarEstadoMP();
    } catch (e) { notify('error', 'No se pudo conectar Mercado Pago', textoError(e)); } finally { btn.loading = false; }
  }
  async function guardarCred() {
    const btn = $('cfgCredGuardar'); btn.loading = true;
    try {
      const body = { base: String($('cfgBase').value ?? '').trim(), usuario: String($('cfgUsuario').value ?? '').trim(), password: String($('cfgPassword').value ?? '') };
      const res = await window.laJamoneraProxy.postJson('/ventas/credenciales', body);
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error || `Error ${res.status}`);
      $('cfgPassword').value = '';
      notify('success', 'Conexión con IM5 lista', `Entró como ${out.usuario} (${Math.round((out.ms || 0) / 100) / 10} s).`);
      cargarEstadoCred();
    } catch (e) {
      notify('error', 'No se pudo conectar con IM5', textoError(e));
    } finally { btn.loading = false; }
  }

  // ---------- Excel ----------
  async function exportarExcel() {
    if (!window.ExcelJS) return notify('error', 'Excel', 'No se pudo cargar la librería de Excel.');
    const btn = $('vlExcel'); btn.loading = true;
    try {
      const filas = [];
      for (let desde = 0; desde < 50000; desde += 1000) {
        const { data, error } = await consultaComprobantes(COLS, false).range(desde, desde + 999);
        if (error) throw error;
        filas.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const items = [];
      for (const emp of [...new Set(filas.map((f) => f.empresa))]) {
        const ids = filas.filter((f) => f.empresa === emp).map((f) => f.id);
        for (let i = 0; i < ids.length; i += 200) {
          const { data, error } = await st.sb.from('im5_items').select('empresa,comprobante_id,orden,cod_articulo,descripcion,cantidad,unidad,precio_con_iva,importe,iva_por')
            .eq('empresa', emp).in('comprobante_id', ids.slice(i, i + 200)).order('comprobante_id').order('orden');
          if (error) throw error;
          items.push(...(data || []));
        }
      }
      const porId = Object.fromEntries(filas.map((f) => [`${f.empresa}:${f.id}`, f]));
      const wb = new window.ExcelJS.Workbook();
      wb.creator = 'La Jamonera';
      const estiloCab = (ws) => {
        const fila = ws.getRow(1);
        fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173D73' } };
        fila.alignment = { vertical: 'middle' };
        fila.height = 22;
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
      };
      const ws = wb.addWorksheet('Comprobantes');
      ws.columns = [
        { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Hora', key: 'hora', width: 8 }, { header: 'Empresa', key: 'empresa', width: 9 },
        { header: 'Tipo', key: 'tipo', width: 6 }, { header: 'Letra', key: 'letra', width: 6 }, { header: 'Pto. venta', key: 'pv', width: 10 },
        { header: 'Número', key: 'numero', width: 11 }, { header: 'Cliente', key: 'cliente', width: 30 }, { header: 'Caja / usuario', key: 'usuario', width: 18 },
        { header: 'Vendedor', key: 'vendedor', width: 18 }, { header: 'Cobro', key: 'cobro', width: 18 }, { header: 'Total', key: 'total', width: 14 },
        { header: 'Neto (− NC)', key: 'neto', width: 14 }, { header: 'Anulada', key: 'anulada', width: 9 }, { header: 'Observaciones', key: 'obs', width: 40 }, { header: 'CAE', key: 'cae', width: 16 }
      ];
      filas.forEach((f) => ws.addRow({
        fecha: new Date(`${f.fecha}T12:00:00Z`), hora: f.fecha_hora ? fmtHora.format(new Date(f.fecha_hora)) : '', empresa: f.empresa, tipo: f.tipo, letra: f.letra,
        pv: f.punto_venta, numero: f.numero, cliente: f.cliente, usuario: f.usuario, vendedor: f.vendedor, cobro: f.condicion_venta, total: Number(f.total),
        neto: f.anulada ? 0 : Number(f.total) * (f.tipo === 'NC' ? -1 : 1), anulada: f.anulada ? 'Sí' : '', obs: f.observaciones, cae: f.cae
      }));
      ws.getColumn('fecha').numFmt = 'dd/mm/yyyy';
      ws.getColumn('total').numFmt = '"$" #,##0.00'; ws.getColumn('neto').numFmt = '"$" #,##0.00';
      estiloCab(ws);
      const wi = wb.addWorksheet('Productos');
      wi.columns = [
        { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Comprobante', key: 'comp', width: 24 }, { header: 'Código', key: 'cod', width: 12 },
        { header: 'Producto', key: 'desc', width: 36 }, { header: 'Cantidad', key: 'cant', width: 11 }, { header: 'Unidad', key: 'uni', width: 9 },
        { header: 'Precio c/IVA', key: 'precio', width: 14 }, { header: 'Importe', key: 'importe', width: 14 }, { header: 'IVA %', key: 'iva', width: 8 }
      ];
      items.forEach((i) => {
        const c = porId[`${i.empresa}:${i.comprobante_id}`] || {};
        wi.addRow({ fecha: c.fecha ? new Date(`${c.fecha}T12:00:00Z`) : null, comp: c.tipo ? nombreComp(c) : i.comprobante_id, cod: i.cod_articulo, desc: i.descripcion,
          cant: Number(i.cantidad), uni: i.unidad, precio: i.precio_con_iva == null ? null : Number(i.precio_con_iva), importe: Number(i.importe), iva: i.iva_por == null ? null : Number(i.iva_por) });
      });
      wi.getColumn('fecha').numFmt = 'dd/mm/yyyy';
      wi.getColumn('precio').numFmt = '"$" #,##0.00'; wi.getColumn('importe').numFmt = '"$" #,##0.00';
      estiloCab(wi);
      const buf = await wb.xlsx.writeBuffer();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = `ventas-local_${st.rango.desde}_${st.rango.hasta}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      notify('success', 'Excel listo', `${fmtNum.format(filas.length)} comprobantes y ${fmtNum.format(items.length)} renglones de productos.`);
    } catch (e) {
      notify('error', 'No se pudo armar el Excel', textoError(e));
    } finally { btn.loading = false; }
  }

  // ---------- Eventos ----------
  function elegirRango(clave, rango) {
    st.clave = clave; st.rango = rango; st.pagina = 0;
    document.querySelectorAll('[data-rango]').forEach((b) => b.classList.toggle('active', b.dataset.rango === clave));
    $('vlRangoTexto').textContent = clave === 'custom' ? `${fechaCorta(rango.desde)} – ${fechaCorta(rango.hasta)}` : 'Elegir fechas';
    cargarResumen(); cargarTabla();
  }
  function cablear() {
    let fp = null;
    if (window.flatpickr) {
      fp = window.flatpickr($('vlRangoInput'), {
        mode: 'range', dateFormat: 'Y-m-d', locale: window.flatpickr.l10ns?.es || 'default', maxDate: isoAR(),
        positionElement: document.querySelector('[data-rango="custom"]'),
        onClose: (sel) => {
          if (sel.length !== 2) return;
          const f = (d) => isoAR(d);
          elegirRango('custom', { desde: f(sel[0]), hasta: f(sel[1]) });
        }
      });
    }
    document.querySelectorAll('[data-rango]').forEach((b) => b.addEventListener('click', () => {
      const clave = b.dataset.rango;
      if (clave === 'custom') { fp?.open(); return; }
      elegirRango(clave, rangoDe(clave));
    }));
    $('vlEmpresa').addEventListener('sl-change', (e) => { const v = String(e.target.value); st.empresa = v === 'todas' ? null : Number(v); st.pagina = 0; cargarResumen(); cargarTabla(); });
    $('vlComparar').addEventListener('sl-change', (e) => { st.comparar = e.target.checked; cargarResumen(); });
    $('vlTopModo').addEventListener('sl-change', (e) => { st.topModo = String(e.target.value); pintarGraficos(); });
    let tBuscar = 0;
    const onBuscar = (e) => { clearTimeout(tBuscar); tBuscar = setTimeout(() => { st.buscar = String(e.target.value ?? ''); st.pagina = 0; cargarTabla(); }, 350); };
    $('vlBuscar').addEventListener('sl-input', onBuscar);
    $('vlBuscar').addEventListener('sl-clear', onBuscar);
    $('vlPagAnt').addEventListener('click', () => { if (st.pagina > 0) { st.pagina -= 1; cargarTabla(); } });
    $('vlPagSig').addEventListener('click', () => { st.pagina += 1; cargarTabla(); });
    $('vlTablaBody').addEventListener('click', (e) => {
      const v = e.target.closest('[data-vincular]');
      if (v) { e.stopPropagation(); abrirVincular(v.dataset.vincular, v.dataset.desc); return; }
      const tr = e.target.closest('tr.vl-fila'); if (tr) toggleDetalle(tr);
    });
    // Vínculos de productos
    $('vlArtBtn').addEventListener('click', abrirArticulos);
    document.querySelectorAll('[data-art-filtro]').forEach((b) => b.addEventListener('click', () => {
      st.artFiltro = b.dataset.artFiltro;
      document.querySelectorAll('[data-art-filtro]').forEach((x) => x.classList.toggle('active', x === b));
      pintarArticulos();
    }));
    let tArt = 0;
    $('vlArtBuscar').addEventListener('sl-input', () => { clearTimeout(tArt); tArt = setTimeout(pintarArticulos, 200); });
    $('vlArtBuscar').addEventListener('sl-clear', pintarArticulos);
    $('vlArtLista').addEventListener('click', (e) => {
      const v = e.target.closest('[data-vincular]'); if (v) { abrirVincular(v.dataset.vincular, v.dataset.desc); return; }
      const c = e.target.closest('[data-art-confirmar]'); if (c) confirmarSugeridos([c.dataset.artConfirmar]);
    });
    $('vlArtSugerir').addEventListener('click', sugerirAutomatico);
    $('vlArtConfirmarTodos').addEventListener('click', async () => {
      const catalogo = await cargarCatalogo();
      const q = normal(String($('vlArtBuscar').value ?? '').trim());
      confirmarSugeridos((st.articulos || []).filter((a) => estadoArticulo(a, catalogo) === 'sugerido' && (!q || normal(`${a.descripcion} ${a.cod_articulo}`).includes(q))).map((a) => a.cod_articulo));
    });
    document.querySelectorAll('[data-vinc-tipo]').forEach((b) => b.addEventListener('click', () => {
      if (!st.vincEdit) return;
      st.vincEdit.filtro = b.dataset.vincTipo;
      document.querySelectorAll('[data-vinc-tipo]').forEach((x) => x.classList.toggle('active', x === b));
      pintarVincLista();
    }));
    $('vlVincBuscar').addEventListener('sl-input', pintarVincLista);
    $('vlVincBuscar').addEventListener('sl-clear', pintarVincLista);
    $('vlVincLista').addEventListener('click', (e) => {
      const op = e.target.closest('.vl-vinc-op'); if (!op || !st.vincEdit) return;
      st.vincEdit.sel = op.dataset.k;
      document.querySelectorAll('.vl-vinc-op').forEach((x) => { const on = x === op; x.classList.toggle('is-sel', on); x.setAttribute('aria-selected', String(on)); });
    });
    $('vlVincLista').addEventListener('dblclick', (e) => { const op = e.target.closest('.vl-vinc-op'); if (op) { const i = op.dataset.k.indexOf(':'); guardarVinculo(op.dataset.k.slice(0, i), op.dataset.k.slice(i + 1)); } });
    $('vlVincGuardar').addEventListener('click', () => {
      const k = st.vincEdit?.sel; if (!k) return notify('warning', 'Elegí un producto', 'Tocá la receta o el ingrediente que corresponde, o marcá «No es de la fábrica».');
      const i = k.indexOf(':'); guardarVinculo(k.slice(0, i), k.slice(i + 1));
    });
    $('vlVincNinguno').addEventListener('click', () => guardarVinculo('ninguno', null));
    $('vlVincQuitar').addEventListener('click', quitarVinculo);
    $('vlVincCancelar').addEventListener('click', () => $('vlVincDialog').hide());
    $('vlTablaBody').addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const tr = e.target.closest('tr.vl-fila'); if (tr) { e.preventDefault(); toggleDetalle(tr); } });
    $('vlActualizar').addEventListener('click', actualizarAhora);
    $('vlExcel').addEventListener('click', exportarExcel);
    $('vlSalud').addEventListener('click', () => { st.corridasPag = 0; pintarSaludDetalle(); $('vlSaludDialog').show(); });
    $('vlSaludCuerpo').addEventListener('click', (e) => {
      const b = e.target.closest('[data-corr-pag]'); if (!b || b.disabled) return;
      st.corridasPag = Math.max(0, (st.corridasPag || 0) + Number(b.dataset.corrPag)); pintarSaludDetalle();
    });
    $('vlConfigBtn').addEventListener('click', abrirConfig);
    $('cfgMailPrueba').addEventListener('click', mandarMailPrueba);
    // Pestaña «Gráficos»: se dibujan al mostrarse (y se reajustan si ya estaban).
    $('vlTabs').addEventListener('sl-tab-show', (e) => {
      if (e.detail?.name !== 'graficos') return;
      requestAnimationFrame(() => { if (st.graficosPendientes || !Object.keys(st.charts).length) pintarGraficos(); else ajustarGraficos(); });
    });
    $('cfgCancelar').addEventListener('click', () => $('vlConfigDialog').hide());
    $('cfgGuardar').addEventListener('click', guardarConfig);
    $('cfgCredGuardar').addEventListener('click', guardarCred);
    $('cfgMpGuardar').addEventListener('click', guardarMP);
    $('cfgMpNinjaGuardar').addEventListener('click', guardarNinjaPos);
    $('posSimular').addEventListener('click', simularPos);
    $('cfgDias').addEventListener('click', (e) => { const b = e.target.closest('button[data-dia]'); if (!b) return; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); actualizarResumenCfg(); });
    ['cfgActiva', 'cfgDesde', 'cfgHasta', 'cfgCada'].forEach((id) => $(id).addEventListener('sl-change', actualizarResumenCfg));
    $('cfgKpis').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mover]'); if (!btn) return;
      const i = Number(btn.closest('li').dataset.i); const j = i + Number(btn.dataset.mover);
      if (j < 0 || j >= st.kpisEdit.length) return;
      [st.kpisEdit[i], st.kpisEdit[j]] = [st.kpisEdit[j], st.kpisEdit[i]];
      pintarKpisEdit();
    });
    $('cfgKpis').addEventListener('sl-change', (e) => {
      if (!e.target.matches('[data-kpi-on]')) return;
      const i = Number(e.target.closest('li').dataset.i);
      st.kpisEdit[i].on = e.target.checked;
      e.target.closest('li').classList.toggle('is-apagado', !e.target.checked);
    });
    // Salud: se relee cada 20 s con la pestaña a la vista; los textos «hace X» se mueven cada 30 s.
    setInterval(() => { if (document.visibilityState === 'visible') refrescarSalud(); }, 20000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refrescarSalud(); });
    // Cambio de tema: ECharts no lee CSS, se vuelven a dibujar con los colores nuevos.
    let temaOscuro = oscuro();
    new MutationObserver(() => {
      const ahora = oscuro();
      if (ahora === temaOscuro) return;
      temaOscuro = ahora;
      pintarKpis();
      Object.values(st.charts).forEach((c) => c.dispose()); st.charts = {}; pintarGraficos();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  // Manda el aviso de falla (marcado «prueba») a los mails guardados. Si el campo cambió y no se guardó, avisa.
  async function mandarMailPrueba() {
    const btn = $('cfgMailPrueba');
    const enCampo = String($('cfgMail').value ?? '').trim();
    if (enCampo !== String(st.cfg.mailAvisos || '').trim()) return notify('warning', 'Guardá primero', 'La prueba va a los mails guardados: tocá «Guardar» y después probá.');
    if (!enCampo) return notify('warning', 'Falta el mail', 'Cargá al menos un mail para los avisos.');
    btn.loading = true;
    try {
      const res = await window.laJamoneraProxy.postJson('/ventas/aviso-prueba', {});
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error || `Error ${res.status}`);
      notify('success', 'Mail de prueba enviado', `Llega a ${(out.destinos || []).join(', ')} en unos segundos.`);
    } catch (e) {
      notify('error', 'No se pudo mandar la prueba', /email_no_configurado/.test(String(e?.message)) ? 'Falta configurar el envío de mails (Configuración → Email).' : textoError(e));
    } finally { btn.loading = false; }
  }

  async function iniciar() {
    await window.laJamoneraReady;
    st.me = await window.LJMe;
    $('vlCargando').remove();
    if (!st.me?.ver_ventas) { $('vlSinPermiso').hidden = false; return; }
    st.sb = window.supabaseLaJamonera;
    $('vlApp').hidden = false;
    // Shoelace puede activar la pestaña antes de definir sl-tab-panel (carga diferida): el panel queda
    // oculto. Cuando están los tres componentes se alinean los paneles con la pestaña activa.
    Promise.all(['sl-tab-group', 'sl-tab', 'sl-tab-panel'].map((t) => customElements.whenDefined(t))).then(() => requestAnimationFrame(() => {
      document.querySelectorAll('sl-tab-group').forEach((g) => {
        const activa = g.querySelector(':scope > sl-tab[active]')?.panel || g.querySelector(':scope > sl-tab')?.panel;
        g.querySelectorAll(':scope > sl-tab').forEach((t) => { t.active = t.panel === activa; });
        g.querySelectorAll(':scope > sl-tab-panel').forEach((p) => { p.active = p.name === activa; });
      });
    }));
    try { await cargarConfig(); } catch (e) { notify('error', 'No se pudo leer la configuración', textoError(e)); }
    pintarSalud();
    cablear();
    await Promise.all([cargarResumen(), cargarTabla()]);
    actualizarPendientes();
    cargarCatalogo().then(pintarKpis).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
