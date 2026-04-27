import { pool } from '../config/db.js';

export const listarCategorias = async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT 
        id_categoria,
        nombre,
        descripcion,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM categorias
      ORDER BY nombre ASC
    `);

    return res.json({
      ok: true,
      categorias: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar categorías:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar categorías',
    });
  }
};

export const crearCategoria = async (req, res) => {
  try {
    const { nombre, descripcion } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la categoría es obligatorio',
      });
    }

    const nombreLimpio = nombre.trim();

    const existe = await pool.query(
      `
      SELECT id_categoria
      FROM categorias
      WHERE LOWER(nombre) = LOWER($1)
      `,
      [nombreLimpio]
    );

    if (existe.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe una categoría con ese nombre',
      });
    }

    const resultado = await pool.query(
      `
      INSERT INTO categorias (
        nombre,
        descripcion,
        activo,
        fecha_creacion,
        fecha_actualizacion
      )
      VALUES ($1, $2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING 
        id_categoria,
        nombre,
        descripcion,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        nombreLimpio,
        descripcion?.trim() || null,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Categoría creada correctamente',
      categoria: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al crear categoría:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear categoría',
    });
  }
};

export const actualizarCategoria = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion, activo } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la categoría es obligatorio',
      });
    }

    const nombreLimpio = nombre.trim();

    const existe = await pool.query(
      `
      SELECT id_categoria
      FROM categorias
      WHERE LOWER(nombre) = LOWER($1)
      AND id_categoria <> $2
      `,
      [nombreLimpio, id]
    );

    if (existe.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe otra categoría con ese nombre',
      });
    }

    const resultado = await pool.query(
      `
      UPDATE categorias
      SET 
        nombre = $1,
        descripcion = $2,
        activo = COALESCE($3, activo),
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_categoria = $4
      RETURNING 
        id_categoria,
        nombre,
        descripcion,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        nombreLimpio,
        descripcion?.trim() || null,
        activo,
        id,
      ]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Categoría no encontrada',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Categoría actualizada correctamente',
      categoria: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar categoría:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar categoría',
    });
  }
};

export const desactivarCategoria = async (req, res) => {
  try {
    const { id } = req.params;

    const productosAsociados = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM productos
      WHERE id_categoria = $1
      AND activo = true
      `,
      [id]
    );

    const totalProductos = Number(productosAsociados.rows[0]?.total || 0);

    if (totalProductos > 0) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'No puedes desactivar esta categoría porque tiene productos activos asociados',
        productos_asociados: totalProductos,
      });
    }

    const resultado = await pool.query(
      `
      UPDATE categorias
      SET 
        activo = false,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_categoria = $1
      RETURNING 
        id_categoria,
        nombre,
        descripcion,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Categoría no encontrada',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Categoría desactivada correctamente',
      categoria: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al desactivar categoría:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al desactivar categoría',
    });
  }
};