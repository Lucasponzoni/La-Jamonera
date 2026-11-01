-- 01/11/2026 · El POS sólo puede vender una producción desde que está envasada (jamones, salames y bondiolas se
-- estacionan). «fecha» pasa a ser la de envasado cuando la producción la tiene (si no, la de elaboración).
-- Aplicada como migración pos_produccion_disponible_desde_envasado.
create or replace function public.pos_produccion_disponible(p_recetas text[])
 returns table(receta_id text, produccion_id text, fecha date, vence date, disponible numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  select r, d.produccion_id, greatest(d.fecha, coalesce(p.fecha_envasado, d.fecha)), d.vence, d.disponible
  from unnest(p_recetas) r, private.produccion_disponible(r) d
  left join producciones p on p.id = d.produccion_id
$function$;
