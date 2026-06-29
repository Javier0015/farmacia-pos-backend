import { pool } from '../config/db.js';

const ID_ROL_CAJERO = 3;

const normalizarId = (valor) => {
  if (valor === null || valor === undefined || valor === '') {
    return null;
  }

  const id = Number(valor);

  if (!Number.isInteger(id) || id <= 0) {
    return NaN;
  }

  return id;
};

const normalizarBooleano = (valor, valorPorDefecto = true) => {
  if (valor === undefined || valor === null) {
    return valorPorDefecto;
  }

  if (typeof valor === 'boolean') {
    return valor;
  }

  return ['true', '1', 'si', 'sí'].includes(
    String(valor).trim().toLowerCase()
  );
};

const validarSucursalActiva = async (idSucursal) => {
  const resultado = await pool.query(
    `
      SELECT
        id_sucursal,
        nombre
      FROM sucursales
      WHERE id_sucursal = $1
        AND activo = true
      LIMIT 1
    `,
    [idSucursal]
  );

  return resultado.rows[0] || null;
};

const validarSesionAbiertaCaja = async (idCaja) => {
  const resultado = await pool.query(
    `
      SELECT id_sesion
      FROM caja_sesiones
      WHERE id_caja = $1
        AND estado = 'ABIERTA'
      LIMIT 1
    `,
    [idCaja]
  );

  return resultado.rows.length > 0;
};

const validarCajeroAsignado = async ({
  idUsuarioAsignado,
  idCajaActual = 0,
}) => {
  if (idUsuarioAsignado === null) {
    return { ok: true };
  }

  const usuarioResultado = await pool.query(
    `
      SELECT
        id_usuario,
        nombre,
        usuario,
        id_rol,
        activo
      FROM usuarios
      WHERE id_usuario = $1
        AND activo = true
        AND id_rol = $2
      LIMIT 1
    `,
    [idUsuarioAsignado, ID_ROL_CAJERO]
  );

  if (usuarioResultado.rows.length === 0) {
    return {
      ok: false,
      status: 404,
      mensaje: 'El usuario seleccionado no es un cajero activo',
    };
  }

  const cajaAsignada = await pool.query(
    `
      SELECT
        id_caja,
        nombre
      FROM cajas
      WHERE id_usuario_asignado = $1
        AND id_caja <> $2
      LIMIT 1
    `,
    [idUsuarioAsignado, idCajaActual]
  );

  if (cajaAsignada.rows.length > 0) {
    return {
      ok: false,
      status: 409,
      mensaje: `Este cajero ya está asignado a la caja: ${cajaAsignada.rows[0].nombre}`,
    };
  }

  return {
    ok: true,
    cajero: usuarioResultado.rows[0],
  };
};

export const listarCajerosDisponiblesAdmin = async (req, res) => {
  try {
    const idCajaConsulta = normalizarId(req.query.id_caja);

    if (Number.isNaN(idCajaConsulta)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La caja seleccionada no es válida',
      });
    }

    const idCajaActual = idCajaConsulta || 0;

    const resultado = await pool.query(
      `
        SELECT
          u.id_usuario,
          u.nombre,
          u.usuario
        FROM usuarios u
        WHERE u.activo = true
          AND u.id_rol = $1
          AND NOT EXISTS (
            SELECT 1
            FROM cajas c
            WHERE c.id_usuario_asignado = u.id_usuario
              AND c.id_caja <> $2
          )
        ORDER BY u.nombre ASC
      `,
      [ID_ROL_CAJERO, idCajaActual]
    );

    return res.json({
      ok: true,
      cajeros: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar cajeros disponibles:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al cargar cajeros disponibles',
    });
  }
};

export const listarCajasAdmin = async (req, res) => {
  try {
    const { buscar, activos } = req.query;
    const idSucursal = normalizarId(req.query.sucursal);

    if (Number.isNaN(idSucursal)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sucursal seleccionada no es válida',
      });
    }

    let query = `
      SELECT
        c.id_caja,
        c.id_sucursal,
        s.nombre AS sucursal,
        s.clave AS clave_sucursal,
        c.nombre,
        c.descripcion,
        c.activo,
        c.id_usuario_asignado,
        u.nombre AS cajero_asignado,
        c.fecha_creacion,
        c.fecha_actualizacion
      FROM cajas c
      INNER JOIN sucursales s
        ON s.id_sucursal = c.id_sucursal
      LEFT JOIN usuarios u
        ON u.id_usuario = c.id_usuario_asignado
      WHERE 1 = 1
    `;

    const params = [];

    if (idSucursal) {
      params.push(idSucursal);
      query += ` AND c.id_sucursal = $${params.length}`;
    }

    if (buscar?.trim()) {
      params.push(`%${buscar.trim()}%`);

      query += `
        AND (
          c.nombre ILIKE $${params.length}
          OR COALESCE(c.descripcion, '') ILIKE $${params.length}
          OR s.nombre ILIKE $${params.length}
          OR COALESCE(s.clave, '') ILIKE $${params.length}
          OR COALESCE(u.nombre, '') ILIKE $${params.length}
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
    const {
      id_sucursal,
      nombre,
      descripcion,
      activo,
      id_usuario_asignado,
    } = req.body;

    const idSucursal = normalizarId(id_sucursal);
    const idUsuarioAsignado = normalizarId(id_usuario_asignado);
    const cajaActiva = normalizarBooleano(activo, true);
    const nombreCaja = nombre?.trim();

    if (!idSucursal || Number.isNaN(idSucursal)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sucursal es obligatoria',
      });
    }

    if (!nombreCaja) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la caja es obligatorio',
      });
    }

    if (Number.isNaN(idUsuarioAsignado)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El cajero seleccionado no es válido',
      });
    }

    const sucursalExiste = await validarSucursalActiva(idSucursal);

    if (!sucursalExiste) {
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
        LIMIT 1
      `,
      [idSucursal, nombreCaja]
    );

    if (cajaDuplicada.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe una caja con ese nombre en la sucursal seleccionada',
      });
    }

    const idUsuarioFinal = cajaActiva ? idUsuarioAsignado : null;

    const validacionCajero = await validarCajeroAsignado({
      idUsuarioAsignado: idUsuarioFinal,
    });

    if (!validacionCajero.ok) {
      return res.status(validacionCajero.status).json({
        ok: false,
        mensaje: validacionCajero.mensaje,
      });
    }

    const resultado = await pool.query(
      `
        INSERT INTO cajas (
          id_sucursal,
          nombre,
          descripcion,
          activo,
          id_usuario_asignado,
          fecha_creacion,
          fecha_actualizacion
        )
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING
          id_caja,
          id_sucursal,
          nombre,
          descripcion,
          activo,
          id_usuario_asignado,
          fecha_creacion,
          fecha_actualizacion
      `,
      [
        idSucursal,
        nombreCaja,
        descripcion?.trim() || null,
        cajaActiva,
        idUsuarioFinal,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Caja creada correctamente',
      caja: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al crear caja admin:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        ok: false,
        mensaje: 'El cajero seleccionado ya está asignado a otra caja',
      });
    }

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear caja',
    });
  }
};

