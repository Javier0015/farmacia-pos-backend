import { pool } from '../config/db.js';

export const listarProductos = async (req, res) => {
  try {
    const { buscar, activos } = req.query;

    let query = `
      SELECT
        p.id_producto,
        p.codigo_barras,
        p.nombre,
        p.descripcion,
        p.id_categoria,
        c.nombre AS categoria,
        p.laboratorio,
        p.presentacion,
        p.requiere_receta,
        p.es_controlado,
        p.precio_compra,
        p.precio_venta,
        p.puntos_por_unidad,
        p.activo,
        p.fecha_creacion
      FROM productos p
      LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
      WHERE 1 = 1
    `;

    const params = [];

    if (buscar) {
      params.push(`%${buscar.trim()}%`);

      query += `
        AND (
          p.nombre ILIKE $${params.length}
          OR p.codigo_barras ILIKE $${params.length}
          OR p.laboratorio ILIKE $${params.length}
          OR p.presentacion ILIKE $${params.length}
        )
      `;
    }

    if (activos === 'true') {
      query += ` AND p.activo = true `;
    }

    query += ` ORDER BY p.nombre ASC `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      productos: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar productos:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar productos',
    });
  }
};

export const obtenerProducto = async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      SELECT
        p.id_producto,
        p.codigo_barras,
        p.nombre,
        p.descripcion,
        p.id_categoria,
        c.nombre AS categoria,
        p.laboratorio,
        p.presentacion,
        p.requiere_receta,
        p.es_controlado,
        p.precio_compra,
        p.precio_venta,
        p.puntos_por_unidad,
        p.activo,
        p.fecha_creacion
      FROM productos p
      LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
      WHERE p.id_producto = $1
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto no encontrado',
      });
    }

    return res.json({
      ok: true,
      producto: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener producto:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener producto',
    });
  }
};

export const crearProducto = async (req, res) => {
  try {
    const {
      codigo_barras,
      nombre,
      descripcion,
      id_categoria,
      laboratorio,
      presentacion,
      requiere_receta,
      es_controlado,
      precio_compra,
      precio_venta,
      puntos_por_unidad,
    } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del producto es obligatorio',
      });
    }

    if (precio_venta === undefined || Number(precio_venta) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El precio de venta es obligatorio y no puede ser negativo',
      });
    }

    if (Number(precio_compra || 0) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El precio de compra no puede ser negativo',
      });
    }

    if (Number(puntos_por_unidad || 0) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Los puntos por unidad no pueden ser negativos',
      });
    }

    if (codigo_barras && codigo_barras.trim()) {
      const existeCodigo = await pool.query(
        `
        SELECT id_producto 
        FROM productos 
        WHERE codigo_barras = $1
        `,
        [codigo_barras.trim()]
      );

      if (existeCodigo.rows.length > 0) {
        return res.status(409).json({
          ok: false,
          mensaje: 'Ya existe un producto con ese código de barras',
        });
      }
    }

    const resultado = await pool.query(
      `
      INSERT INTO productos (
        codigo_barras,
        nombre,
        descripcion,
        id_categoria,
        laboratorio,
        presentacion,
        requiere_receta,
        es_controlado,
        precio_compra,
        precio_venta,
        puntos_por_unidad
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
      `,
      [
        codigo_barras && codigo_barras.trim() ? codigo_barras.trim() : null,
        nombre.trim(),
        descripcion?.trim() || null,
        id_categoria || null,
        laboratorio?.trim() || null,
        presentacion?.trim() || null,
        requiere_receta || false,
        es_controlado || false,
        Number(precio_compra || 0),
        Number(precio_venta || 0),
        Number(puntos_por_unidad || 0),
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Producto creado correctamente',
      producto: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al crear producto:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear producto',
    });
  }
};

export const actualizarProducto = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      codigo_barras,
      nombre,
      descripcion,
      id_categoria,
      laboratorio,
      presentacion,
      requiere_receta,
      es_controlado,
      precio_compra,
      precio_venta,
      puntos_por_unidad,
      activo,
    } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del producto es obligatorio',
      });
    }

    if (precio_venta === undefined || Number(precio_venta) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El precio de venta es obligatorio y no puede ser negativo',
      });
    }

    if (Number(precio_compra || 0) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El precio de compra no puede ser negativo',
      });
    }

    if (Number(puntos_por_unidad || 0) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Los puntos por unidad no pueden ser negativos',
      });
    }

    if (codigo_barras && codigo_barras.trim()) {
      const existeCodigo = await pool.query(
        `
        SELECT id_producto 
        FROM productos 
        WHERE codigo_barras = $1 
        AND id_producto <> $2
        `,
        [codigo_barras.trim(), id]
      );

      if (existeCodigo.rows.length > 0) {
        return res.status(409).json({
          ok: false,
          mensaje: 'Ya existe otro producto con ese código de barras',
        });
      }
    }

    const resultado = await pool.query(
      `
      UPDATE productos
      SET
        codigo_barras = $1,
        nombre = $2,
        descripcion = $3,
        id_categoria = $4,
        laboratorio = $5,
        presentacion = $6,
        requiere_receta = $7,
        es_controlado = $8,
        precio_compra = $9,
        precio_venta = $10,
        puntos_por_unidad = $11,
        activo = COALESCE($12, activo)
      WHERE id_producto = $13
      RETURNING *
      `,
      [
        codigo_barras && codigo_barras.trim() ? codigo_barras.trim() : null,
        nombre.trim(),
        descripcion?.trim() || null,
        id_categoria || null,
        laboratorio?.trim() || null,
        presentacion?.trim() || null,
        requiere_receta || false,
        es_controlado || false,
        Number(precio_compra || 0),
        Number(precio_venta || 0),
        Number(puntos_por_unidad || 0),
        activo,
        id,
      ]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto no encontrado',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Producto actualizado correctamente',
      producto: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar producto:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar producto',
    });
  }
};

export const desactivarProducto = async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      UPDATE productos
      SET activo = false
      WHERE id_producto = $1
      RETURNING 
        id_producto,
        nombre,
        activo
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto no encontrado',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Producto desactivado correctamente',
      producto: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al desactivar producto:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al desactivar producto',
    });
  }
};