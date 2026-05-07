import { pool } from '../config/db.js';

const construirUrlImagen = (req, file) => {
  if (!file) return null;

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/catalogo/${file.filename}`;
};

export const listarCatalogoAdmin = async (req, res) => {
  try {
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
        cp.activo,
        cp.destacado,
        cp.mostrar_stock,
        cp.orden,
        cp.fecha_creacion,
        cp.fecha_actualizacion,

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

      ORDER BY 
        cp.fecha_creacion DESC;
    `;

    const { rows } = await pool.query(query);

    res.json({
      ok: true,
      catalogo: rows,
    });
  } catch (error) {
    console.error('Error al listar catálogo admin:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al listar el catálogo',
      error: error.message,
    });
  }
};

export const listarProductosParaCatalogo = async (req, res) => {
  try {
    const query = `
      SELECT
        p.id_producto,
        p.codigo_barras,
        p.nombre,
        p.descripcion,
        p.laboratorio,
        p.presentacion,
        p.requiere_receta,
        p.es_controlado,
        p.precio_venta,
        p.id_categoria,

        c.nombre AS nombre_categoria,

        COALESCE(inv.stock_total, 0) AS stock_total,

        CASE 
          WHEN cp.id_catalogo IS NOT NULL THEN true
          ELSE false
        END AS ya_en_catalogo,

        cp.id_catalogo

      FROM public.productos p

      LEFT JOIN public.categorias c
        ON c.id_categoria = p.id_categoria

      LEFT JOIN (
        SELECT
          id_producto,
          SUM(stock_actual) AS stock_total
        FROM public.inventario_sucursal
        GROUP BY id_producto
      ) inv
        ON inv.id_producto = p.id_producto

      LEFT JOIN public.catalogo_productos cp
        ON cp.id_producto = p.id_producto

      WHERE p.activo = true

      ORDER BY p.nombre ASC;
    `;

    const { rows } = await pool.query(query);

    res.json({
      ok: true,
      productos: rows,
    });
  } catch (error) {
    console.error('Error al listar productos para catálogo:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al listar productos para catálogo',
      error: error.message,
    });
  }
};

export const crearProductoCatalogo = async (req, res) => {
  try {
    const {
      id_producto,
      titulo_catalogo,
      descripcion_catalogo,
      advertencias,
      indicaciones,
      modo_uso,
      activo,
      destacado,
      mostrar_stock,
      orden,
    } = req.body;

    if (!id_producto) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El producto es obligatorio',
      });
    }

    const imagen_url = construirUrlImagen(req, req.file);

    const query = `
      INSERT INTO public.catalogo_productos (
        id_producto,
        titulo_catalogo,
        descripcion_catalogo,
        advertencias,
        indicaciones,
        modo_uso,
        imagen_url,
        activo,
        destacado,
        mostrar_stock,
        orden
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true), COALESCE($9, false), COALESCE($10, false), COALESCE($11, 0))
      RETURNING *;
    `;

    const values = [
      id_producto,
      titulo_catalogo || null,
      descripcion_catalogo || null,
      advertencias || null,
      indicaciones || null,
      modo_uso || null,
      imagen_url,
      activo === undefined ? true : activo,
      destacado === undefined ? false : destacado,
      mostrar_stock === undefined ? false : mostrar_stock,
      orden || 0,
    ];

    const { rows } = await pool.query(query, values);

    res.status(201).json({
      ok: true,
      mensaje: 'Producto agregado al catálogo correctamente',
      producto: rows[0],
    });
  } catch (error) {
    console.error('Error al crear producto de catálogo:', error);

    if (error.code === '23505') {
      return res.status(400).json({
        ok: false,
        mensaje: 'Este producto ya está agregado al catálogo',
      });
    }

    res.status(500).json({
      ok: false,
      mensaje: 'Error al crear producto de catálogo',
      error: error.message,
    });
  }
};

export const actualizarProductoCatalogo = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      titulo_catalogo,
      descripcion_catalogo,
      advertencias,
      indicaciones,
      modo_uso,
      activo,
      destacado,
      mostrar_stock,
      orden,
    } = req.body;

    let imagen_url = null;

    if (req.file) {
      imagen_url = construirUrlImagen(req, req.file);
    }

    const query = `
      UPDATE public.catalogo_productos
      SET
        titulo_catalogo = $1,
        descripcion_catalogo = $2,
        advertencias = $3,
        indicaciones = $4,
        modo_uso = $5,
        activo = $6,
        destacado = $7,
        mostrar_stock = $8,
        orden = $9,
        imagen_url = COALESCE($10, imagen_url),
        fecha_actualizacion = NOW()
      WHERE id_catalogo = $11
      RETURNING *;
    `;

    const values = [
      titulo_catalogo || null,
      descripcion_catalogo || null,
      advertencias || null,
      indicaciones || null,
      modo_uso || null,
      activo === undefined ? true : activo,
      destacado === undefined ? false : destacado,
      mostrar_stock === undefined ? false : mostrar_stock,
      orden || 0,
      imagen_url,
      id,
    ];

    const { rows } = await pool.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto del catálogo no encontrado',
      });
    }

    res.json({
      ok: true,
      mensaje: 'Producto del catálogo actualizado correctamente',
      producto: rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar producto de catálogo:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al actualizar producto de catálogo',
      error: error.message,
    });
  }
};

export const cambiarEstadoProductoCatalogo = async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body;

    const query = `
      UPDATE public.catalogo_productos
      SET 
        activo = $1,
        fecha_actualizacion = NOW()
      WHERE id_catalogo = $2
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [activo, id]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto del catálogo no encontrado',
      });
    }

    res.json({
      ok: true,
      mensaje: activo
        ? 'Producto activado en catálogo'
        : 'Producto desactivado del catálogo',
      producto: rows[0],
    });
  } catch (error) {
    console.error('Error al cambiar estado del producto de catálogo:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al cambiar estado del producto',
      error: error.message,
    });
  }
};

export const eliminarProductoCatalogo = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      DELETE FROM public.catalogo_productos
      WHERE id_catalogo = $1
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto del catálogo no encontrado',
      });
    }

    res.json({
      ok: true,
      mensaje: 'Producto eliminado del catálogo correctamente',
      producto: rows[0],
    });
  } catch (error) {
    console.error('Error al eliminar producto de catálogo:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al eliminar producto del catálogo',
      error: error.message,
    });
  }
};