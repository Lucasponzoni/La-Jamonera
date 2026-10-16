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
    sin_mail_avisos: 'No hay mails guardados para los avisos.'
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
    if (!b) return '<span class="vl-delta is-sube"><i class="fa-solid fa-arrow-up"></i> nuevo</span>';
    const p = ((a - b) / Math.abs(b)) * 100;
    if (Math.abs(p) < 0.5) return '<span class="vl-delta is-igual">= igual</span>';
    const sube = p > 0;
    const bien = invertir ? !sube : sube;
    return `<span class="vl-delta ${bien ? 'is-sube' : 'is-baja'}"><i class="fa-solid fa-arrow-${sube ? 'up' : 'down'}"></i> ${fmtNum.format(Math.abs(p))}%</span>`;
  }
  function kpiHtml(key, r, c) {
    const def = KPI_POR_KEY[key];
    if (!def) return '';
    let valor = '—'; let sub = ''; let chico = false;
    if (r) {
      if (key === 'total') { valor = pesos(r.neto); sub = `${delta(r.neto, c?.neto)} ${c ? `<span>antes ${pesos(c.neto)}</span>` : ''}`; }
      if (key === 'comprobantes') { valor = fmtNum.format(r.comprobantes); sub = delta(r.comprobantes, c?.comprobantes); }
      if (key === 'ticket') { valor = pesos2(r.ticket); sub = delta(r.ticket, c?.ticket); }
      if (key === 'producto') {
        const p = r.top_importe?.[0];
        chico = true; valor = p ? esc(p.desc || p.cod) : 'Sin datos';
        sub = p ? `${pesos(p.importe)} · ${fmtNum.format(p.cantidad)} ${esc(p.unidad || '')}` : (r.sin_items ? 'Faltan bajar productos' : '');
      }
      if (key === 'productoCant') {
        const p = r.top_cantidad?.[0];
        chico = true; valor = p ? esc(p.desc || p.cod) : 'Sin datos';
        sub = p ? `${fmtNum.format(p.cantidad)} ${esc(p.unidad || '')} · ${pesos(p.importe)}` : '';
      }
      if (key === 'medios') {
        const m = r.por_medio?.[0]; const tot = (r.por_medio || []).reduce((s, x) => s + Number(x.total || 0), 0);
        chico = true; valor = m ? esc(m.medio) : 'Sin datos';
        sub = m && tot ? `${fmtNum.format((Number(m.total) / tot) * 100)}% · ${pesos(m.total)}` : '';
      }
      if (key === 'nc') { valor = pesos(r.nc_total); sub = `${r.nc_cant} nota${r.nc_cant === 1 ? '' : 's'} ${delta(r.nc_total, c?.nc_total, { invertir: true })}`; }
      if (key === 'cajas') {
        const u = r.por_usuario?.[0];
        chico = true; valor = u ? esc(u.usuario) : 'Sin datos';
        sub = u ? `${pesos(u.total)} · ${u.cant} comp.` : '';
      }
      if (key === 'hora') {
        const h = [...(r.por_hora || [])].sort((a, b) => Number(b.total) - Number(a.total))[0];
        valor = h ? `${String(h.hora).padStart(2, '0')}–${String(h.hora + 1).padStart(2, '0')} h` : '—';
        sub = h ? `${pesos(h.total)} · ${h.cant} comp.` : '';
      }
      if (key === 'letras') {
        const a = (r.por_letra || []).find((x) => x.letra === 'A'); const b = (r.por_letra || []).find((x) => x.letra === 'B');
        chico = true; valor = `A ${pesos(a?.total || 0)} · B ${pesos(b?.total || 0)}`;
        const tot = Number(a?.total || 0) + Number(b?.total || 0);
        sub = tot ? `${fmtNum.format((Number(a?.total || 0) / tot) * 100)}% a empresas` : '';
      }
    }
    return `<article class="vl-kpi ${r ? '' : 'is-cargando'}" style="--k:${PALETA()[def.color]}"><div class="vl-kpi-tit"><span class="vl-kpi-ico"><i class="fa-solid ${def.icono}"></i></span>${esc(def.titulo)}</div>
      <div class="vl-kpi-valor ${chico ? 'is-chico' : ''}">${valor}</div><div class="vl-kpi-sub">${sub}</div></article>`;
  }
  const kpisActivos = () => (Array.isArray(st.cfg.kpis) && st.cfg.kpis.length ? st.cfg.kpis : KPIS.map((k) => k.key)).filter((k) => KPI_POR_KEY[k]);
  function pintarKpis() {
    $('vlKpis').innerHTML = kpisActivos().map((k) => kpiHtml(k, st.resumen, st.comparar ? st.resumenComp : null)).join('');
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
      const [r, c] = await Promise.all([resumen(st.rango.desde, st.rango.hasta), st.comparar ? resumen(comp.desde, comp.hasta) : Promise.resolve(null)]);
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
  const nombreComp = (r) => `${r.tipo === 'FA' ? 'Factura' : r.tipo === 'NC' ? 'N. crédito' : 'N. débito'} ${r.letra || ''} ${String(r.punto_venta || 0).padStart(4, '0')}-${String(r.numero || 0).padStart(8, '0')}`;
  function filaHtml(r) {
    const chip = r.tipo === 'NC' ? 'is-nc' : r.tipo === 'ND' ? 'is-nd' : 'is-fa';
    const cuando = r.fecha_hora ? fmtFechaHora.format(new Date(r.fecha_hora)) : fechaCorta(r.fecha);
    return `<tr class="vl-fila ${r.anulada ? 'is-anulada' : ''}" data-emp="${r.empresa}" data-id="${r.id}" tabindex="0">
      <td><i class="fa-solid fa-chevron-right vl-exp"></i></td>
      <td class="vl-fecha">${esc(cuando)}<span class="vl-dim vl-ocultar-movil">Empresa ${r.empresa}</span></td>
      <td><span class="vl-chip ${chip}">${r.tipo}${r.letra ? ` ${esc(r.letra)}` : ''}</span><span class="vl-comp">${esc(String(r.punto_venta || 0).padStart(4, '0'))}-${esc(String(r.numero || 0).padStart(8, '0'))}</span>${r.anulada ? '<span class="vl-dim">Anulada</span>' : ''}</td>
      <td>${esc(r.cliente || '—')}${r.observaciones ? '<i class="fa-solid fa-comment-dots vl-obs-ico" title="Tiene observaciones"></i>' : ''}</td>
      <td class="vl-ocultar-movil">${esc(r.usuario || '—')}${r.vendedor ? `<span class="vl-dim">${esc(r.vendedor)}</span>` : ''}</td>
      <td class="vl-ocultar-movil">${esc(r.condicion_venta || '—')}</td>
      <td class="vl-num ${r.tipo === 'NC' ? 'vl-total-nc' : ''}"><b>${r.tipo === 'NC' ? '−' : ''}${pesos2(r.total)}</b></td></tr>`;
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
    const hasta = Math.min(desde + POR_PAGINA, st.total);
    $('vlPagInfo').textContent = st.total ? `${desde + 1}–${hasta} de ${fmtNum.format(st.total)}` : '';
    $('vlPagAnt').disabled = st.pagina === 0;
    $('vlPagSig').disabled = hasta >= st.total;
  }
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
  const COND_PAGO = { EF: 'Efectivo', TJ: 'Tarjeta', CH: 'Cheque', TR: 'Transferencia', DB: 'Débito', CC: 'Cuenta corriente' };
  function htmlCobros(c, r) {
    if (c.error) return `<p class="vl-ayuda">${esc(textoError(c.error))}</p>`;
    if (!c.pagos.length) return `<p class="vl-ayuda">${r.items_ok ? 'Sin cobros registrados (cuenta corriente o pendiente).' : 'Los cobros de este comprobante se bajan en la próxima actualización.'}</p>`;
    const dato = (t, v) => (v ? `<span>${t} <b>${esc(v)}</b></span>` : '');
    return `<div class="vl-cobros"><p class="vl-detalle-tit"><i class="fa-solid fa-credit-card"></i> Cobro</p>
      <div class="vl-items-wrap"><table class="vl-items"><thead><tr><th>Medio</th><th>Datos del pago</th><th class="vl-num">Importe</th></tr></thead><tbody>
      ${c.pagos.map((p) => `<tr><td>${esc(p.medio || COND_PAGO[p.cond_pago] || p.cond_pago || '—')}</td>
        <td class="vl-cobro-datos">${[dato('ID pago MP', p.id_pago_externo), dato('Cupón', p.cupon), dato('Tarjeta', p.tarjeta_numero), dato('Autorización', p.autorizacion), dato('Lote', p.lote),
          Number(p.arancel) ? dato('Arancel', pesos2(p.arancel)) : '', Number(p.costo_financiero) ? dato('Costo financiero', pesos2(p.costo_financiero)) : ''].join('') || '—'}</td>
        <td class="vl-num">${pesos2(p.importe)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
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
      st.sb.from('im5_items').select('cod_articulo,descripcion,cantidad,unidad,precio_con_iva,importe,iva_por')
        .eq('empresa', emp).eq('comprobante_id', id).order('orden'),
      leerCobros(emp, id)
    ]);
    const items = data || [];
    const tablaItems = error ? `<p class="vl-ayuda">${esc(textoError(error))}</p>`
      : !items.length ? `<p class="vl-ayuda">${r.items_ok ? 'Sin productos.' : 'Los productos de este comprobante se bajan en la próxima actualización.'}</p>`
      : `<div><p class="vl-detalle-tit"><i class="fa-solid fa-box-open"></i> Productos</p><div class="vl-items-wrap"><table class="vl-items"><thead><tr><th class="vl-ocultar-movil">Código</th><th>Producto</th><th class="vl-num">Cantidad</th><th class="vl-num vl-ocultar-movil">Precio</th><th class="vl-num">Importe</th></tr></thead><tbody>
        ${items.map((i) => `<tr><td class="vl-ocultar-movil">${esc(i.cod_articulo || '')}</td><td>${esc(i.descripcion || '')}</td><td class="vl-num">${fmtNum.format(i.cantidad)} ${esc(i.unidad || '')}</td><td class="vl-num vl-ocultar-movil">${pesos2(i.precio_con_iva)}</td><td class="vl-num">${pesos2(i.importe)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    det.querySelector('.vl-detalle-in').innerHTML = `
      ${r.observaciones ? `<div class="vl-detalle-obs"><b>Observaciones:</b> ${esc(r.observaciones)}</div>` : ''}
      ${tablaItems}
      ${htmlCobros(cobros, r)}
      <div class="vl-detalle-meta">
        <span>${esc(nombreComp(r))}</span>
        ${r.usuario ? `<span>Caja <b>${esc(r.usuario)}</b></span>` : ''}
        ${r.condicion_venta ? `<span>Condición <b>${esc(r.condicion_venta)}</b></span>` : ''}
        ${r.cod_cliente ? `<span>Cliente <b>${esc(r.cod_cliente)}</b></span>` : ''}
        ${r.vendedor ? `<span>Vendedor <b>${esc(r.vendedor)}</b></span>` : ''}
        ${r.cae ? `<span>CAE <b>${esc(r.cae)}</b></span>` : ''}
      </div>`;
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
    const pendiente = !e.historialTerminado ? 'trayendo el historial' : e.pendientesItems ? `faltan productos de ${fmtNum.format(e.pendientesItems)} comprobantes` : '';
    const atrasada = st.cfg.activa !== false && e.proxima && Date.now() - Date.parse(e.proxima) > 40 * 60000;
    return {
      estado: atrasada ? 'atrasada' : 'ok',
      titulo: atrasada ? 'Atrasada' : 'Sincronizada',
      detalle: [`Actualizado ${haceCuanto(e.ultimaOk || e.ultimaCorrida)}`, st.cfg.activa === false ? 'automática apagada' : e.proxima ? `próxima ${enCuanto(e.proxima)}` : '', pendiente].filter(Boolean).join(' · ')
    };
  }
  function pintarSalud() {
    const s = saludActual();
    const btn = $('vlSalud');
    btn.dataset.estado = s.estado;
    $('vlSaludTitulo').textContent = s.titulo;
    $('vlSaludDetalle').textContent = s.detalle || ' ';
    btn.title = s.detalle || s.titulo;
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
    const corridas = (e.corridas || []).slice(0, 15).map((c) => `<li class="${c.ok ? '' : 'is-mal'}"><span class="${c.ok ? 'ok' : 'mal'}"><i class="fa-solid ${c.ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i></span>
      <span>${esc(fmtFechaHora.format(new Date(c.fin)))} · ${c.modo === 'manual' ? 'manual' : 'automática'}</span>
      <span>${c.ok ? `${c.nuevos} nuevos · ${c.items} con productos` : esc(c.error || 'error')} · ${Math.round((c.ms || 0) / 1000)} s</span></li>`).join('');
    const pend = Number(e.pendientesItems || 0);
    $('vlSaludCuerpo').innerHTML = `
      ${e.ok === false && e.error ? `<div class="vl-salud-error"><b>Último error:</b> ${esc(textoError(e.error))}${e.erroresSeguidos > 1 ? ` · ${e.erroresSeguidos} veces seguidas` : ''}</div>` : ''}
      <div class="vl-salud-grid">
        <div class="vl-salud-dato"><small>Última actualización buena</small><b>${e.ultimaOk ? esc(fmtFechaHora.format(new Date(e.ultimaOk))) : 'Nunca'}</b><span class="vl-dim">${esc(haceCuanto(e.ultimaOk))}</span></div>
        <div class="vl-salud-dato"><small>Próxima automática</small><b>${st.cfg.activa === false ? 'Apagada' : e.proxima ? esc(fmtFechaHora.format(new Date(e.proxima))) : '—'}</b><span class="vl-dim">${esc(resumenHorario(st.cfg))}</span></div>
        ${historial}
        <div class="vl-salud-dato"><small>Productos por bajar</small><b>${pend ? `${fmtNum.format(pend)} comprobantes` : 'Al día'}</b><span class="vl-dim">${pend ? 'se completan en las próximas corridas' : '&nbsp;'}</span></div>
      </div>
      <p class="vl-salud-sub">Últimas corridas</p>
      <ul class="vl-corridas">${corridas || '<li><span>Todavía no hay corridas.</span></li>'}</ul>`;
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
    const esAdmin = Boolean(st.me?.admin);
    document.querySelector('[data-solo-admin]').hidden = !esAdmin;
    if (esAdmin) cargarEstadoCred();
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
    $('vlTablaBody').addEventListener('click', (e) => { const tr = e.target.closest('tr.vl-fila'); if (tr) toggleDetalle(tr); });
    $('vlTablaBody').addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const tr = e.target.closest('tr.vl-fila'); if (tr) { e.preventDefault(); toggleDetalle(tr); } });
    $('vlActualizar').addEventListener('click', actualizarAhora);
    $('vlExcel').addEventListener('click', exportarExcel);
    $('vlSalud').addEventListener('click', () => { pintarSaludDetalle(); $('vlSaludDialog').show(); });
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
