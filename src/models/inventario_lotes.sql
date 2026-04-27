-- =========================================================
-- TABLA DE LOTES Y CADUCIDADES
-- SISTEMA: Farmacia POS
-- =========================================================

CREATE TABLE IF NOT EXISTS inventario_lotes (
    id_lote SERIAL PRIMARY KEY,
    id_sucursal INT NOT NULL REFERENCES sucursales(id_sucursal) ON DELETE CASCADE,
    id_producto INT NOT NULL REFERENCES productos(id_producto) ON DELETE CASCADE,
    lote VARCHAR(100) NOT NULL,
    fecha_caducidad DATE,
    stock_actual NUMERIC(12,2) NOT NULL DEFAULT 0,
    precio_compra NUMERIC(12,2) DEFAULT 0,
    activo BOOLEAN DEFAULT TRUE,
    fecha_entrada TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id_sucursal, id_producto, lote, fecha_caducidad)
);

CREATE INDEX IF NOT EXISTS idx_inventario_lotes_sucursal 
ON inventario_lotes(id_sucursal);

CREATE INDEX IF NOT EXISTS idx_inventario_lotes_producto 
ON inventario_lotes(id_producto);

CREATE INDEX IF NOT EXISTS idx_inventario_lotes_caducidad 
ON inventario_lotes(fecha_caducidad);

CREATE INDEX IF NOT EXISTS idx_inventario_lotes_busqueda 
ON inventario_lotes(id_sucursal, id_producto, lote);