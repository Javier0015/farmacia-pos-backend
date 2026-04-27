-- =========================================================
-- RELACIÓN DE MOVIMIENTOS CON LOTES
-- =========================================================

ALTER TABLE inventario_movimientos
ADD COLUMN IF NOT EXISTS id_lote INT REFERENCES inventario_lotes(id_lote);

CREATE INDEX IF NOT EXISTS idx_inventario_movimientos_lote
ON inventario_movimientos(id_lote);