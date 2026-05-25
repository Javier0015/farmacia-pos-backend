CREATE TABLE IF NOT EXISTS recetas_shaddai (
    id_receta SERIAL PRIMARY KEY,

    id_doctor INTEGER,
    id_paciente_expediente INTEGER,

    nombre_paciente VARCHAR(150) NOT NULL,
    telefono_paciente VARCHAR(20),
    edad_paciente INTEGER,
    sexo_paciente VARCHAR(30),

    diagnostico TEXT,
    observaciones TEXT,

    estatus VARCHAR(40) DEFAULT 'PENDIENTE_CAJERO',

    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    activo BOOLEAN DEFAULT true,

    CONSTRAINT fk_receta_doctor_shaddai
        FOREIGN KEY (id_doctor)
        REFERENCES usuarios(id_usuario),

    CONSTRAINT fk_receta_expediente_shaddai
        FOREIGN KEY (id_paciente_expediente)
        REFERENCES expedientes_clinicos(id_expediente)
);



CREATE TABLE IF NOT EXISTS recetas_shaddai_detalle (
    id_detalle SERIAL PRIMARY KEY,

    id_receta INTEGER NOT NULL,

    id_producto INTEGER,
    id_sucursal INTEGER,

    nombre_producto VARCHAR(200) NOT NULL,
    codigo_barras VARCHAR(100),
    sucursal_nombre VARCHAR(150),

    lote VARCHAR(100),
    fecha_caducidad DATE,

    cantidad INTEGER NOT NULL DEFAULT 1,
    stock_disponible INTEGER DEFAULT 0,

    dosis TEXT,
    frecuencia TEXT,
    duracion TEXT,
    indicaciones TEXT,

    precio_unitario NUMERIC(12, 2) DEFAULT 0,

    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_receta_shaddai_detalle
        FOREIGN KEY (id_receta)
        REFERENCES recetas_shaddai(id_receta)
        ON DELETE CASCADE
);