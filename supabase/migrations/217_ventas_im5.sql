-- 217 · Ventas del local (InfoManager IM5) → ventaslocal.html
-- Espejo de los comprobantes de venta de IM5 (las dos empresas), sus ítems, la config de la
-- sincronización (días, horas, intervalo, KPIs) y su estado de salud. Lo escribe SOLO la Edge
-- Function `api` con service_role; el navegador lee con RLS y guarda la config por RPC.
-- Leer = admin o el permiso nuevo profiles.ver_ventas.

alter table public.profiles add column if not exists ver_ventas boolean not null default false;

create or replace function private.puede_ver_ventas()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and activo and (role = 'admin' or ver_ventas))
$$;
revoke all on function private.puede_ver_ventas() from public, anon;
grant execute on function private.puede_ver_ventas() to authenticated, service_role;

-- ---------- Comprobantes ----------
create table if not exists public.im5_comprobantes (
  empresa smallint not null,
  id bigint not null,
  tipo text not null,                  -- FA / NC / ND
  letra text,                          -- A / B / C
  punto_venta int,
  numero bigint,
  fecha date not null,
  fecha_hora timestamptz,              -- usuario_fecha + usuario_hora (hora AR)
  cod_cliente text,
  cliente text,
  cliente_iva text,
  total numeric(14,2) not null default 0,
  importe_pago numeric(14,2),
  vendedor text,
  usuario text,                        -- cajera / usuario de IM5 que lo cargó
  condicion_venta text,                -- Efectivo, Tarjeta Credito, Cuenta Corriente…
  condicion_venta_tipo text,
  observaciones text,
  anulada boolean not null default false,
  cae text,
  items_ok boolean not null default false,  -- ya se bajó el detalle
  raw jsonb,
  sync_at timestamptz not null default now(),
  primary key (empresa, id)
);
create index if not exists im5_comprobantes_fecha_idx on public.im5_comprobantes (fecha desc, empresa);
create index if not exists im5_comprobantes_sin_items_idx on public.im5_comprobantes (fecha desc) where not items_ok;

create table if not exists public.im5_items (
  empresa smallint not null,
  comprobante_id bigint not null,
  item_id bigint not null,
  orden int not null default 0,
  cod_articulo text,
  descripcion text,
  cantidad numeric(14,4) not null default 0,
  unidad text,
  precio_con_iva numeric(14,4),
  importe numeric(14,2) not null default 0,
  iva_por numeric(6,2),
  raw jsonb,
  primary key (empresa, comprobante_id, item_id),
  foreign key (empresa, comprobante_id) references public.im5_comprobantes (empresa, id) on delete cascade
);
create index if not exists im5_items_articulo_idx on public.im5_items (cod_articulo);

