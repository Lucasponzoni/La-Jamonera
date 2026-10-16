-- 218 · ventas_resumen: la misma cajera viene de IM5 con distintas mayúsculas ("BRENDA" / "brenda").
-- Se agrupa por upper(trim(usuario)) para que no cuente como dos cajas. Se aplica sobre la definición
-- viva con reemplazos vigilados (si el fragmento no aparece exactamente una vez, no se toca nada).
do $$
declare
  v_def text := pg_get_functiondef('public.ventas_resumen(date, date, int)'::regprocedure);
  v_viejo text := 'coalesce(nullif(usuario, ''''), ''Sin dato'')';
  v_nuevo text := 'coalesce(nullif(upper(trim(usuario)), ''''), ''Sin dato'')';
  v_n int := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
begin
  if v_n <> 2 then raise exception 'ventas_resumen: esperaba 2 apariciones, hay %', v_n; end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;
revoke all on function public.ventas_resumen(date, date, int) from public, anon;
grant execute on function public.ventas_resumen(date, date, int) to authenticated;
