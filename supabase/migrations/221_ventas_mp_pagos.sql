-- 221 · Pagos de Mercado Pago consultados por la API (solo lectura) para los cobros de IM5 que traen
-- id de pago externo (Point / QR). Caché: se consulta una vez y se reconsulta solo si estaba pendiente.
-- El token vive en Vault ('mp_credenciales'); se importa del otro sistema y NO se renueva acá.

create table if not exists public.im5_mp_pagos (
  id_pago text primary key,
  estado text,                     -- approved, refunded, pending…
  estado_detalle text,
  metodo text,                     -- debvisa, master, account_money…
  tipo text,                       -- debit_card, credit_card, account_money…
  monto numeric(16, 2),
  neto numeric(16, 2),             -- transaction_details.net_received_amount
  comision numeric(16, 2),         -- suma de fee_details
  ultimos4 text,
  cuotas int,
  aprobado_at timestamptz,
  acreditacion_at timestamptz,     -- money_release_date
  origen text,                     -- POINT, QR…
  raw jsonb,
  consultado_at timestamptz not null default now()
);

alter table public.im5_mp_pagos enable row level security;
drop policy if exists im5_mp_pagos_leer on public.im5_mp_pagos;
create policy im5_mp_pagos_leer on public.im5_mp_pagos for select to authenticated using ((select private.puede_ver_ventas()));
revoke all on public.im5_mp_pagos from anon;
grant select on public.im5_mp_pagos to authenticated;
