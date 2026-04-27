import { pool } from '../config/db.js';

export const listarProveedores = async (req, res) => {
  try {
    const { buscar, activos } = req.query;

    let query = `
      SELECT
        id_proveedor,
        nombre,
        rfc,
        telefono,
        correo,
        direccion,
        contacto,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM proveedores
      WHERE 1 = 1
    `;

    const params = [];

    if (buscar) {
      params.push(`%${buscar.trim()}%`);
      query += `
        AND (
          nombre ILIKE $${params.length}
          OR rfc ILIKE $${params.length}
          OR telefono ILIKE $${params.length}
          OR correo ILIKE $${params.length}
          OR contacto ILIKE $${params.length}
        )
      `;
    }

    if (activos === 'true') {
      query += ` AND activo = true `;
    }

    query += ` ORDER BY nombre ASC `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      proveedores: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar proveedores:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar proveedores',
    });
  }
};

export const obtenerProveedor = async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      SELECT
        id_proveedor,
        nombre,
        rfc,
        telefono,
        correo,
        direccion,
        contacto,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM proveedores
      WHERE id_proveedor = $1
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Proveedor no encontrado',
      });
    }

    return res.json({
      ok: true,
      proveedor: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener proveedor:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener proveedor',
    });
  }
};

export const crearProveedor = async (req, res) => {
  try {
    const {
      nombre,
      rfc,
      telefono,
      correo,
      direccion,
      contacto,
    } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del proveedor es obligatorio',
      });
    }

    if (rfc && rfc.trim()) {
      const existeRfc = await pool.query(
        `
        SELECT id_proveedor
        FROM proveedores
        WHERE UPPER(rfc) = UPPER($1)
        `,
        [rfc.trim()]
      );

      if (existeRfc.rows.length > 0) {
        return res.status(409).json({
          ok: false,
          mensaje: 'Ya existe un proveedor con ese RFC',
        });
      }
    }

    const resultado = await pool.query(
      `
      INSERT INTO proveedores (
        nombre,
        rfc,
        telefono,
        correo,
        direccion,
        contacto
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING
        id_proveedor,
        nombre,
        rfc,
        telefono,
        correo,
        direccion,
        contacto,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        nombre.trim(),
        rfc ? rfc.trim().toUpperCase() : null,
        telefono || null,
        correo || null,
        direccion || null,
        contacto || null,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Proveedor creado correctamente',
      proveedor: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al crear proveedor:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear proveedor',
    });
  }
};

export const actualizarProveedor = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      nombre,
      rfc,
      telefono,
      correo,
      direccion,
      contacto,
      activo,
    } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del proveedor es obligatorio',
      });
    }

    if (rfc && rfc.trim()) {
      const existeRfc = await pool.query(
        `
        SELECT id_proveedor
        FROM proveedores
        WHERE UPPER(rfc) = UPPER($1)
        AND id_proveedor <> $2
        `,
        [rfc.trim(), id]
      );

      if (existeRfc.rows.length > 0) {
        return res.status(409).json({
          ok: false,
          mensaje: 'Ya existe otro proveedor con ese RFC',
        });
      }
    }

    const resultado = await pool.query(
      `
      UPDATE proveedores
      SET
        nombre = $1,
        rfc = $2,
        telefono = $3,
        correo = $4,
        direccion = $5,
        contacto = $6,
        activo = COALESCE($7, activo),
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_proveedor = $8
      RETURNING
        id_proveedor,
        nombre,
        rfc,
        telefono,
        correo,
        direccion,
        contacto,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        nombre.trim(),
        rfc ? rfc.trim().toUpperCase() : null,
        telefono || null,
        correo || null,
        direccion || null,
        contacto || null,
        activo,
        id,
      ]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Proveedor no encontrado',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Proveedor actualizado correctamente',
      proveedor: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar proveedor:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar proveedor',
    });
  }
};

export const desactivarProveedor = async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      UPDATE proveedores
      SET
        activo = false,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_proveedor = $1
      RETURNING
        id_proveedor,
        nombre,
        activo
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Proveedor no encontrado',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Proveedor desactivado correctamente',
      proveedor: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al desactivar proveedor:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al desactivar proveedor',
    });
  }
};