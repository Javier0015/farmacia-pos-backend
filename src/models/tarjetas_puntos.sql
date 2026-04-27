-- =========================================================
-- TARJETAS DE PUNTOS
-- SISTEMA: Farmacia POS
-- =========================================================

CREATE TABLE IF NOT EXISTS tarjetas_puntos (
    id_tarjeta SERIAL PRIMARY KEY,

    codigo_barras VARCHAR(100) UNIQUE NOT NULL,

    nombre_cliente VARCHAR(150) NOT NULL,
    telefono VARCHAR(30),
    correo VARCHAR(150),

    puntos_actuales NUMERIC(12,2) NOT NULL DEFAULT 0,
    puntos_acumulados NUMERIC(12,2) NOT NULL DEFAULT 0,
    puntos_canjeados NUMERIC(12,2) NOT NULL DEFAULT 0,

    activo BOOLEAN DEFAULT TRUE,

    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tarjetas_puntos_movimientos (
    id_movimiento SERIAL PRIMARY KEY,

    id_tarjeta INT NOT NULL REFERENCES tarjetas_puntos(id_tarjeta),
    id_venta INT REFERENCES ventas(id_venta),
    id_usuario INT REFERENCES usuarios(id_usuario),

    tipo_movimiento VARCHAR(30) NOT NULL,
    puntos NUMERIC(12,2) NOT NULL,

    puntos_anteriores NUMERIC(12,2) NOT NULL DEFAULT 0,
    puntos_nuevos NUMERIC(12,2) NOT NULL DEFAULT 0,

    descripcion TEXT,

    fecha_movimiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tarjetas_puntos_codigo
ON tarjetas_puntos(codigo_barras);

CREATE INDEX IF NOT EXISTS idx_tarjetas_puntos_cliente
ON tarjetas_puntos(nombre_cliente);

CREATE INDEX IF NOT EXISTS idx_tarjetas_puntos_activo
ON tarjetas_puntos(activo);

CREATE INDEX IF NOT EXISTS idx_tarjetas_puntos_mov_tarjeta
ON tarjetas_puntos_movimientos(id_tarjeta);

CREATE INDEX IF NOT EXISTS idx_tarjetas_puntos_mov_venta
ON tarjetas_puntos_movimientos(id_venta);

-- =========================================================
-- AJUSTES POR SI LA TABLA YA EXISTE
-- =========================================================

ALTER TABLE tarjetas_puntos
ADD COLUMN IF NOT EXISTS telefono VARCHAR(30);

ALTER TABLE tarjetas_puntos
ADD COLUMN IF NOT EXISTS correo VARCHAR(150);

ALTER TABLE tarjetas_puntos
ADD COLUMN IF NOT EXISTS puntos_actuales NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE tarjetas_puntos
ADD COLUMN IF NOT EXISTS puntos_acumulados NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE tarjetas_puntos
ADD COLUMN IF NOT EXISTS puntos_canjeados NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE tarjetas_puntos
ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;

ALTER TABLE tarjetas_puntos
ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE tarjetas_puntos
ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP;