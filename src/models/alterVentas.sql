ALTER TABLE ventas
ADD COLUMN IF NOT EXISTS id_tarjeta_puntos INT REFERENCES tarjetas_puntos(id_tarjeta);

ALTER TABLE ventas
ADD COLUMN IF NOT EXISTS puntos_ganados NUMERIC(12,2) NOT NULL DEFAULT 0;