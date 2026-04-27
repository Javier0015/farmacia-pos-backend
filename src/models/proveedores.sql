-- =========================================================
-- TABLA DE PROVEEDORES
-- SISTEMA: Farmacia POS
-- =========================================================

CREATE TABLE IF NOT EXISTS proveedores (
    id_proveedor SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    rfc VARCHAR(20),
    telefono VARCHAR(20),
    correo VARCHAR(150),
    direccion TEXT,
    contacto VARCHAR(150),
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proveedores_nombre
ON proveedores(nombre);

CREATE INDEX IF NOT EXISTS idx_proveedores_rfc
ON proveedores(rfc);

CREATE INDEX IF NOT EXISTS idx_proveedores_activo
ON proveedores(activo);

ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP;