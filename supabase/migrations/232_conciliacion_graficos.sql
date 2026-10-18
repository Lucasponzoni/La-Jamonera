-- 232 · Datos para los gráficos de conciliación (Ventas del local → Gráficos). Mismo permiso de lectura que
-- conciliacion_mp (security invoker: RLS «Ver ventas»). p_empresa null = todas.
create or replace function public.conciliacion_mp_graficos(p_desde date, p_hasta date, p_empresa smallint default null)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with base as (
    select * from conciliacion_mp
    where fecha between p_desde and p_hasta and (p_empresa is null or empresa is null or empresa = p_empresa)
  ),
  im5 as (select * from base where clave like 'im5:%'),
  medio_n as (
    select *, case when medio ilike '%QR%' then 'QR en Point' when medio ilike '%Point%' then 'Point'
      when medio ilike 'MERCADO PAGO 1' then 'MERCADO PAGO 1' when medio ilike 'MERCADO PAGO 2' then 'MERCADO PAGO 2' else coalesce(medio, 'Otro') end as m
    from im5
  )
  select jsonb_build_object(
    'por_dia', coalesce((select jsonb_agg(d order by d->>'fecha') from (
      select jsonb_build_object('fecha', fecha,
        'en_im5', count(*) filter (where grabado_im5_at is not null or im5_conciliado),
        'por_grabar', count(*) filter (where estado = 'conciliado' and grabado_im5_at is null and not coalesce(im5_conciliado, false)),
        'a_liberar', count(*) filter (where estado = 'pendiente_liberacion' and grabado_im5_at is null and not coalesce(im5_conciliado, false)),
        'revisar', count(*) filter (where estado = 'revisar' and resuelto_at is null and grabado_im5_at is null and not coalesce(im5_conciliado, false)),
        'diferencia', count(*) filter (where estado in ('dif_importe', 'devuelto') and resuelto_at is null and grabado_im5_at is null and not coalesce(im5_conciliado, false)),
        'faltantes', count(*) filter (where estado in ('falta_en_mp', 'falta_en_im5') and resuelto_at is null and grabado_im5_at is null and not coalesce(im5_conciliado, false)),
        'resueltos', count(*) filter (where resuelto_at is not null),
        'cobrado', coalesce(sum(importe) filter (where clave like 'im5:%' and importe > 0), 0),
        'neto', coalesce(sum(mp_neto) filter (where clave like 'im5:%' and mp_pago_id is not null and importe > 0), 0),
        'comision', coalesce(sum(mp_comision) filter (where clave like 'im5:%' and mp_pago_id is not null and importe > 0), 0)) d
      from base group by fecha) x), '[]'::jsonb),
    'por_medio', coalesce((select jsonb_agg(jsonb_build_object('medio', m, 'cobros', n, 'cobrado', cobrado, 'comision', comision, 'cobrado_mp', cobrado_mp, 'dias_lib', dias_lib) order by cobrado desc) from (
      select m, count(*) n, coalesce(sum(importe) filter (where importe > 0), 0) cobrado,
        coalesce(sum(mp_comision) filter (where mp_pago_id is not null and importe > 0), 0) comision,
        coalesce(sum(mp_monto) filter (where mp_pago_id is not null and importe > 0), 0) cobrado_mp,
        round(avg(extract(epoch from (mp_liberacion_at - mp_aprobado_at)) / 86400) filter (where mp_liberacion_at is not null and mp_aprobado_at is not null and importe > 0)::numeric, 1) dias_lib
      from medio_n group by m) y), '[]'::jsonb),
    -- Liberaciones: lo que todavía no liberó MP, de cualquier fecha de cobro, próximos 30 días.
    'liberaciones', coalesce((select jsonb_agg(jsonb_build_object('fecha', f, 'neto', neto, 'n', n) order by f) from (
      select (mp_liberacion_at at time zone 'America/Argentina/Buenos_Aires')::date f, sum(mp_neto) neto, count(*) n
      from conciliacion_mp
      where mp_liberacion_at > now() and mp_liberacion_at < now() + interval '31 days' and mp_estado = 'approved'
        and (p_empresa is null or empresa is null or empresa = p_empresa)
      group by 1) z), '[]'::jsonb),
    -- Cupones mal tipeados por caja (usuario de IM5 del comprobante).
    'errores_caja', coalesce((select jsonb_agg(jsonb_build_object('usuario', usuario, 'n', n, 'ejemplo', ejemplo) order by n desc) from (
      select coalesce(c.usuario, 'Sin caja') usuario, count(*) n, min(b.comprobante) ejemplo
      from base b
      left join im5_pagos p on p.empresa = b.empresa and p.id = b.im5_pago_id
      left join lateral (select comprobante_id from im5_comprobante_recibos r where r.empresa = p.empresa and r.recibo_id = p.recibo_id limit 1) r on true
      left join im5_comprobantes c on c.empresa = b.empresa and c.id = r.comprobante_id
      where b.motivo_match = 'cupon_mal'
      group by 1) e), '[]'::jsonb),
    'errores_total', (select count(*) from base where motivo_match = 'cupon_mal')
  )
$$;
revoke all on function public.conciliacion_mp_graficos(date, date, smallint) from public, anon;
grant execute on function public.conciliacion_mp_graficos(date, date, smallint) to authenticated;
