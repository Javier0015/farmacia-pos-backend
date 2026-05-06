ALTER TABLE chat_mensajes
ADD COLUMN IF NOT EXISTS id_usuario_destino INTEGER;

ALTER TABLE chat_mensajes
DROP CONSTRAINT IF EXISTS fk_chat_usuario_destino;

ALTER TABLE chat_mensajes
ADD CONSTRAINT fk_chat_usuario_destino
FOREIGN KEY (id_usuario_destino)
REFERENCES usuarios(id_usuario);