-- ---------- Config + salud (una fila) ----------
create table if not exists public.ventas_config (
  id int primary key default 1 check (id = 1),
  config jsonb not null default '{}'::jsonb,
  estado jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.ventas_config (id, config) values (1, jsonb_build_object(
  'activa', true,
  'dias', jsonb_build_array(1,2,3,4,5),       -- 0 domingo … 6 sábado
  'desde', 8, 'hasta', 19,                    -- horas AR, inclusive
  'cadaMin', 120,
  'empresas', jsonb_build_array(1,2),
  'tipos', jsonb_build_array('FA','NC','ND'),
  'mailAvisos', '',
  'kpis', jsonb_build_array('total','comprobantes','ticket','producto','medios','nc','cajas','hora','letras')
)) on conflict (id) do nothing;

alter table public.im5_comprobantes enable row level security;
alter table public.im5_items enable row level security;
alter table public.ventas_config enable row level security;

drop policy if exists im5_comprobantes_leer on public.im5_comprobantes;
create policy im5_comprobantes_leer on public.im5_comprobantes for select to authenticated using ((select private.puede_ver_ventas()));
drop policy if exists im5_items_leer on public.im5_items;
create policy im5_items_leer on public.im5_items for select to authenticated using ((select private.puede_ver_ventas()));
drop policy if exists ventas_config_leer on public.ventas_config;
create policy ventas_config_leer on public.ventas_config for select to authenticated using ((select private.puede_ver_ventas()));

revoke all on public.im5_comprobantes, public.im5_items, public.ventas_config from anon;
grant select on public.im5_comprobantes, public.im5_items, public.ventas_config to authenticated;

-- ---------- Guardar config (desde la página) ----------
-- Valida y normaliza; las credenciales NO pasan por acá (van a Vault por la Edge Function, solo admin).
create or replace function public.ventas_config_guardar(p_config jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_old jsonb; v_new jsonb; v_dias jsonb; v_emp jsonb; v_kpis jsonb; v_tipos jsonb;
  v_desde int; v_hasta int; v_cada int; v_mail text;
begin
  if not private.puede_ver_ventas() then raise exception 'sin_permiso' using errcode = '42501'; end if;
  select config into v_old from ventas_config where id = 1;
  v_desde := coalesce((p_config->>'desde')::int, (v_old->>'desde')::int, 8);
  v_hasta := coalesce((p_config->>'hasta')::int, (v_old->>'hasta')::int, 19);
  v_cada  := coalesce((p_config->>'cadaMin')::int, (v_old->>'cadaMin')::int, 120);
  if v_desde not between 0 and 23 or v_hasta not between 0 and 23 or v_desde > v_hasta then raise exception 'horario_invalido'; end if;
  if v_cada not between 10 and 1440 then raise exception 'intervalo_invalido'; end if;
  v_dias := coalesce(p_config->'dias', v_old->'dias');
  if jsonb_typeof(v_dias) <> 'array' or exists (select 1 from jsonb_array_elements(v_dias) e where jsonb_typeof(e) <> 'number' or e::int not between 0 and 6) then raise exception 'dias_invalidos'; end if;
  v_emp := coalesce(p_config->'empresas', v_old->'empresas');
  if jsonb_typeof(v_emp) <> 'array' or jsonb_array_length(v_emp) = 0 or exists (select 1 from jsonb_array_elements(v_emp) e where jsonb_typeof(e) <> 'number' or e::int not between 1 and 99) then raise exception 'empresas_invalidas'; end if;
  v_tipos := coalesce(p_config->'tipos', v_old->'tipos');
  if jsonb_typeof(v_tipos) <> 'array' or exists (select 1 from jsonb_array_elements_text(v_tipos) e where e not in ('FA','NC','ND')) then raise exception 'tipos_invalidos'; end if;
  v_kpis := coalesce(p_config->'kpis', v_old->'kpis');
  if jsonb_typeof(v_kpis) <> 'array' then raise exception 'kpis_invalidos'; end if;
  v_mail := coalesce(p_config->>'mailAvisos', v_old->>'mailAvisos', '');
  if v_mail <> '' and v_mail !~ '^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+(\s*,\s*[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+)*$' then raise exception 'mail_invalido'; end if;
  v_new := v_old || jsonb_build_object(
    'activa', coalesce((p_config->>'activa')::boolean, (v_old->>'activa')::boolean, true),
    'dias', v_dias, 'desde', v_desde, 'hasta', v_hasta, 'cadaMin', v_cada,
    'empresas', v_emp, 'tipos', v_tipos, 'kpis', v_kpis, 'mailAvisos', v_mail);
  update ventas_config set config = v_new, updated_at = now(), updated_by = auth.uid() where id = 1;
  return v_new;
end $$;
revoke all on function public.ventas_config_guardar(jsonb) from public, anon;
grant execute on function public.ventas_config_guardar(jsonb) to authenticated;

-- ---------- Resumen para los KPIs y gráficos ----------
-- Neto = FA + ND − NC (anuladas fuera). p_empresa null = todas.
create or replace function public.ventas_resumen(p_desde date, p_hasta date, p_empresa int default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v jsonb;
begin
  if not private.puede_ver_ventas() then raise exception 'sin_permiso' using errcode = '42501'; end if;
  with c as (
    select *, case when tipo = 'NC' then -1 else 1 end as signo
    from im5_comprobantes
    where fecha between p_desde and p_hasta and not anulada and (p_empresa is null or empresa = p_empresa)
  ), it as (
    select i.*, c.signo from im5_items i join c on c.empresa = i.empresa and c.id = i.comprobante_id
  )
  select jsonb_build_object(
    'neto', coalesce((select sum(total * signo) from c), 0),
    'facturado', coalesce((select sum(total) from c where tipo <> 'NC'), 0),
    'nc_total', coalesce((select sum(total) from c where tipo = 'NC'), 0),
    'nc_cant', (select count(*) from c where tipo = 'NC'),
    'comprobantes', (select count(*) from c where tipo <> 'NC'),
    'ticket', coalesce((select avg(total) from c where tipo <> 'NC'), 0),
    'sin_items', (select count(*) from c where not items_ok),
    'por_medio', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
      select jsonb_build_object('medio', coalesce(nullif(condicion_venta, ''), 'Sin dato'), 'total', sum(total * signo), 'cant', count(*)) x
      from c group by coalesce(nullif(condicion_venta, ''), 'Sin dato')) s), '[]'::jsonb),
    'por_usuario', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
      select jsonb_build_object('usuario', coalesce(nullif(usuario, ''), 'Sin dato'), 'total', sum(total * signo), 'cant', count(*)) x
      from c group by coalesce(nullif(usuario, ''), 'Sin dato')) s), '[]'::jsonb),
    'por_empresa', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('empresa', empresa, 'total', sum(total * signo), 'cant', count(*)) x from c group by empresa) s), '[]'::jsonb),
    'por_letra', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('letra', coalesce(letra, '-'), 'total', sum(total * signo), 'cant', count(*)) x from c group by coalesce(letra, '-')) s), '[]'::jsonb),
    'por_hora', coalesce((select jsonb_agg(x order by (x->>'hora')::int) from (
      select jsonb_build_object('hora', extract(hour from fecha_hora at time zone 'America/Argentina/Buenos_Aires')::int, 'total', sum(total * signo), 'cant', count(*)) x
      from c where fecha_hora is not null group by extract(hour from fecha_hora at time zone 'America/Argentina/Buenos_Aires')) s), '[]'::jsonb),
    'por_dia', coalesce((select jsonb_agg(x order by x->>'fecha') from (
      select jsonb_build_object('fecha', fecha, 'total', sum(total * signo), 'cant', count(*) filter (where tipo <> 'NC')) x from c group by fecha) s), '[]'::jsonb),
    'top_importe', coalesce((select jsonb_agg(x order by (x->>'importe')::numeric desc) from (
      select jsonb_build_object('cod', cod_articulo, 'desc', max(descripcion), 'unidad', max(unidad), 'cantidad', sum(cantidad * signo), 'importe', sum(importe * signo)) x
      from it group by cod_articulo order by sum(importe * signo) desc limit 10) s), '[]'::jsonb),
    'top_cantidad', coalesce((select jsonb_agg(x order by (x->>'cantidad')::numeric desc) from (
      select jsonb_build_object('cod', cod_articulo, 'desc', max(descripcion), 'unidad', max(unidad), 'cantidad', sum(cantidad * signo), 'importe', sum(importe * signo)) x
      from it group by cod_articulo order by sum(cantidad * signo) desc limit 10) s), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.ventas_resumen(date, date, int) from public, anon;
grant execute on function public.ventas_resumen(date, date, int) to authenticated;

-- ---------- Cron ----------
-- Cada 10 min: la Edge Function decide si toca (días/horas/intervalo de la config) y avanza el
-- historial de a pedazos. Mismo patrón que auto-egresos (anon_key + cron_secret de Vault).
create or replace function private.ventas_im5_cron()
returns bigint language sql security definer set search_path = public, extensions, vault as $$
  select net.http_post(
    url := 'https://bpbsqhdxbfhdticbnnnm.supabase.co/functions/v1/api/ventas/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'anon_key' limit 1), ''),
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1), '')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000)
$$;
revoke all on function private.ventas_im5_cron() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'ventas-im5';
select cron.schedule('ventas-im5', '*/10 * * * *', $$select private.ventas_im5_cron()$$);
