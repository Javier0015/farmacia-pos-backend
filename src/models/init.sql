-- =========================================================
-- BASE DE DATOS: shaddai
-- SISTEMA: Farmacia POS Multi-sucursal
-- =========================================================

-- =========================
-- LIMPIEZA OPCIONAL
-- =========================
DROP TABLE IF EXISTS caja_movimientos CASCADE;
DROP TABLE IF EXISTS caja_sesiones CASCADE;
DROP TABLE IF EXISTS cajas CASCADE;
DROP TABLE IF EXISTS inventario_movimientos CASCADE;
DROP TABLE IF EXISTS inventario_sucursal CASCADE;
DROP TABLE IF EXISTS productos CASCADE;
DROP TABLE IF EXISTS categorias CASCADE;
DROP TABLE IF EXISTS usuario_sucursal CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS rol_permisos CASCADE;
DROP TABLE IF EXISTS permisos CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS sucursales CASCADE;

-- =========================
-- ROLES Y PERMISOS
-- =========================
CREATE TABLE roles (
    id_rol SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permisos (
    id_permiso SERIAL PRIMARY KEY,
    clave VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    modulo VARCHAR(100),
    activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE rol_permisos (
    id_rol INT NOT NULL REFERENCES roles(id_rol) ON DELETE CASCADE,
    id_permiso INT NOT NULL REFERENCES permisos(id_permiso) ON DELETE CASCADE,
    PRIMARY KEY (id_rol, id_permiso)
);

-- =========================
-- SUCURSALES
-- =========================
CREATE TABLE sucursales (
    id_sucursal SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    clave VARCHAR(50) UNIQUE NOT NULL,
    direccion TEXT,
    telefono VARCHAR(20),
    responsable VARCHAR(150),
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- USUARIOS
-- =========================
CREATE TABLE usuarios (
    id_usuario SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    usuario VARCHAR(80) NOT NULL UNIQUE,
    correo VARCHAR(150),
    password_hash TEXT NOT NULL,
    id_rol INT REFERENCES roles(id_rol),
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usuario_sucursal (
    id_usuario INT NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    id_sucursal INT NOT NULL REFERENCES sucursales(id_sucursal) ON DELETE CASCADE,
    PRIMARY KEY (id_usuario, id_sucursal)
);

-- =========================
-- CATEGORÍAS Y PRODUCTOS
-- =========================
CREATE TABLE categorias (
    id_categoria SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE productos (
    id_producto SERIAL PRIMARY KEY,
    codigo_barras VARCHAR(100) UNIQUE,
    nombre VARCHAR(200) NOT NULL,
    descripcion TEXT,
    id_categoria INT REFERENCES categorias(id_categoria),
    laboratorio VARCHAR(150),
    presentacion VARCHAR(150),
    requiere_receta BOOLEAN DEFAULT FALSE,
    es_controlado BOOLEAN DEFAULT FALSE,
    precio_compra NUMERIC(12,2) DEFAULT 0,
    precio_venta NUMERIC(12,2) NOT NULL DEFAULT 0,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- INVENTARIO POR SUCURSAL
-- =========================
CREATE TABLE inventario_sucursal (
    id_inventario SERIAL PRIMARY KEY,
    id_sucursal INT NOT NULL REFERENCES sucursales(id_sucursal) ON DELETE CASCADE,
    id_producto INT NOT NULL REFERENCES productos(id_producto) ON DELETE CASCADE,
    stock_actual NUMERIC(12,2) DEFAULT 0,
    stock_minimo NUMERIC(12,2) DEFAULT 0,
    ubicacion VARCHAR(100),
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id_sucursal, id_producto)
);

CREATE TABLE inventario_movimientos (
    id_movimiento SERIAL PRIMARY KEY,
    id_sucursal INT NOT NULL REFERENCES sucursales(id_sucursal),
    id_producto INT NOT NULL REFERENCES productos(id_producto),
    tipo_movimiento VARCHAR(50) NOT NULL,
    cantidad NUMERIC(12,2) NOT NULL,
    stock_anterior NUMERIC(12,2),
    stock_nuevo NUMERIC(12,2),
    referencia VARCHAR(100),
    observaciones TEXT,
    id_usuario INT REFERENCES usuarios(id_usuario),
    fecha_movimiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- CAJAS
-- =========================
CREATE TABLE cajas (
    id_caja SERIAL PRIMARY KEY,
    id_sucursal INT NOT NULL REFERENCES sucursales(id_sucursal) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE caja_sesiones (
    id_sesion SERIAL PRIMARY KEY,
    id_caja INT NOT NULL REFERENCES cajas(id_caja),
    id_sucursal INT NOT NULL REFERENCES sucursales(id_sucursal),
    id_usuario_apertura INT NOT NULL REFERENCES usuarios(id_usuario),
    id_usuario_cierre INT REFERENCES usuarios(id_usuario),
    monto_inicial NUMERIC(12,2) NOT NULL DEFAULT 0,
    monto_final_sistema NUMERIC(12,2) DEFAULT 0,
    monto_final_real NUMERIC(12,2) DEFAULT 0,
    diferencia NUMERIC(12,2) DEFAULT 0,
    estado VARCHAR(20) DEFAULT 'ABIERTA',
    fecha_apertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TIMESTAMP
);

CREATE TABLE caja_movimientos (
    id_movimiento SERIAL PRIMARY KEY,
    id_sesion INT NOT NULL REFERENCES caja_sesiones(id_sesion),
    id_sucursal INT NOT NULL REFERENCES sucursales(id_sucursal),
    tipo_movimiento VARCHAR(50) NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    monto NUMERIC(12,2) NOT NULL,
    metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO',
    referencia VARCHAR(100),
    observaciones TEXT,
    id_usuario INT NOT NULL REFERENCES usuarios(id_usuario),
    fecha_movimiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- DATOS INICIALES
-- =========================

INSERT INTO roles (nombre, descripcion) VALUES
('SUPER_ADMIN', 'Control total del sistema'),
('ADMIN_GENERAL', 'Administrador de varias sucursales'),
('ENCARGADO_SUCURSAL', 'Encargado de una sucursal'),
('CAJERO', 'Usuario que realiza ventas y cortes de caja'),
('ALMACENISTA', 'Usuario que gestiona inventario'),
('COMPRAS', 'Usuario que gestiona proveedores y compras');

INSERT INTO permisos (clave, descripcion, modulo) VALUES
('usuarios.ver', 'Ver usuarios', 'usuarios'),
('usuarios.crear', 'Crear usuarios', 'usuarios'),
('usuarios.editar', 'Editar usuarios', 'usuarios'),
('usuarios.eliminar', 'Eliminar usuarios', 'usuarios'),

('sucursales.ver', 'Ver sucursales', 'sucursales'),
('sucursales.crear', 'Crear sucursales', 'sucursales'),
('sucursales.editar', 'Editar sucursales', 'sucursales'),
('sucursales.eliminar', 'Eliminar sucursales', 'sucursales'),

('productos.ver', 'Ver productos', 'productos'),
('productos.crear', 'Crear productos', 'productos'),
('productos.editar', 'Editar productos', 'productos'),
('productos.eliminar', 'Eliminar productos', 'productos'),

('inventario.ver', 'Ver inventario', 'inventario'),
('inventario.ajustar', 'Ajustar inventario', 'inventario'),

('caja.abrir', 'Abrir caja', 'caja'),
('caja.movimientos', 'Registrar movimientos de caja', 'caja'),
('caja.cerrar', 'Cerrar caja', 'caja'),

('ventas.crear', 'Crear ventas', 'ventas'),
('ventas.cancelar', 'Cancelar ventas', 'ventas'),
('ventas.ver', 'Ver ventas', 'ventas'),

('reportes.ver', 'Ver reportes', 'reportes');

-- Dar todos los permisos al SUPER_ADMIN
INSERT INTO rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'SUPER_ADMIN';

-- Sucursal inicial
INSERT INTO sucursales (nombre, clave, direccion, telefono, responsable)
VALUES (
    'Farmacia Principal',
    'PRINCIPAL',
    'Dirección pendiente',
    '0000000000',
    'Administrador'
);

-- Categorías iniciales
INSERT INTO categorias (nombre, descripcion) VALUES
('Medicamentos', 'Medicamentos generales'),
('Antibióticos', 'Medicamentos antibióticos'),
('Analgésicos', 'Medicamentos para dolor'),
('Vitaminas', 'Suplementos y vitaminas'),
('Higiene personal', 'Productos de higiene personal'),
('Bebés', 'Productos para bebé'),
('Curación', 'Material de curación');

-- Caja inicial
INSERT INTO cajas (id_sucursal, nombre)
VALUES (1, 'Caja 1');

-- Usuario administrador inicial
-- Password temporal: admin123
-- Hash generado con bcryptjs
INSERT INTO usuarios (nombre, usuario, correo, password_hash, id_rol)
VALUES (
    'Administrador General',
    'admin',
    'admin@farmacia.local',
    '$2a$10$CqO5363Qt6NJc3zYl7HfQ.DUHzDsgoaWv3bIOp9KQIxxNKdQEAimO',
    1
);

INSERT INTO usuario_sucursal (id_usuario, id_sucursal)
VALUES (1, 1);