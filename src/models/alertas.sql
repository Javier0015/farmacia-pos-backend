CREATE TABLE alertas (
    id_alerta SERIAL PRIMARY KEY,
    titulo VARCHAR(150) NOT NULL,
    mensaje TEXT NOT NULL,
    prioridad VARCHAR(20) DEFAULT 'NORMAL',
    destino_rol VARCHAR(50),
    id_sucursal INTEGER,
    id_usuario_creador INTEGER NOT NULL,
    activa BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE alertas_lecturas (
    id_lectura SERIAL PRIMARY KEY,
    id_alerta INTEGER NOT NULL REFERENCES alertas(id_alerta),
    id_usuario INTEGER NOT NULL,
    fecha_lectura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(id_alerta, id_usuario)
);