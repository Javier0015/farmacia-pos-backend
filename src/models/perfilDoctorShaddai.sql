CREATE TABLE IF NOT EXISTS doctores_shaddai_perfiles (
    id_perfil SERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL UNIQUE,

    nombre_completo VARCHAR(150) NOT NULL,
    cedula_profesional VARCHAR(50) NOT NULL,
    especialidad VARCHAR(120) NOT NULL,
    telefono VARCHAR(20),
    correo VARCHAR(120),
    direccion_consultorio TEXT,
    observaciones TEXT,

    perfil_completo BOOLEAN DEFAULT false,
    activo BOOLEAN DEFAULT true,

    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_doctor_shaddai_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuarios(id_usuario)
);