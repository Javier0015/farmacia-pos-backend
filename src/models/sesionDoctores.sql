CREATE TABLE IF NOT EXISTS doctores_perfiles (
    id_doctor SERIAL PRIMARY KEY,

    id_usuario INTEGER NOT NULL UNIQUE REFERENCES usuarios(id_usuario),

    nombre_completo VARCHAR(180),
    cedula_profesional VARCHAR(80),
    especialidad VARCHAR(120),
    telefono VARCHAR(30),
    correo VARCHAR(120),
    direccion_consultorio TEXT,

    perfil_completo BOOLEAN DEFAULT false,
    activo BOOLEAN DEFAULT true,

    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctores_recetas (
    id_receta SERIAL PRIMARY KEY,

    id_doctor INTEGER NOT NULL REFERENCES doctores_perfiles(id_doctor),
    id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario),

    titulo VARCHAR(150),
    descripcion TEXT,

    archivo_nombre VARCHAR(255) NOT NULL,
    archivo_ruta TEXT NOT NULL,
    archivo_tipo VARCHAR(100),
    archivo_tamano INTEGER,

    puntos_generados NUMERIC(10,2) DEFAULT 1,

    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctores_puntos_movimientos (
    id_movimiento SERIAL PRIMARY KEY,

    id_doctor INTEGER NOT NULL REFERENCES doctores_perfiles(id_doctor),
    id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario),
    id_receta INTEGER REFERENCES doctores_recetas(id_receta),

    tipo_movimiento VARCHAR(30) NOT NULL,
    puntos NUMERIC(10,2) NOT NULL,

    descripcion TEXT,

    fecha_movimiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE doctores_perfiles
ADD COLUMN IF NOT EXISTS puntos_actuales NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS puntos_acumulados NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS puntos_canjeados NUMERIC(10,2) DEFAULT 0;