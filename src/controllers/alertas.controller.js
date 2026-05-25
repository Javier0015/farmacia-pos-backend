import { pool } from '../config/db.js';

const DIAS_HISTORIAL_ALERTAS = 7;

const obtenerRolUsuario = (usuario) => {
  return String(usuario?.rol || usuario?.perfil || usuario?.nombre_rol || '').toUpperCase();
};

const obtenerSucursalesUsuarioDesdeToken = (usuario) => {
  const ids = [];

  if (usuario?.id_sucursal) {
    ids.push(Number(usuario.id_sucursal));
  }

  if (usuario?.sucursal_id) {
    ids.push(Number(usuario.sucursal_id));
  }

  if (usuario?.sucursal?.id_sucursal) {
    ids.push(Number(usuario.sucursal.id_sucursal));
  }

  if (usuario?.sucursal?.id) {
    ids.push(Number(usuario.sucursal.id));
  }

  const sucursales =
    usuario?.sucursales ||
    usuario?.sucursales_asignadas ||
    usuario?.sucursalesAsignadas ||
    usuario?.sucursales_ids ||
    [];

  if (Array.isArray(sucursales)) {
    sucursales.forEach((sucursal) => {
      if (typeof sucursal === 'number' || typeof sucursal === 'string') {
        ids.push(Number(sucursal));
        return;
      }

      const id =
        sucursal?.id_sucursal ||
        sucursal?.id ||
        sucursal?.sucursal_id;

      if (id) {
        ids.push(Number(id));
      }
    });
  }

  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
};

const obtenerSucursalesUsuario = async (usuario) => {
  const idsDesdeToken = obtenerSucursalesUsuarioDesdeToken(usuario);

  if (idsDesdeToken.length > 0) {
    return idsDesdeToken;
  }

  const idUsuario = usuario?.id_usuario;

  if (!idUsuario) {
    return [];
  }

  const consultas = [
    `
      SELECT id_sucursal
      FROM usuarios_sucursales
      WHERE id_usuario = $1
    `,
    `
      SELECT id_sucursal
      FROM usuario_sucursales
      WHERE id_usuario = $1
    `,
    `
      SELECT id_sucursal
      FROM usuarios
      WHERE id_usuario = $1
        AND id_sucursal IS NOT NULL
    `,
  ];

  for (const consulta of consultas) {
    try {
      const { rows } = await pool.query(consulta, [idUsuario]);

      if (rows.length > 0) {
        return [
          ...new Set(
            rows
              .map((row) => Number(row.id_sucursal))
              .filter((id) => Number.isInteger(id) && id > 0)
          ),
        ];
      }
    } catch (error) {
      // Se ignora para intentar con el siguiente posible nombre de tabla.
    }
  }

  return [];
};

const normalizarPrioridad = (prioridad) => {
  const valor = String(prioridad || 'NORMAL').toUpperCase();

  const prioridadesPermitidas = ['NORMAL', 'IMPORTANTE', 'URGENTE'];

  return prioridadesPermitidas.includes(valor) ? valor : 'NORMAL';
};

const normalizarTipoDestino = (tipoDestino) => {
  const valor = String(tipoDestino || 'TODOS').toUpperCase();

  const tiposPermitidos = [
    'TODOS',
    'ROL',
    'SUCURSAL',
    'ROL_SUCURSAL',
    'USUARIO',
  ];

  return tiposPermitidos.includes(valor) ? valor : 'TODOS';
};

const construirFiltroAlertasUsuario = () => {
  return `
    COALESCE(a.activa, true) = true
    AND (
      a.tipo_destino IS NULL
      OR a.tipo_destino = 'TODOS'

      OR (
        a.tipo_destino = 'ROL'
        AND a.destino_rol = $2
      )

      OR (
        a.tipo_destino = 'SUCURSAL'
        AND (
          $3 = true
          OR a.id_sucursal = ANY($4::int[])
        )
      )

      OR (
        a.tipo_destino = 'ROL_SUCURSAL'
        AND a.destino_rol = $2
        AND (
          $3 = true
          OR a.id_sucursal = ANY($4::int[])
        )
      )

      OR (
        a.tipo_destino = 'USUARIO'
        AND a.id_usuario_destino = $1
      )

      OR (
        a.tipo_destino IS NULL
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
      )
    )
  `;
};

const construirFiltroHistorialReciente = () => {
  return `
    AND a.fecha_creacion >= NOW() - ($5::int * INTERVAL '1 day')
  `;
};

