import { pool } from '../config/db.js';

export const listarSucursales = async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT 
        id_sucursal,
        nombre,
        clave,
        direccion,
        telefono,
        correo,
        responsable,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM sucursales
      ORDER BY id_sucursal ASC
    `);

    return res.json({
      ok: true,
      sucursales: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar sucursales:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar sucursales',
    });
  }
};

export const obtenerSucursal = async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      SELECT 
        id_sucursal,
        nombre,
        clave,
        direccion,
        telefono,
        correo,
        responsable,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM sucursales
      WHERE id_sucursal = $1
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Sucursal no encontrada',
      });
    }

    return res.json({
      ok: true,
      sucursal: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener sucursal:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener sucursal',
    });
  }
};

export const crearSucursal = async (req, res) => {
  try {
    const { nombre, clave, direccion, telefono, correo, responsable } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la sucursal es obligatorio',
      });
    }

    if (!clave || !clave.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La clave de la sucursal es obligatoria',
      });
    }

    if (correo && correo.trim()) {
      const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);

      if (!correoValido) {
        return res.status(400).json({
          ok: false,
          mensaje: 'El correo electrónico no es válido',
        });
      }
    }

    const claveNormalizada = clave.trim().toUpperCase();

    const existe = await pool.query(
      `
      SELECT id_sucursal 
      FROM sucursales 
      WHERE clave = $1
      `,
      [claveNormalizada]
    );

    if (existe.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe una sucursal con esa clave',
      });
    }

    const resultado = await pool.query(
      `
      INSERT INTO sucursales (
        nombre,
        clave,
        direccion,
        telefono,
        correo,
        responsable,
        activo,
        fecha_creacion,
        fecha_actualizacion
      )
      VALUES ($1, $2, $3, $4, $5, $6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING 
        id_sucursal,
        nombre,
        clave,
        direccion,
        telefono,
        correo,
        responsable,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        nombre.trim(),
        claveNormalizada,
        direccion?.trim() || null,
        telefono?.trim() || null,
        correo?.trim() || null,
        responsable?.trim() || null,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Sucursal creada correctamente',
      sucursal: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al crear sucursal:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear sucursal',
    });
  }
};

export const actualizarSucursal = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre,
      clave,
      direccion,
      telefono,
      correo,
      responsable,
      activo,
    } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la sucursal es obligatorio',
      });
    }

    if (!clave || !clave.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La clave de la sucursal es obligatoria',
      });
    }

    if (correo && correo.trim()) {
      const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);

      if (!correoValido) {
        return res.status(400).json({
          ok: false,
          mensaje: 'El correo electrónico no es válido',
        });
      }
    }

    const claveNormalizada = clave.trim().toUpperCase();

    const existe = await pool.query(
      `
      SELECT id_sucursal 
      FROM sucursales 
      WHERE clave = $1 
      AND id_sucursal <> $2
      `,
      [claveNormalizada, id]
    );

    if (existe.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe otra sucursal con esa clave',
      });
    }

    const resultado = await pool.query(
      `
      UPDATE sucursales
      SET 
        nombre = $1,
        clave = $2,
        direccion = $3,
        telefono = $4,
        correo = $5,
        responsable = $6,
        activo = COALESCE($7, activo),
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_sucursal = $8
      RETURNING 
        id_sucursal,
        nombre,
        clave,
        direccion,
        telefono,
        correo,
        responsable,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        nombre.trim(),
        claveNormalizada,
        direccion?.trim() || null,
        telefono?.trim() || null,
        correo?.trim() || null,
        responsable?.trim() || null,
        activo,
        id,
      ]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Sucursal no encontrada',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Sucursal actualizada correctamente',
      sucursal: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar sucursal:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar sucursal',
    });
  }
};

export const desactivarSucursal = async (req, res) => {
  try {
    const { id } = req.params;

    const cajasAbiertas = await pool.query(
      `
      SELECT id_sesion
      FROM caja_sesiones
      WHERE id_sucursal = $1
      AND estado = 'ABIERTA'
      LIMIT 1
      `,
      [id]
    );

    if (cajasAbiertas.rows.length > 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'No puedes desactivar una sucursal con caja abierta',
      });
    }

    const resultado = await pool.query(
      `
      UPDATE sucursales
      SET 
        activo = false,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_sucursal = $1
      RETURNING 
        id_sucursal,
        nombre,
        clave,
        activo
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Sucursal no encontrada',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Sucursal desactivada correctamente',
      sucursal: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al desactivar sucursal:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al desactivar sucursal',
    });
  }
};