export const actualizarCajaAdmin = async (req, res) => {
  try {
    const idCaja = normalizarId(req.params.id);

    const {
      id_sucursal,
      nombre,
      descripcion,
      activo,
      id_usuario_asignado,
    } = req.body;

    const idSucursal = normalizarId(id_sucursal);
    const idUsuarioAsignado = normalizarId(id_usuario_asignado);
    const cajaActiva = normalizarBooleano(activo, true);
    const nombreCaja = nombre?.trim();

    if (!idCaja || Number.isNaN(idCaja)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La caja seleccionada no es válida',
      });
    }

    if (!idSucursal || Number.isNaN(idSucursal)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sucursal es obligatoria',
      });
    }

    if (!nombreCaja) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la caja es obligatorio',
      });
    }

    if (Number.isNaN(idUsuarioAsignado)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El cajero seleccionado no es válido',
      });
    }

    const cajaActualResultado = await pool.query(
      `
        SELECT
          id_caja,
          id_sucursal,
          id_usuario_asignado,
          activo
        FROM cajas
        WHERE id_caja = $1
        LIMIT 1
      `,
      [idCaja]
    );

    if (cajaActualResultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Caja no encontrada',
      });
    }

    const cajaActual = cajaActualResultado.rows[0];

    const sucursalExiste = await validarSucursalActiva(idSucursal);

    if (!sucursalExiste) {
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
          AND id_caja <> $3
        LIMIT 1
      `,
      [idSucursal, nombreCaja, idCaja]
    );

    if (cajaDuplicada.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe otra caja con ese nombre en la sucursal seleccionada',
      });
    }

    const idUsuarioFinal = cajaActiva ? idUsuarioAsignado : null;

    const cambioSucursal =
      Number(cajaActual.id_sucursal) !== Number(idSucursal);

    const cambioCajero =
      Number(cajaActual.id_usuario_asignado || 0) !==
      Number(idUsuarioFinal || 0);

    const desactivandoCaja =
      Boolean(cajaActual.activo) === true && cajaActiva === false;

    if (cambioSucursal || cambioCajero || desactivandoCaja) {
      const sesionAbierta = await validarSesionAbiertaCaja(idCaja);

      if (sesionAbierta) {
        return res.status(400).json({
          ok: false,
          mensaje:
            'No puedes cambiar la sucursal, el cajero o el estado mientras la caja tiene una sesión abierta',
        });
      }
    }

    const validacionCajero = await validarCajeroAsignado({
      idUsuarioAsignado: idUsuarioFinal,
      idCajaActual: idCaja,
    });

    if (!validacionCajero.ok) {
      return res.status(validacionCajero.status).json({
        ok: false,
        mensaje: validacionCajero.mensaje,
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
          id_usuario_asignado = $5,
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_caja = $6
        RETURNING
          id_caja,
          id_sucursal,
          nombre,
          descripcion,
          activo,
          id_usuario_asignado,
          fecha_creacion,
          fecha_actualizacion
      `,
      [
        idSucursal,
        nombreCaja,
        descripcion?.trim() || null,
        cajaActiva,
        idUsuarioFinal,
        idCaja,
      ]
    );

    return res.json({
      ok: true,
      mensaje: 'Caja actualizada correctamente',
      caja: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar caja admin:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        ok: false,
        mensaje: 'El cajero seleccionado ya está asignado a otra caja',
      });
    }

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar caja',
    });
  }
};

export const desactivarCajaAdmin = async (req, res) => {
  try {
    const idCaja = normalizarId(req.params.id);

    if (!idCaja || Number.isNaN(idCaja)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La caja seleccionada no es válida',
      });
    }

    const sesionAbierta = await validarSesionAbiertaCaja(idCaja);

    if (sesionAbierta) {
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
          id_usuario_asignado = NULL,
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_caja = $1
        RETURNING
          id_caja,
          nombre,
          activo,
          id_usuario_asignado
      `,
      [idCaja]
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