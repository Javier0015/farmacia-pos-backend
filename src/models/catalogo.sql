CREATE TABLE IF NOT EXISTS public.catalogo_productos (
    id_catalogo SERIAL PRIMARY KEY,

    id_producto INTEGER NOT NULL,
    
    titulo_catalogo VARCHAR(150),
    descripcion TEXT,
    advertencias TEXT,
    indicaciones TEXT,
    presentacion VARCHAR(150),

    imagen_url TEXT,

    activo BOOLEAN DEFAULT TRUE,
    destacado BOOLEAN DEFAULT FALSE,

    orden INTEGER DEFAULT 0,

    fecha_creacion TIMESTAMP DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP
);