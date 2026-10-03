# 102_auto_egreso_index + 103_auto_egreso_raw (aplicadas el 03/10/2026)

- `public.auto_egreso_record(p_ing)` → `private.lj_inv_get(p_ing)` (registro con forma de Firebase); sólo `service_role`.
- `public.auto_egreso_index_set(p_ing, p_summary, p_version)` → `lj_raw_set('/inventario_index/items/<id>')` y
  `lj_raw_set('/_index_meta/inventario_index', {updatedAt, version})`; sólo `service_role`.
- `auto_egreso_aplicar` ahora también actualiza `inventario_lotes.raw` (availableQty/Base/Kg, lotStatus,
  autoEgresoState): el front lee el lote desde `raw`.
- La Edge Function guarda en `movimientos.datos` el objeto completo (como `lj_mov_ins`) y, tras cada
  ingrediente aplicado, recalcula el índice con `recalcRecordStock` + `summarizeInventoryRecordForIndex`
  (copia literal de la Cloud Function), limpiando null/vacíos como RTDB.
