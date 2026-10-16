// Ventas del local (ventaslocal.html): comprobantes de InfoManager IM5 que la Edge Function `api`
// copia a Supabase (im5_comprobantes / im5_items). Lee con RLS (admin o permiso «Ver ventas»),
// arma KPIs/gráficos con el RPC ventas_resumen y muestra la salud de la sincronización
// (ventas_config.estado). La config (días, horas, intervalo, KPIs) se guarda con ventas_config_guardar;
// las credenciales de IM5 van a Vault por /ventas/credenciales (solo admin).
(function ventasLocalModule() {
  const $ = (id) => document.getElementById(id);
  const TZ = 'America/Argentina/Buenos_Aires';
  const POR_PAGINA = 50;
  const notify = (type, title, message) => window.laJamoneraNotify?.show({ type, title, message });
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtPesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const fmtPesos2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtNum = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
  const fmtFechaHora = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fmtHora = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
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
    mail_invalido: 'Algún mail no es válido.'
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
  const KPIS = [
    { key: 'total', titulo: 'Total vendido', icono: 'fa-sack-dollar' },
    { key: 'comprobantes', titulo: 'Comprobantes', icono: 'fa-receipt' },
    { key: 'ticket', titulo: 'Ticket promedio', icono: 'fa-basket-shopping' },
    { key: 'producto', titulo: 'Producto estrella ($)', icono: 'fa-star' },
    { key: 'productoCant', titulo: 'Más vendido (cantidad)', icono: 'fa-weight-hanging' },
    { key: 'medios', titulo: 'Medio de cobro principal', icono: 'fa-credit-card' },
    { key: 'nc', titulo: 'Notas de crédito', icono: 'fa-rotate-left' },
    { key: 'cajas', titulo: 'Caja que más vendió', icono: 'fa-cash-register' },
    { key: 'hora', titulo: 'Hora pico', icono: 'fa-clock' },
    { key: 'letras', titulo: 'Factura A / B', icono: 'fa-file-invoice' }
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
    return `<article class="vl-kpi ${r ? '' : 'is-cargando'}"><div class="vl-kpi-tit"><i class="fa-solid ${def.icono}"></i>${esc(def.titulo)}</div>
      <div class="vl-kpi-valor ${chico ? 'is-chico' : ''}">${valor}</div><div class="vl-kpi-sub">${sub}</div></article>`;
  }
  const kpisActivos = () => (Array.isArray(st.cfg.kpis) && st.cfg.kpis.length ? st.cfg.kpis : KPIS.map((k) => k.key)).filter((k) => KPI_POR_KEY[k]);
  function pintarKpis() {
    $('vlKpis').innerHTML = kpisActivos().map((k) => kpiHtml(k, st.resumen, st.comparar ? st.resumenComp : null)).join('');
  }

  // ---------- Gráficos ----------
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
  function chart(id) {
    const el = $(id);
    if (!window.echarts || !el) return null;
    if (!st.charts[id]) st.charts[id] = window.echarts.init(el, null, { renderer: 'canvas' });
    return st.charts[id];
  }
  function baseOpts() {
    const texto = css('--lj-muted'); const borde = css('--lj-border');
    return {
      textStyle: { fontFamily: 'Inter, sans-serif', color: texto },
      grid: { left: 8, right: 12, top: 24, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis', backgroundColor: css('--lj-surface'), borderColor: borde, textStyle: { color: css('--lj-text') } },
      xAxis: { axisLine: { lineStyle: { color: borde } }, axisLabel: { color: texto }, splitLine: { show: false } },
      yAxis: { axisLabel: { color: texto, formatter: (v) => (Math.abs(v) >= 1e6 ? `${fmtNum.format(v / 1e6)} M` : Math.abs(v) >= 1e3 ? `${fmtNum.format(v / 1e3)} k` : v) }, splitLine: { lineStyle: { color: borde } } }
    };
  }
  function vacio(id, texto = 'Sin ventas en este período') {
    const c = st.charts[id]; if (c) { c.dispose(); delete st.charts[id]; }
    $(id).innerHTML = `<div class="vl-vacio">${esc(texto)}</div>`;
  }
  function pintarGraficos() {
    const r = st.resumen; const c = st.comparar ? st.resumenComp : null;
    const acento = css('--lj-accent'); const suave = css('--lj-border-strong');
    if (!r) return;

    // Por día: barras del período; la comparación como línea, día por día.
    if (!(r.por_dia || []).length) vacio('vlGDia');
    else {
      if ($('vlGDia').querySelector('.vl-vacio')) $('vlGDia').innerHTML = '';
      const dias = []; for (let d = st.rango.desde; d <= st.rango.hasta; d = sumarDias(d, 1)) dias.push(d);
      const porDia = Object.fromEntries((r.por_dia || []).map((x) => [x.fecha, Number(x.total)]));
      const series = [{ name: 'Período', type: 'bar', data: dias.map((d) => porDia[d] || 0), itemStyle: { color: acento, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 34 }];
      if (c && (c.por_dia || []).length) {
        const cr = rangoComparar(st.rango, st.clave);
        const cd = Object.fromEntries((c.por_dia || []).map((x) => [x.fecha, Number(x.total)]));
        series.push({ name: 'Comparación', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: dias.map((_, i) => cd[sumarDias(cr.desde, i)] || 0), lineStyle: { color: suave, type: 'dashed' }, itemStyle: { color: suave } });
      }
      const o = baseOpts();
      chart('vlGDia')?.setOption({ ...o, tooltip: { ...o.tooltip, valueFormatter: pesos }, xAxis: { ...o.xAxis, type: 'category', data: dias.map(fechaCorta) }, yAxis: { ...o.yAxis, type: 'value' }, series }, true);
    }

    // Por hora
    if (!(r.por_hora || []).length) vacio('vlGHora', 'Sin horas registradas');
    else {
      if ($('vlGHora').querySelector('.vl-vacio')) $('vlGHora').innerHTML = '';
      const horas = r.por_hora.map((x) => x.hora); const min = Math.min(...horas); const max = Math.max(...horas);
      const lista = []; for (let h = min; h <= max; h++) lista.push(h);
      const por = Object.fromEntries(r.por_hora.map((x) => [x.hora, Number(x.total)]));
      const o = baseOpts();
      chart('vlGHora')?.setOption({ ...o, tooltip: { ...o.tooltip, valueFormatter: pesos }, xAxis: { ...o.xAxis, type: 'category', data: lista.map((h) => `${h} h`) }, yAxis: { ...o.yAxis, type: 'value' },
        series: [{ type: 'bar', data: lista.map((h) => por[h] || 0), itemStyle: { color: acento, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 26 }] }, true);
    }

    // Medios de cobro
    const medios = (r.por_medio || []).filter((m) => Number(m.total) > 0);
    if (!medios.length) vacio('vlGMedios');
    else {
      if ($('vlGMedios').querySelector('.vl-vacio')) $('vlGMedios').innerHTML = '';
      const paleta = [acento, css('--lj-success'), css('--lj-warning'), css('--lj-danger'), css('--lj-muted'), css('--lj-brand')];
      chart('vlGMedios')?.setOption({
        textStyle: { fontFamily: 'Inter, sans-serif', color: css('--lj-muted') },
        tooltip: { trigger: 'item', valueFormatter: pesos, backgroundColor: css('--lj-surface'), borderColor: css('--lj-border'), textStyle: { color: css('--lj-text') } },
        legend: { bottom: 0, textStyle: { color: css('--lj-muted') }, type: 'scroll' },
        color: paleta,
        series: [{ type: 'pie', radius: ['48%', '72%'], center: ['50%', '44%'], avoidLabelOverlap: true, label: { show: false },
          itemStyle: { borderColor: css('--lj-surface'), borderWidth: 2 }, data: medios.map((m) => ({ name: m.medio, value: Number(m.total) })) }]
      }, true);
    }

    // Top productos
    const top = (st.topModo === 'cantidad' ? r.top_cantidad : r.top_importe) || [];
    if (!top.length) vacio('vlGTop', r.sin_items ? 'Todavía se están bajando los productos de estas ventas' : 'Sin productos en este período');
    else {
      if ($('vlGTop').querySelector('.vl-vacio')) $('vlGTop').innerHTML = '';
      const filas = [...top].reverse();
      const campo = st.topModo === 'cantidad' ? 'cantidad' : 'importe';
      const o = baseOpts();
      chart('vlGTop')?.setOption({ ...o,
        tooltip: { ...o.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => { const p = filas[ps[0].dataIndex]; return `<b>${esc(p.desc || p.cod)}</b><br>${pesos(p.importe)} · ${fmtNum.format(p.cantidad)} ${esc(p.unidad || '')}`; } },
        grid: { ...o.grid, left: 8 },
        xAxis: { ...o.yAxis, type: 'value' },
        yAxis: { type: 'category', data: filas.map((p) => { const t = String(p.desc || p.cod || ''); return t.length > 28 ? `${t.slice(0, 27)}…` : t; }), axisLabel: { color: css('--lj-text') }, axisLine: { lineStyle: { color: css('--lj-border') } } },
        series: [{ type: 'bar', data: filas.map((p) => Number(p[campo])), itemStyle: { color: acento, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 18,
          label: { show: true, position: 'right', color: css('--lj-muted'), formatter: (x) => (campo === 'importe' ? pesos(x.value) : fmtNum.format(x.value)) } }]
      }, true);
    }
  }
  window.addEventListener('resize', () => Object.values(st.charts).forEach((c) => c.resize()));

  // ---------- Datos ----------
  async function resumen(desde, hasta) {
    const { data, error } = await st.sb.rpc('ventas_resumen', { p_desde: desde, p_hasta: hasta, p_empresa: st.empresa });
    if (error) throw error;
    return data;
  }
  async function cargarResumen() {
    st.resumen = null; st.resumenComp = null; pintarKpis();
    const comp = rangoComparar(st.rango, st.clave);
    $('vlComparando').textContent = st.comparar ? `Comparando con ${comp.texto} (${fechaCorta(comp.desde)}${comp.desde !== comp.hasta ? ` al ${fechaCorta(comp.hasta)}` : ''}).` : '';
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
      <td>${esc(cuando)}<span class="vl-dim">Empresa ${r.empresa}</span></td>
      <td><span class="vl-chip ${chip}">${r.tipo}${r.letra ? ` ${esc(r.letra)}` : ''}</span><span class="vl-comp">${esc(String(r.punto_venta || 0).padStart(4, '0'))}-${esc(String(r.numero || 0).padStart(8, '0'))}</span>${r.anulada ? '<span class="vl-dim">Anulada</span>' : ''}</td>
      <td>${esc(r.cliente || '—')}${r.observaciones ? '<i class="fa-solid fa-comment-dots vl-obs-ico" title="Tiene observaciones"></i>' : ''}</td>
      <td>${esc(r.usuario || '—')}${r.vendedor ? `<span class="vl-dim">${esc(r.vendedor)}</span>` : ''}</td>
      <td>${esc(r.condicion_venta || '—')}</td>
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
    $('vlTablaCuenta').textContent = st.total ? `· ${fmtNum.format(st.total)}` : '';
    const hasta = Math.min(desde + POR_PAGINA, st.total);
    $('vlPagInfo').textContent = st.total ? `${desde + 1}–${hasta} de ${fmtNum.format(st.total)}` : '';
    $('vlPagAnt').disabled = st.pagina === 0;
    $('vlPagSig').disabled = hasta >= st.total;
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
    const { data, error } = await st.sb.from('im5_items').select('cod_articulo,descripcion,cantidad,unidad,precio_con_iva,importe,iva_por')
      .eq('empresa', Number(tr.dataset.emp)).eq('comprobante_id', Number(tr.dataset.id)).order('orden');
    const items = data || [];
    const tablaItems = error ? `<p class="vl-ayuda">${esc(textoError(error))}</p>`
      : !items.length ? `<p class="vl-ayuda">${r.items_ok ? 'Sin productos.' : 'Los productos de este comprobante se bajan en la próxima actualización.'}</p>`
      : `<table class="vl-items"><thead><tr><th>Código</th><th>Producto</th><th class="vl-num">Cantidad</th><th class="vl-num vl-ocultar-movil">Precio</th><th class="vl-num">Importe</th></tr></thead><tbody>
        ${items.map((i) => `<tr><td>${esc(i.cod_articulo || '')}</td><td>${esc(i.descripcion || '')}</td><td class="vl-num">${fmtNum.format(i.cantidad)} ${esc(i.unidad || '')}</td><td class="vl-num vl-ocultar-movil">${pesos2(i.precio_con_iva)}</td><td class="vl-num">${pesos2(i.importe)}</td></tr>`).join('')}
        </tbody></table>`;
    det.querySelector('.vl-detalle-in').innerHTML = `
      ${r.observaciones ? `<div class="vl-detalle-obs"><b>Observaciones:</b> ${esc(r.observaciones)}</div>` : ''}
      ${tablaItems}
      <div class="vl-detalle-meta">
        <span>${esc(nombreComp(r))}</span>
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
    const corridas = (e.corridas || []).slice(0, 15).map((c) => `<li><span class="${c.ok ? 'ok' : 'mal'}"><i class="fa-solid ${c.ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i></span>
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
      <h3 class="vl-ayuda" style="font-weight:700">Últimas corridas</h3>
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
    document.querySelectorAll('[data-rango]').forEach((b) => { b.variant = b.dataset.rango === clave ? 'primary' : 'default'; });
    $('vlRangoTexto').textContent = clave === 'custom' ? `${fechaCorta(rango.desde)} – ${fechaCorta(rango.hasta)}` : 'Elegir…';
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
    let oscuro = document.documentElement.classList.contains('sl-theme-dark');
    new MutationObserver(() => {
      const ahora = document.documentElement.classList.contains('sl-theme-dark');
      if (ahora === oscuro) return;
      oscuro = ahora;
      Object.values(st.charts).forEach((c) => c.dispose()); st.charts = {}; pintarGraficos();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  async function iniciar() {
    await window.laJamoneraReady;
    st.me = await window.LJMe;
    if (!st.me?.ver_ventas) { $('vlSinPermiso').hidden = false; return; }
    st.sb = window.supabaseLaJamonera;
    $('vlApp').hidden = false;
    try { await cargarConfig(); } catch (e) { notify('error', 'No se pudo leer la configuración', textoError(e)); }
    pintarSalud();
    cablear();
    await Promise.all([cargarResumen(), cargarTabla()]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
