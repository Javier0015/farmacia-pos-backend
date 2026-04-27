-- =========================================================
-- TABLAS DE COMPRAS / PROVEEDORES
-- SISTEMA: Farmacia POS
-- =========================================================

CREATE TABLE IF NOT EXISTS compras (
    id_compra SERIAL PRIMARY KEY,
    folio VARCHAR(50) UNIQUE NOT NULL,
    id_sucursal INT NOT NULL REFERENCES sucursales(id_sucursal),
    id_proveedor INT NOT NULL REFERENCES proveedores(id_proveedor),
    id_usuario INT NOT NULL REFERENCES usuarios(id_usuario),

    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    impuesto NUMERIC(12,2) NOT NULL DEFAULT 0,
    descuento NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,

    monto_pagado NUMERIC(12,2) NOT NULL DEFAULT 0,
    saldo NUMERIC(12,2) NOT NULL DEFAULT 0,

    metodo_pago VARCHAR(50) DEFAULT 'PENDIENTE',
    estado VARCHAR(30) DEFAULT 'PENDIENTE',

    id_sesion INT REFERENCES caja_sesiones(id_sesion),

    observaciones TEXT,
    fecha_compra TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compra_detalle (
    id_detalle SERIAL PRIMARY KEY,
    id_compra INT NOT NULL REFERENCES compras(id_compra) ON DELETE CASCADE,
    id_producto INT NOT NULL REFERENCES productos(id_producto),

    cantidad NUMERIC(12,2) NOT NULL,
    precio_compra NUMERIC(12,2) NOT NULL,
    descuento NUMERIC(12,2) NOT NULL DEFAULT 0,
    subtotal NUMERIC(12,2) NOT NULL,

    lote VARCHAR(100),
    fecha_caducidad DATE,
    observaciones TEXT
);

CREATE TABLE IF NOT EXISTS pagos_proveedor (
    id_pago SERIAL PRIMARY KEY,
    id_compra INT REFERENCES compras(id_compra),
    id_proveedor INT NOT NULL REFERENCES proveedores(id_proveedor),
    id_sucursal INT NOT NULL REFERENCES sucursales(id_sucursal),
    id_sesion INT REFERENCES caja_sesiones(id_sesion),
    id_usuario INT NOT NULL REFERENCES usuarios(id_usuario),

    monto NUMERIC(12,2) NOT NULL,
    metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO',
    referencia VARCHAR(100),
    observaciones TEXT,

    fecha_pago TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- AJUSTES PARA TABLAS EXISTENTES
-- Si las tablas ya existían, CREATE TABLE IF NOT EXISTS
-- no agrega columnas nuevas. Estos ALTER corrigen eso.
-- =========================================================

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS impuesto NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS descuento NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS monto_pagado NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS saldo NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(50) DEFAULT 'PENDIENTE';

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS estado VARCHAR(30) DEFAULT 'PENDIENTE';

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS id_sesion INT REFERENCES caja_sesiones(id_sesion);

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS observaciones TEXT;

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS fecha_compra TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE compras
ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE compra_detalle
ADD COLUMN IF NOT EXISTS cantidad NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE compra_detalle
ADD COLUMN IF NOT EXISTS precio_compra NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE compra_detalle
ADD COLUMN IF NOT EXISTS descuento NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE compra_detalle
ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE compra_detalle
ADD COLUMN IF NOT EXISTS lote VARCHAR(100);

ALTER TABLE compra_detalle
ADD COLUMN IF NOT EXISTS fecha_caducidad DATE;

ALTER TABLE compra_detalle
ADD COLUMN IF NOT EXISTS observaciones TEXT;

-- =========================================================
-- ÍNDICES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_compras_sucursal
ON compras(id_sucursal);

CREATE INDEX IF NOT EXISTS idx_compras_proveedor
ON compras(id_proveedor);

CREATE INDEX IF NOT EXISTS idx_compras_fecha
ON compras(fecha_compra);

CREATE INDEX IF NOT EXISTS idx_compra_detalle_compra
ON compra_detalle(id_compra);

CREATE INDEX IF NOT EXISTS idx_compra_detalle_producto
ON compra_detalle(id_producto);

CREATE INDEX IF NOT EXISTS idx_pagos_proveedor_compra
ON pagos_proveedor(id_compra);