-- 231 · Conciliación: un cobro cuyo comprobante se anuló en IM5 queda marcado «anulado en IM5» (antes se borraba).
-- Índice para traer rápido los pendientes (no grabados, no resueltos, no conciliados en IM5) de cualquier fecha.
alter table public.conciliacion_mp drop constraint if exists conciliacion_mp_estado_check;
alter table public.conciliacion_mp add constraint conciliacion_mp_estado_check
  check (estado in ('conciliado', 'pendiente_liberacion', 'dif_importe', 'falta_en_mp', 'falta_en_im5', 'devuelto', 'devolucion', 'revisar', 'anulado_im5'));
create index if not exists conciliacion_mp_pend_idx on public.conciliacion_mp (fecha)
  where grabado_im5_at is null and resuelto_at is null and coalesce(im5_conciliado, false) = false;
