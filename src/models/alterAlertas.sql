-- =========================
-- ALERTAS
-- =========================

ALTER TABLE alertas
ADD CONSTRAINT fk_alertas_usuario
FOREIGN KEY (id_usuario_creador)
REFERENCES usuarios(id_usuario);

ALTER TABLE alertas
ADD CONSTRAINT fk_alertas_sucursal
FOREIGN KEY (id_sucursal)
REFERENCES sucursales(id_sucursal);


-- =========================
-- ALERTAS_LECTURAS
-- =========================

-- Primero elimina la FK actual creada automáticamente por:
-- id_alerta INTEGER NOT NULL REFERENCES alertas(id_alerta)
ALTER TABLE alertas_lecturas
DROP CONSTRAINT IF EXISTS alertas_lecturas_id_alerta_fkey;

-- La volvemos a crear con ON DELETE CASCADE
ALTER TABLE alertas_lecturas
ADD CONSTRAINT fk_alertas_lecturas_alerta
FOREIGN KEY (id_alerta)
REFERENCES alertas(id_alerta)
ON DELETE CASCADE;

ALTER TABLE alertas_lecturas
ADD CONSTRAINT fk_alertas_lecturas_usuario
FOREIGN KEY (id_usuario)
REFERENCES usuarios(id_usuario);