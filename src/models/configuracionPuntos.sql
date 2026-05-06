CREATE TABLE configuracion_puntos (
    id_configuracion SERIAL PRIMARY KEY,

    porcentaje_cliente NUMERIC(10,2) NOT NULL DEFAULT 1.00,
    porcentaje_cajero NUMERIC(10,2) NOT NULL DEFAULT 0.50,

    puntos_cliente_activo BOOLEAN DEFAULT true,
    puntos_cajero_activo BOOLEAN DEFAULT true,

    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    id_usuario_actualizacion INTEGER REFERENCES usuarios(id_usuario)
);

CREATE TABLE cajeros_puntos_movimientos (
    id_movimiento SERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario),
    id_venta INTEGER REFERENCES ventas(id_venta),

    tipo_movimiento VARCHAR(30) NOT NULL DEFAULT 'VENTA',
    puntos NUMERIC(10,2) NOT NULL DEFAULT 0,

    porcentaje_aplicado NUMERIC(10,2),
    monto_base NUMERIC(12,2),

    descripcion TEXT,
    fecha_movimiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);