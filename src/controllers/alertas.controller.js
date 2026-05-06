import { pool } from '../config/db.js';

const obtenerRolUsuario = (usuario) => {
  return usuario?.rol || usuario?.perfil || '';
};

const obtenerSucursalesUsuario = (usuario) => {
  const ids = [];

  if (usuario?.id_sucursal) {
    ids.push(Number(usuario.id_sucursal));
  }

  if (Array.isArray(usuario?.sucursales)) {
    usuario.sucursales.forEach((sucursal) => {
      const id = sucursal?.id_sucursal || sucursal?.id;

      if (id) {
        ids.push(Number(id));
      }
    });
  }

  return [...new Set(ids.filter((id) => !Number.isNaN(id)))];
};

const normalizarPrioridad = (prioridad) => {
  const valor = String(prioridad || 'NORMAL').toUpperCase();

  const prioridadesPermitidas = ['NORMAL', 'IMPORTANTE', 'URGENTE'];

  return prioridadesPermitidas.includes(valor) ? valor : 'NORMAL';
};

export const crearAlerta = async (req, res) => {
  try {
    const {
      titulo,
      mensaje,
      prioridad = 'NORMAL',
      destino_rol = null,
      id_sucursal = null,
    } = req.body;

    if (!titulo || !titulo.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El título de la alerta es obligatorio',
      });
    }

    if (!mensaje || !mensaje.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El mensaje de la alerta es obligatorio',
      });
    }

    const prioridadNormalizada = normalizarPrioridad(prioridad);

    const resultado = await pool.query(
      `
      INSERT INTO alertas (
        titulo,
        mensaje,
        prioridad,
        destino_rol,
        id_sucursal,
        id_usuario_creador,
        activa
      )
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING *
      `,
      [
        titulo.trim(),
        mensaje.trim(),
        prioridadNormalizada,
        destino_rol ? String(destino_rol).toUpperCase() : null,
        id_sucursal || null,
        req.usuario.id_usuario,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Alerta creada correctamente',
      alerta: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al crear alerta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear alerta',
    });
  }
};

export const listarAlertas = async (req, res) => {
  try {
    const resultado = await pool.query(
      `
      SELECT
        a.id_alerta,
        a.titulo,
        a.mensaje,
        a.prioridad,
        a.destino_rol,
        a.id_sucursal,
        s.nombre AS sucursal,
        a.id_usuario_creador,
        u.nombre AS usuario_creador,
        a.activa,
        a.fecha_creacion,
        COUNT(al.id_lectura) AS total_lecturas
      FROM alertas a
      LEFT JOIN sucursales s ON s.id_sucursal = a.id_sucursal
      LEFT JOIN usuarios u ON u.id_usuario = a.id_usuario_creador
      LEFT JOIN alertas_lecturas al ON al.id_alerta = a.id_alerta
      GROUP BY
        a.id_alerta,
        s.nombre,
        u.nombre
      ORDER BY a.fecha_creacion DESC
      `
    );

    return res.json({
      ok: true,
      alertas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar alertas:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar alertas',
    });
  }
};

export const listarMisAlertas = async (req, res) => {
  try {
    const idUsuario = req.usuario.id_usuario;
    const rolUsuario = obtenerRolUsuario(req.usuario);
    const sucursalesUsuario = obtenerSucursalesUsuario(req.usuario);
    const esSuperAdmin = rolUsuario === 'SUPER_ADMIN';

    const resultado = await pool.query(
      `
      SELECT
        a.id_alerta,
        a.titulo,
        a.mensaje,
        a.prioridad,
        a.destino_rol,
        a.id_sucursal,
        s.nombre AS sucursal,
        a.fecha_creacion,
        CASE 
          WHEN al.id_lectura IS NULL THEN false
          ELSE true
        END AS leida
      FROM alertas a
      LEFT JOIN sucursales s ON s.id_sucursal = a.id_sucursal
      LEFT JOIN alertas_lecturas al
        ON al.id_alerta = a.id_alerta
       AND al.id_usuario = $1
      WHERE a.activa = true
        AND (
          a.destino_rol IS NULL
          OR a.destino_rol = 'TODOS'
          OR a.destino_rol = $2
        )
        AND (
          a.id_sucursal IS NULL
          OR $3 = true
          OR a.id_sucursal = ANY($4::int[])
        )
      ORDER BY
        leida ASC,
        a.fecha_creacion DESC
      LIMIT 20
      `,
      [
        idUsuario,
        rolUsuario,
        esSuperAdmin,
        sucursalesUsuario,
      ]
    );

    return res.json({
      ok: true,
      alertas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar mis alertas:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar mis alertas',
    });
  }
};

export const contarAlertasNoLeidas = async (req, res) => {
  try {
    const idUsuario = req.usuario.id_usuario;
    const rolUsuario = obtenerRolUsuario(req.usuario);
    const sucursalesUsuario = obtenerSucursalesUsuario(req.usuario);
    const esSuperAdmin = rolUsuario === 'SUPER_ADMIN';

    const resultado = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM alertas a
      LEFT JOIN alertas_lecturas al
        ON al.id_alerta = a.id_alerta
       AND al.id_usuario = $1
      WHERE a.activa = true
        AND al.id_lectura IS NULL
        AND (
          a.destino_rol IS NULL
          OR a.destino_rol = 'TODOS'
          OR a.destino_rol = $2
        )
        AND (
          a.id_sucursal IS NULL
          OR $3 = true
          OR a.id_sucursal = ANY($4::int[])
        )
      `,
      [
        idUsuario,
        rolUsuario,
        esSuperAdmin,
        sucursalesUsuario,
      ]
    );

    return res.json({
      ok: true,
      total: resultado.rows[0]?.total || 0,
    });
  } catch (error) {
    console.error('Error al contar alertas no leídas:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al contar alertas no leídas',
    });
  }
};

export const marcarAlertaComoLeida = async (req, res) => {
  try {
    const { id } = req.params;
    const idUsuario = req.usuario.id_usuario;

    const alertaExiste = await pool.query(
      `
      SELECT id_alerta
      FROM alertas
      WHERE id_alerta = $1
        AND activa = true
      `,
      [id]
    );

    if (alertaExiste.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Alerta no encontrada',
      });
    }

    await pool.query(
      `
      INSERT INTO alertas_lecturas (
        id_alerta,
        id_usuario
      )
      VALUES ($1, $2)
      ON CONFLICT (id_alerta, id_usuario) DO NOTHING
      `,
      [id, idUsuario]
    );

    return res.json({
      ok: true,
      mensaje: 'Alerta marcada como leída',
    });
  } catch (error) {
    console.error('Error al marcar alerta como leída:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al marcar alerta como leída',
    });
  }
};

export const desactivarAlerta = async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      UPDATE alertas
      SET activa = false
      WHERE id_alerta = $1
      RETURNING *
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Alerta no encontrada',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Alerta desactivada correctamente',
      alerta: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al desactivar alerta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al desactivar alerta',
    });
  }
};