-- =========================================================
-- USUARIOS, ROLES Y SUCURSALES
-- SISTEMA: Farmacia POS
-- =========================================================

CREATE TABLE IF NOT EXISTS roles (
    id_rol SERIAL PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL,
    descripcion TEXT,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usuarios (
    id_usuario SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    usuario VARCHAR(80) UNIQUE NOT NULL,
    correo VARCHAR(150),
    password_hash TEXT NOT NULL,
    id_rol INT NOT NULL REFERENCES roles(id_rol),
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usuario_sucursales (
    id_usuario_sucursal SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    id_sucursal INT NOT NULL REFERENCES sucursales(id_sucursal) ON DELETE CASCADE,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id_usuario, id_sucursal)
);

-- =========================================================
-- AJUSTES PARA TABLAS EXISTENTES
-- =========================================================

ALTER TABLE roles
ADD COLUMN IF NOT EXISTS descripcion TEXT;

ALTER TABLE roles
ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;

ALTER TABLE roles
ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE usuarios
ADD COLUMN IF NOT EXISTS correo VARCHAR(150);

ALTER TABLE usuarios
ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE usuario_sucursales
ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;

-- =========================================================
-- ROLES BASE
-- =========================================================

INSERT INTO roles (nombre, descripcion, activo)
VALUES
('SUPER_ADMIN', 'Acceso total al sistema', true),
('ADMIN_SUCURSAL', 'Administrador de una o más sucursales', true),
('CAJERO', 'Acceso a punto de venta, caja y ventas', true),
('ALMACEN', 'Acceso a productos, inventario, lotes y caducidades', true),
('COMPRAS', 'Acceso a proveedores, compras e inventario', true),
('LECTURA', 'Acceso solo de consulta', true)
ON CONFLICT (nombre) DO NOTHING;

-- =========================================================
-- ÍNDICES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_usuarios_usuario
ON usuarios(usuario);

CREATE INDEX IF NOT EXISTS idx_usuarios_rol
ON usuarios(id_rol);

CREATE INDEX IF NOT EXISTS idx_usuarios_activo
ON usuarios(activo);

CREATE INDEX IF NOT EXISTS idx_usuario_sucursales_usuario
ON usuario_sucursales(id_usuario);

CREATE INDEX IF NOT EXISTS idx_usuario_sucursales_sucursal
ON usuario_sucursales(id_sucursal);