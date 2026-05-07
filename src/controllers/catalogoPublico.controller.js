import { pool } from '../config/db.js';

export const listarCatalogoPublico = async (req, res) => {
  try {
    const { q, categoria } = req.query;

    const params = [];
    let whereExtra = '';

    if (q) {
      params.push(`%${q}%`);
      whereExtra += `
        AND (
          p.nombre ILIKE $${params.length}
          OR p.descripcion ILIKE $${params.length}
          OR p.laboratorio ILIKE $${params.length}
          OR p.presentacion ILIKE $${params.length}
          OR cp.titulo_catalogo ILIKE $${params.length}
        )
      `;
    }

    if (categoria) {
      params.push(categoria);
      whereExtra += ` AND p.id_categoria = $${params.length} `;
    }

    const query = `
      SELECT
        cp.id_catalogo,
        cp.id_producto,
        cp.titulo_catalogo,
        cp.descripcion_catalogo,
        cp.imagen_url,
        cp.destacado,
        cp.mostrar_stock,
        cp.orden,

        p.codigo_barras,
        p.nombre AS nombre_producto,
        p.descripcion AS descripcion_producto,
        p.laboratorio,
        p.presentacion,
        p.requiere_receta,
        p.es_controlado,
        p.precio_venta,
        p.id_categoria,

        c.nombre AS nombre_categoria,

        COALESCE(inv.stock_total, 0) AS stock_total,

        oc.id_oferta,
        oc.nombre AS nombre_oferta,
        oc.descripcion AS descripcion_oferta,
        oc.porcentaje_descuento,

        CASE 
          WHEN oc.id_oferta IS NOT NULL THEN true
          ELSE false
        END AS tiene_oferta,

        CASE
          WHEN oc.id_oferta IS NOT NULL THEN
            ROUND(
              p.precio_venta - (p.precio_venta * oc.porcentaje_descuento / 100),
              2
            )
          ELSE p.precio_venta
        END AS precio_final

      FROM public.catalogo_productos cp

      INNER JOIN public.productos p
        ON p.id_producto = cp.id_producto

      LEFT JOIN public.categorias c
        ON c.id_categoria = p.id_categoria

      LEFT JOIN LATERAL (
        SELECT 
          oc2.id_oferta,
          oc2.nombre,
          oc2.descripcion,
          oc2.porcentaje_descuento
        FROM public.ofertas_categorias oc2
        WHERE oc2.id_categoria = p.id_categoria
          AND oc2.activo = true
          AND CURRENT_DATE BETWEEN oc2.fecha_inicio AND oc2.fecha_fin
        ORDER BY oc2.fecha_creacion DESC
        LIMIT 1
      ) oc ON true

      LEFT JOIN (
        SELECT
          id_producto,
          SUM(stock_actual) AS stock_total
        FROM public.inventario_sucursal
        GROUP BY id_producto
      ) inv
        ON inv.id_producto = p.id_producto

      WHERE cp.activo = true
        AND p.activo = true
        ${whereExtra}

      ORDER BY 
        cp.destacado DESC,
        cp.orden ASC,
        p.nombre ASC;
    `;

    const { rows } = await pool.query(query, params);

    res.json({
      ok: true,
      catalogo: rows,
    });
  } catch (error) {
    console.error('Error al listar catálogo público:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al listar catálogo público',
      error: error.message,
    });
  }
};

export const obtenerDetalleProductoPublico = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT
        cp.id_catalogo,
        cp.id_producto,
        cp.titulo_catalogo,
        cp.descripcion_catalogo,
        cp.advertencias,
        cp.indicaciones,
        cp.modo_uso,
        cp.imagen_url,
        cp.destacado,
        cp.mostrar_stock,

        p.codigo_barras,
        p.nombre AS nombre_producto,
        p.descripcion AS descripcion_producto,
        p.laboratorio,
        p.presentacion,
        p.requiere_receta,
        p.es_controlado,
        p.precio_venta,

        c.nombre AS nombre_categoria,

        COALESCE(inv.stock_total, 0) AS stock_total,

        oc.id_oferta,
        oc.nombre AS nombre_oferta,
        oc.descripcion AS descripcion_oferta,
        oc.porcentaje_descuento,

        CASE 
          WHEN oc.id_oferta IS NOT NULL THEN true
          ELSE false
        END AS tiene_oferta,

        CASE
          WHEN oc.id_oferta IS NOT NULL THEN
            ROUND(
              p.precio_venta - (p.precio_venta * oc.porcentaje_descuento / 100),
              2
            )
          ELSE p.precio_venta
        END AS precio_final

      FROM public.catalogo_productos cp

      INNER JOIN public.productos p
        ON p.id_producto = cp.id_producto

      LEFT JOIN public.categorias c
        ON c.id_categoria = p.id_categoria

      LEFT JOIN LATERAL (
        SELECT 
          oc2.id_oferta,
          oc2.nombre,
          oc2.descripcion,
          oc2.porcentaje_descuento
        FROM public.ofertas_categorias oc2
        WHERE oc2.id_categoria = p.id_categoria
          AND oc2.activo = true
          AND CURRENT_DATE BETWEEN oc2.fecha_inicio AND oc2.fecha_fin
        ORDER BY oc2.fecha_creacion DESC
        LIMIT 1
      ) oc ON true

      LEFT JOIN (
        SELECT
          id_producto,
          SUM(stock_actual) AS stock_total
        FROM public.inventario_sucursal
        GROUP BY id_producto
      ) inv
        ON inv.id_producto = p.id_producto

      WHERE cp.id_catalogo = $1
        AND cp.activo = true
        AND p.activo = true

      LIMIT 1;
    `;

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto no encontrado en catálogo',
      });
    }

    res.json({
      ok: true,
      producto: rows[0],
    });
  } catch (error) {
    console.error('Error al obtener detalle público:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al obtener detalle del producto',
      error: error.message,
    });
  }
};

export const listarCategoriasCatalogoPublico = async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        c.id_categoria,
        c.nombre
      FROM public.catalogo_productos cp
      INNER JOIN public.productos p
        ON p.id_producto = cp.id_producto
      INNER JOIN public.categorias c
        ON c.id_categoria = p.id_categoria
      WHERE cp.activo = true
        AND p.activo = true
        AND c.activo = true
      ORDER BY c.nombre ASC;
    `;

    const { rows } = await pool.query(query);

    res.json({
      ok: true,
      categorias: rows,
    });
  } catch (error) {
    console.error('Error al listar categorías públicas:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al listar categorías del catálogo',
      error: error.message,
    });
  }
};