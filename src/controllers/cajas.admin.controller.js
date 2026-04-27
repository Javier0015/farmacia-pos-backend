import { pool } from '../config/db.js';

export const listarCajasAdmin = async (req, res) => {
  try {
    const { sucursal, buscar, activos } = req.query;

    let query = `
      SELECT
        c.id_caja,
        c.id_sucursal,
        s.nombre AS sucursal,
        s.clave AS clave_sucursal,
        c.nombre,
        c.descripcion,
        c.activo,
        c.fecha_creacion,
        c.fecha_actualizacion
      FROM cajas c
      INNER JOIN sucursales s ON s.id_sucursal = c.id_sucursal
      WHERE 1 = 1
    `;

    const params = [];

    if (sucursal) {
      params.push(sucursal);
      query += ` AND c.id_sucursal = $${params.length}`;
    }

    if (buscar) {
      params.push(`%${buscar.trim()}%`);
      query += `
        AND (
          c.nombre ILIKE $${params.length}
          OR c.descripcion ILIKE $${params.length}
          OR s.nombre ILIKE $${params.length}
          OR s.clave ILIKE $${params.length}
        )
      `;
    }

    if (activos === 'true') {
      query += ` AND c.activo = true`;
    }

    query += `
      ORDER BY s.nombre ASC, c.nombre ASC
    `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      cajas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar cajas admin:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar cajas',
    });
  }
};

export const crearCajaAdmin = async (req, res) => {
  try {
    const { id_sucursal, nombre, descripcion, activo } = req.body;

    if (!id_sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sucursal es obligatoria',
      });
    }

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la caja es obligatorio',
      });
    }

    const sucursalExiste = await pool.query(
      `
      SELECT id_sucursal
      FROM sucursales
      WHERE id_sucursal = $1
      AND activo = true
      `,
      [id_sucursal]
    );

    if (sucursalExiste.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'La sucursal no existe o está inactiva',
      });
    }

    const cajaDuplicada = await pool.query(
      `
      SELECT id_caja
      FROM cajas
      WHERE id_sucursal = $1
      AND LOWER(nombre) = LOWER($2)
      `,
      [id_sucursal, nombre.trim()]
    );

    if (cajaDuplicada.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe una caja con ese nombre en la sucursal seleccionada',
      });
    }

    const resultado = await pool.query(
      `
      INSERT INTO cajas (
        id_sucursal,
        nombre,
        descripcion,
        activo,
        fecha_creacion,
        fecha_actualizacion
      )
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING
        id_caja,
        id_sucursal,
        nombre,
        descripcion,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        Number(id_sucursal),
        nombre.trim(),
        descripcion?.trim() || null,
        activo !== undefined ? Boolean(activo) : true,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Caja creada correctamente',
      caja: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al crear caja admin:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear caja',
    });
  }
};

export const actualizarCajaAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_sucursal, nombre, descripcion, activo } = req.body;

    if (!id_sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sucursal es obligatoria',
      });
    }

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la caja es obligatorio',
      });
    }

    const cajaDuplicada = await pool.query(
      `
      SELECT id_caja
      FROM cajas
      WHERE id_sucursal = $1
      AND LOWER(nombre) = LOWER($2)
      AND id_caja <> $3
      `,
      [id_sucursal, nombre.trim(), id]
    );

    if (cajaDuplicada.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe otra caja con ese nombre en la sucursal seleccionada',
      });
    }

    const resultado = await pool.query(
      `
      UPDATE cajas
      SET
        id_sucursal = $1,
        nombre = $2,
        descripcion = $3,
        activo = $4,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_caja = $5
      RETURNING
        id_caja,
        id_sucursal,
        nombre,
        descripcion,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        Number(id_sucursal),
        nombre.trim(),
        descripcion?.trim() || null,
        activo !== undefined ? Boolean(activo) : true,
        id,
      ]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Caja no encontrada',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Caja actualizada correctamente',
      caja: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar caja admin:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar caja',
    });
  }
};

export const desactivarCajaAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const sesionAbierta = await pool.query(
      `
      SELECT id_sesion
      FROM caja_sesiones
      WHERE id_caja = $1
      AND estado = 'ABIERTA'
      LIMIT 1
      `,
      [id]
    );

    if (sesionAbierta.rows.length > 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'No puedes desactivar una caja con sesión abierta',
      });
    }

    const resultado = await pool.query(
      `
      UPDATE cajas
      SET
        activo = false,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_caja = $1
      RETURNING id_caja, nombre, activo
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Caja no encontrada',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Caja desactivada correctamente',
      caja: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al desactivar caja admin:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al desactivar caja',
    });
  }
};