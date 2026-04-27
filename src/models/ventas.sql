-- =========================================================
-- TABLAS DE VENTAS / POS
-- =========================================================

CREATE TABLE IF NOT EXISTS ventas (
    id_venta SERIAL PRIMARY KEY,
    folio VARCHAR(50) UNIQUE NOT NULL,
    id_sucursal INT NOT NULL REFERENCES sucursales(id_sucursal),
    id_caja INT NOT NULL REFERENCES cajas(id_caja),
    id_sesion INT NOT NULL REFERENCES caja_sesiones(id_sesion),
    id_usuario INT NOT NULL REFERENCES usuarios(id_usuario),
    id_cliente INT,
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    descuento NUMERIC(12,2) DEFAULT 0,
    impuesto NUMERIC(12,2) DEFAULT 0,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,
    metodo_pago VARCHAR(50) NOT NULL DEFAULT 'EFECTIVO',
    monto_recibido NUMERIC(12,2) DEFAULT 0,
    cambio NUMERIC(12,2) DEFAULT 0,
    estado VARCHAR(20) DEFAULT 'COMPLETADA',
    fecha_venta TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS venta_detalle (
    id_detalle SERIAL PRIMARY KEY,
    id_venta INT NOT NULL REFERENCES ventas(id_venta) ON DELETE CASCADE,
    id_producto INT NOT NULL REFERENCES productos(id_producto),
    cantidad NUMERIC(12,2) NOT NULL,
    precio_unitario NUMERIC(12,2) NOT NULL,
    descuento NUMERIC(12,2) DEFAULT 0,
    subtotal NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ventas_sucursal ON ventas(id_sucursal);
CREATE INDEX IF NOT EXISTS idx_ventas_sesion ON ventas(id_sesion);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha_venta);
CREATE INDEX IF NOT EXISTS idx_venta_detalle_venta ON venta_detalle(id_venta);
CREATE INDEX IF NOT EXISTS idx_venta_detalle_producto ON venta_detalle(id_producto);