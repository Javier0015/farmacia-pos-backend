ALTER TABLE doctores_recetas
ADD COLUMN IF NOT EXISTS estatus VARCHAR(30) DEFAULT 'PENDIENTE',
ADD COLUMN IF NOT EXISTS id_usuario_validador INTEGER REFERENCES usuarios(id_usuario),
ADD COLUMN IF NOT EXISTS fecha_validacion TIMESTAMP,
ADD COLUMN IF NOT EXISTS observaciones_validacion TEXT;

ALTER TABLE doctores_recetas
ALTER COLUMN puntos_generados SET DEFAULT 0;

ALTER TABLE configuracion_puntos
ADD COLUMN IF NOT EXISTS puntos_doctor_receta NUMERIC(10,2) DEFAULT 1,
ADD COLUMN IF NOT EXISTS puntos_doctor_activo BOOLEAN DEFAULT true;