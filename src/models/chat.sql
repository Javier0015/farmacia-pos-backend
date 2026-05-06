CREATE TABLE IF NOT EXISTS chat_mensajes (
    id_mensaje SERIAL PRIMARY KEY,
    id_usuario_emisor INTEGER NOT NULL REFERENCES usuarios(id_usuario),
    mensaje TEXT NOT NULL,
    tipo_destino VARCHAR(30) DEFAULT 'TODOS',
    destino_rol VARCHAR(50),
    id_sucursal INTEGER REFERENCES sucursales(id_sucursal),
    fecha_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS chat_lecturas (
    id_lectura SERIAL PRIMARY KEY,
    id_mensaje INTEGER NOT NULL REFERENCES chat_mensajes(id_mensaje) ON DELETE CASCADE,
    id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario),
    fecha_lectura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(id_mensaje, id_usuario)
);