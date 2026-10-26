-- Conciliación: un pago de MP sin venta en IM5 (falta_en_im5) no es un error. Sólo es diferencia lo que tiene una
-- venta real en IM5 y no cierra con MP. Los pagos sin venta se cuentan aparte (sin_venta) y, si después aparece la
-- venta, el cruce los concilia solo.
create or replace function public.conciliacion_mp_resumen(p_desde date, p_hasta date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'cobrado_im5', coalesce(sum(importe) filter (where clave like 'im5:%' and importe > 0), 0),
    'cobros', count(*) filter (where clave like 'im5:%' and importe > 0),
    'acreditado_mp', coalesce(sum(mp_neto) filter (where estado = 'conciliado'), 0),
    'comisiones', coalesce(sum(mp_comision) filter (where mp_pago_id is not null and clave like 'im5:%'), 0),
    'pendiente_liberar', coalesce(sum(mp_neto) filter (where estado = 'pendiente_liberacion'), 0),
    'diferencias', count(*) filter (where estado in ('dif_importe', 'falta_en_mp', 'revisar') and resuelto_at is null),
    'sin_venta', count(*) filter (where estado = 'falta_en_im5' and resuelto_at is null),
    'resueltos', count(*) filter (where resuelto_at is not null),
    'listos_grabar', count(*) filter (where estado = 'conciliado' and grabado_im5_at is null and coalesce(im5_conciliado, false) = false),
    'grabados', count(*) filter (where grabado_im5_at is not null or im5_conciliado),
    'por_estado', coalesce((select jsonb_object_agg(estado, n) from (select estado, count(*) n from conciliacion_mp where fecha between p_desde and p_hasta group by estado) e), '{}'::jsonb),
    'actualizado', max(actualizado_at)
  )
  from conciliacion_mp where fecha between p_desde and p_hasta
$$;
