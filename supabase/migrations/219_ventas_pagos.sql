-- 219 · Cobros de las ventas de IM5: con qué se pagó cada comprobante (efectivo, tarjeta, Mercado Pago…),
-- con cupón, n° de tarjeta, autorización, lote y el id de pago externo (Mercado Pago Point / QR).
-- En IM5 el cobro vive en el recibo (RC) que cancela la factura: im5_comprobante_recibos une la factura
-- con sus recibos e im5_pagos guarda cada renglón de cobro del recibo.

create table if not exists public.im5_comprobante_recibos (
  empresa smallint not null,
  comprobante_id bigint not null,
  recibo_id bigint not null,
  recibo_tipo text,
  recibo_punto_venta int,
  recibo_numero bigint,
  importe_pagado numeric(16, 2),
  primary key (empresa, comprobante_id, recibo_id),
  foreign key (empresa, comprobante_id) references public.im5_comprobantes (empresa, id) on delete cascade
);
create index if not exists im5_comprobante_recibos_recibo_idx on public.im5_comprobante_recibos (empresa, recibo_id);

create table if not exists public.im5_pagos (
  empresa smallint not null,
  id bigint not null,                -- id del renglón de cobro en IM5
  recibo_id bigint not null,
  cond_pago text,                    -- EF, TJ, CH, TR…
  medio text,                        -- nombre de la tarjeta o de la cuenta
  cuenta text,
  importe numeric(16, 2) not null default 0,
  cupon text,
  tarjeta_numero text,
  autorizacion text,
  lote text,
  cod_tarjeta int,
  cod_plan int,
  id_pago_externo text,              -- id de pago de Mercado Pago (Point / QR)
  estado_pago text,
  sistema_externo text,              -- MPPOINT…
  arancel numeric(16, 2),
  costo_financiero numeric(16, 2),
  costo_financiero_impuesto numeric(16, 2),
  raw jsonb,
  sync_at timestamptz not null default now(),
  primary key (empresa, id)
);
create index if not exists im5_pagos_recibo_idx on public.im5_pagos (empresa, recibo_id);
create index if not exists im5_pagos_externo_idx on public.im5_pagos (id_pago_externo) where id_pago_externo is not null;
create index if not exists im5_pagos_cupon_idx on public.im5_pagos (cupon) where cupon is not null;

alter table public.im5_comprobante_recibos enable row level security;
alter table public.im5_pagos enable row level security;
drop policy if exists im5_comprobante_recibos_leer on public.im5_comprobante_recibos;
create policy im5_comprobante_recibos_leer on public.im5_comprobante_recibos for select to authenticated using ((select private.puede_ver_ventas()));
drop policy if exists im5_pagos_leer on public.im5_pagos;
create policy im5_pagos_leer on public.im5_pagos for select to authenticated using ((select private.puede_ver_ventas()));
revoke all on public.im5_comprobante_recibos, public.im5_pagos from anon;
grant select on public.im5_comprobante_recibos, public.im5_pagos to authenticated;

-- Lo ya bajado no tiene cobros: se vuelve a pedir el detalle de todo (la sync lo hace de a tandas).
update public.im5_comprobantes set items_ok = false where items_ok;