export const crearAlerta = async (req, res) => {
  try {
    const {
      titulo,
      mensaje,
      prioridad = 'NORMAL',
      tipo_destino = 'TODOS',
      destino_rol = null,
      id_sucursal = null,
      id_usuario_destino = null,
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
    const tipoDestinoNormalizado = normalizarTipoDestino(tipo_destino);

    const resultado = await pool.query(
      `
      INSERT INTO alertas (
        titulo,
        mensaje,
        prioridad,
        destino_rol,
        id_sucursal,
        id_usuario_creador,
        activa,
        tipo_destino,
        id_usuario_destino
      )
      VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
      RETURNING *
      `,
      [
        titulo.trim(),
        mensaje.trim(),
        prioridadNormalizada,
        destino_rol ? String(destino_rol).toUpperCase() : null,
        id_sucursal ? Number(id_sucursal) : null,
        req.usuario.id_usuario,
        tipoDestinoNormalizado,
        id_usuario_destino ? Number(id_usuario_destino) : null,
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
      error: error.message,
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
        a.tipo_destino,
        a.id_usuario_destino,
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
      error: error.message,
    });
  }
};

export const listarMisAlertas = async (req, res) => {
  try {
    const idUsuario = req.usuario.id_usuario;
    const rolUsuario = obtenerRolUsuario(req.usuario);
    const sucursalesUsuario = await obtenerSucursalesUsuario(req.usuario);
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
        a.tipo_destino,
        a.id_usuario_destino,
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
      WHERE ${construirFiltroAlertasUsuario()}
        ${construirFiltroHistorialReciente()}
      ORDER BY
        leida ASC,
        a.fecha_creacion DESC
      LIMIT 50
      `,
      [
        idUsuario,
        rolUsuario,
        esSuperAdmin,
        sucursalesUsuario,
        DIAS_HISTORIAL_ALERTAS,
      ]
    );

    return res.json({
      ok: true,
      dias_historial: DIAS_HISTORIAL_ALERTAS,
      alertas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar mis alertas:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar mis alertas',
      error: error.message,
    });
  }
};

export const contarAlertasNoLeidas = async (req, res) => {
  try {
    const idUsuario = req.usuario.id_usuario;
    const rolUsuario = obtenerRolUsuario(req.usuario);
    const sucursalesUsuario = await obtenerSucursalesUsuario(req.usuario);
    const esSuperAdmin = rolUsuario === 'SUPER_ADMIN';

    const resultado = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM alertas a
      LEFT JOIN alertas_lecturas al
        ON al.id_alerta = a.id_alerta
       AND al.id_usuario = $1
      WHERE ${construirFiltroAlertasUsuario()}
        AND al.id_lectura IS NULL
        ${construirFiltroHistorialReciente()}
      `,
      [
        idUsuario,
        rolUsuario,
        esSuperAdmin,
        sucursalesUsuario,
        DIAS_HISTORIAL_ALERTAS,
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
      error: error.message,
    });
  }
};

export const marcarAlertaComoLeida = async (req, res) => {
  try {
    const { id } = req.params;
    const idUsuario = req.usuario.id_usuario;

    const rolUsuario = obtenerRolUsuario(req.usuario);
    const sucursalesUsuario = await obtenerSucursalesUsuario(req.usuario);
    const esSuperAdmin = rolUsuario === 'SUPER_ADMIN';

    const alertaExiste = await pool.query(
      `
      SELECT a.id_alerta
      FROM alertas a
      WHERE a.id_alerta = $1
        AND ${construirFiltroAlertasUsuario()}
      `,
      [
        id,
        rolUsuario,
        esSuperAdmin,
        sucursalesUsuario,
        DIAS_HISTORIAL_ALERTAS,
      ]
    );

    if (alertaExiste.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Alerta no encontrada o no corresponde a tu usuario',
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
      error: error.message,
    });
  }
};

export const marcarTodasAlertasComoLeidas = async (req, res) => {
  try {
    const idUsuario = req.usuario.id_usuario;
    const rolUsuario = obtenerRolUsuario(req.usuario);
    const sucursalesUsuario = await obtenerSucursalesUsuario(req.usuario);
    const esSuperAdmin = rolUsuario === 'SUPER_ADMIN';

    await pool.query(
      `
      INSERT INTO alertas_lecturas (
        id_alerta,
        id_usuario
      )
      SELECT
        a.id_alerta,
        $1
      FROM alertas a
      LEFT JOIN alertas_lecturas al
        ON al.id_alerta = a.id_alerta
       AND al.id_usuario = $1
      WHERE ${construirFiltroAlertasUsuario()}
        AND al.id_lectura IS NULL
        ${construirFiltroHistorialReciente()}
      ON CONFLICT (id_alerta, id_usuario) DO NOTHING
      `,
      [
        idUsuario,
        rolUsuario,
        esSuperAdmin,
        sucursalesUsuario,
        DIAS_HISTORIAL_ALERTAS,
      ]
    );

    return res.json({
      ok: true,
      mensaje: 'Alertas recientes marcadas como leídas',
    });
  } catch (error) {
    console.error('Error al marcar todas las alertas como leídas:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al marcar todas las alertas como leídas',
      error: error.message,
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
      error: error.message,
    });
  }
};