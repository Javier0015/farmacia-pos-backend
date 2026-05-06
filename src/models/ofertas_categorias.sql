CREATE TABLE IF NOT EXISTS ofertas_categorias (
    id_oferta SERIAL PRIMARY KEY,

    id_categoria INTEGER NOT NULL REFERENCES categorias(id_categoria),

    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,

    porcentaje_descuento NUMERIC(10,2) NOT NULL DEFAULT 0,

    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,

    activo BOOLEAN DEFAULT true,

    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP
);


ALTER TABLE ofertas_categorias
ADD CONSTRAINT chk_ofertas_porcentaje
CHECK (porcentaje_descuento >= 0 AND porcentaje_descuento <= 100);

ALTER TABLE ofertas_categorias
ADD CONSTRAINT chk_ofertas_fechas
CHECK (fecha_fin >= fecha_inicio);

ALTER TABLE ventas
ADD COLUMN IF NOT EXISTS subtotal_sin_descuento NUMERIC(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS descuento_total NUMERIC(12,2) DEFAULT 0;


ALTER TABLE venta_detalle
ADD COLUMN IF NOT EXISTS precio_original NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS porcentaje_descuento NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS descuento_unitario NUMERIC(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS id_oferta INTEGER REFERENCES ofertas_categorias(id_oferta);