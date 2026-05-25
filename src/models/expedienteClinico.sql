CREATE TABLE expedientes_clinicos (
    id_expediente SERIAL PRIMARY KEY,

    nombre_paciente VARCHAR(150) NOT NULL,
    telefono VARCHAR(20),
    sexo VARCHAR(20),
    fecha_nacimiento DATE,
    edad INTEGER,

    direccion TEXT,
    correo VARCHAR(120),

    enfermedades_condiciones TEXT,
    alergias TEXT,
    medicamentos_actuales TEXT,
    observaciones_generales TEXT,

    id_doctor INTEGER,
    id_sucursal INTEGER,

    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);