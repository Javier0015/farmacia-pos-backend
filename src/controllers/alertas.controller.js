import { pool } from '../config/db.js';

const DIAS_HISTORIAL_ALERTAS = 7;

const crearErrorHttp = (status, mensaje) => {
  const error = new Error(mensaje);
  error.status = status;
  return error;
};

const obtenerIdUsuario = (usuario) => {
  return Number(usuario?.id_usuario || usuario?.id || 0);
};

const obtenerRolUsuario = (usuario) => {
  return String(
    usuario?.rol ||
      usuario?.perfil ||
      usuario?.nombre_rol ||
      usuario?.tipo_usuario ||
      ''
  )
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
};

const esSuperAdministrador = (rolUsuario) => {
  return rolUsuario === 'SUPER_ADMIN' || rolUsuario === 'SUPERADMIN';
};

const normalizarIdSucursal = (valor) => {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return null;
  }

  const idSucursal = Number(valor);

  return Number.isInteger(idSucursal) && idSucursal > 0 ? idSucursal : null;
};

const obtenerIdSucursalPrincipalDesdeToken = (usuario) => {
  const candidatos = [
    usuario?.id_sucursal,
    usuario?.sucursal_id,
    usuario?.sucursal?.id_sucursal,
    usuario?.sucursal?.id,
  ];

  for (const candidato of candidatos) {
    const idSucursal = normalizarIdSucursal(candidato);

    if (idSucursal) {
      return idSucursal;
    }
  }

  return null;
};

const obtenerSucursalesUsuarioDesdeToken = (usuario) => {
  const ids = [];

  const idSucursalPrincipal = obtenerIdSucursalPrincipalDesdeToken(usuario);

  if (idSucursalPrincipal) {
    ids.push(idSucursalPrincipal);
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
        const idSucursal = normalizarIdSucursal(sucursal);

        if (idSucursal) {
          ids.push(idSucursal);
        }

        return;
      }

      const idSucursal = normalizarIdSucursal(
        sucursal?.id_sucursal || sucursal?.id || sucursal?.sucursal_id
      );

      if (idSucursal) {
        ids.push(idSucursal);
      }
    });
  }

  return [...new Set(ids)];
};

/**
 * Obtiene todas las sucursales disponibles para el usuario.
 *
 * Se combinan las sucursales incluidas en el JWT con las asignadas en la
 * base de datos. No se hace retorno anticipado usando solamente el token,
 * porque un usuario puede estar asignado a más de una sucursal.
 */
const obtenerSucursalesUsuario = async (usuario) => {
  const ids = new Set(obtenerSucursalesUsuarioDesdeToken(usuario));
  const idUsuario = obtenerIdUsuario(usuario);

  if (!idUsuario) {
    return [];
  }

  const consultas = [
    `
      SELECT id_sucursal
      FROM usuario_sucursales
      WHERE id_usuario = $1
        AND COALESCE(activo, true) = true
    `,
    `
      SELECT id_sucursal
      FROM usuarios_sucursales
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

      rows.forEach((row) => {
        const idSucursal = normalizarIdSucursal(row.id_sucursal);

        if (idSucursal) {
          ids.add(idSucursal);
        }
      });
    } catch (error) {
      /*
       * Algunos proyectos usan solo una de las tablas anteriores.
       * Si una tabla no existe, se intenta la siguiente alternativa.
       */
    }
  }

  return [...ids].sort((a, b) => a - b);
};

const obtenerSucursalSolicitada = (req) => {
  const valor =
    req.query?.id_sucursal ??
    req.query?.sucursal ??
    req.body?.id_sucursal ??
    req.body?.sucursal ??
    null;

  const seEnvioSucursal =
    valor !== undefined && valor !== null && String(valor).trim() !== '';

  if (!seEnvioSucursal) {
    return {
      seEnvioSucursal: false,
      idSucursal: null,
    };
  }

  const idSucursal = normalizarIdSucursal(valor);

  if (!idSucursal) {
    throw crearErrorHttp(400, 'La sucursal seleccionada no es válida.');
  }

  return {
    seEnvioSucursal: true,
    idSucursal,
  };
};

/**
 * Determina la sucursal activa para la consulta de alertas.
 *
 * Regla principal:
 * - El frontend debe enviar id_sucursal de la sucursal actualmente seleccionada.
 * - El backend valida que el usuario tenga acceso a esa sucursal.
 * - Cuando no se envía, se usa la sucursal principal del JWT como compatibilidad.
 */
const obtenerContextoAlertas = async (req) => {
  const idUsuario = obtenerIdUsuario(req.usuario);

  if (!idUsuario) {
    throw crearErrorHttp(401, 'No se pudo identificar al usuario autenticado.');
  }

  const rolUsuario = obtenerRolUsuario(req.usuario);
  const esSuperAdmin = esSuperAdministrador(rolUsuario);
  const sucursalesUsuario = await obtenerSucursalesUsuario(req.usuario);
  const sucursalSolicitada = obtenerSucursalSolicitada(req);

  let idSucursalActiva = null;

  if (sucursalSolicitada.seEnvioSucursal) {
    if (
      !esSuperAdmin &&
      !sucursalesUsuario.includes(sucursalSolicitada.idSucursal)
    ) {
      throw crearErrorHttp(
        403,
        'No tienes acceso a la sucursal seleccionada para consultar alertas.'
      );
    }

    idSucursalActiva = sucursalSolicitada.idSucursal;
  } else {
    const idSucursalToken = obtenerIdSucursalPrincipalDesdeToken(req.usuario);

    if (idSucursalToken) {
      idSucursalActiva = idSucursalToken;
    } else if (sucursalesUsuario.length === 1) {
      idSucursalActiva = sucursalesUsuario[0];
    }
  }

  return {
    idUsuario,
    rolUsuario,
    esSuperAdmin,
    idSucursalActiva,
    sucursalesUsuario,
  };
};

const normalizarPrioridad = (prioridad) => {
  const valor = String(prioridad || 'NORMAL').trim().toUpperCase();

  const prioridadesPermitidas = ['NORMAL', 'IMPORTANTE', 'URGENTE'];

  return prioridadesPermitidas.includes(valor) ? valor : 'NORMAL';
};

const normalizarTipoDestino = (tipoDestino) => {
  const valor = String(tipoDestino || 'TODOS').trim().toUpperCase();

  const tiposPermitidos = [
    'TODOS',
    'ROL',
    'SUCURSAL',
    'ROL_SUCURSAL',
    'USUARIO',
  ];

  return tiposPermitidos.includes(valor) ? valor : 'TODOS';
};

const normalizarRolDestino = (rol) => {
  if (rol === undefined || rol === null || String(rol).trim() === '') {
    return null;
  }

  return String(rol)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
};

/**
 * Construye el filtro de alertas visibles para un usuario.
 *
 * Parámetros por defecto:
 * $1 id_usuario
 * $2 rol
 * $3 es_super_admin
 * $4 id_sucursal_activa
 *
 * Se permiten parámetros alternos para evitar colisiones en consultas donde
 * $1 se usa para otro valor, como marcar una alerta específica como leída.
 */
const construirFiltroAlertasUsuario = ({
  idUsuarioParam = '$1',
  rolUsuarioParam = '$2',
  esSuperAdminParam = '$3',
  idSucursalActivaParam = '$4',
} = {}) => {
  return `
    COALESCE(a.activa, true) = true
    AND (
      a.tipo_destino = 'TODOS'

      OR (
        a.tipo_destino = 'ROL'
        AND a.destino_rol = ${rolUsuarioParam}
      )

      OR (
        a.tipo_destino = 'SUCURSAL'
        AND (
          ${esSuperAdminParam} = true
          OR a.id_sucursal = ${idSucursalActivaParam}
        )
      )

      OR (
        a.tipo_destino = 'ROL_SUCURSAL'
        AND a.destino_rol = ${rolUsuarioParam}
        AND (
          ${esSuperAdminParam} = true
          OR a.id_sucursal = ${idSucursalActivaParam}
        )
      )

      OR (
        a.tipo_destino = 'USUARIO'
        AND a.id_usuario_destino = ${idUsuarioParam}
      )

      /*
       * Compatibilidad con alertas antiguas cuyo tipo_destino sea NULL.
       * No se usa "a.tipo_destino IS NULL" por sí solo, porque eso haría
       * visibles las alertas históricas para todas las sucursales.
       */
      OR (
        a.tipo_destino IS NULL
        AND (
          a.destino_rol IS NULL
          OR a.destino_rol = 'TODOS'
          OR a.destino_rol = ${rolUsuarioParam}
        )
        AND (
          a.id_sucursal IS NULL
          OR ${esSuperAdminParam} = true
          OR a.id_sucursal = ${idSucursalActivaParam}
        )
      )
    )
  `;
};

const construirFiltroHistorialReciente = (diasParam = '$5') => {
  return `
    AND a.fecha_creacion >= NOW() - (${diasParam}::int * INTERVAL '1 day')
  `;
};

const validarDestinoAlerta = async ({
  req,
  tipoDestino,
  destinoRol,
  idSucursalDestino,
  idUsuarioDestino,
}) => {
  const contexto = await obtenerContextoAlertas(req);

  if (tipoDestino === 'TODOS' && !contexto.esSuperAdmin) {
    throw crearErrorHttp(
      403,
      'Solo un superadministrador puede crear alertas globales.'
    );
  }

  if (
    ['ROL', 'ROL_SUCURSAL'].includes(tipoDestino) &&
    !destinoRol
  ) {
    throw crearErrorHttp(
      400,
      'Debes indicar el rol destino para este tipo de alerta.'
    );
  }

  if (
    ['SUCURSAL', 'ROL_SUCURSAL'].includes(tipoDestino) &&
    !idSucursalDestino
  ) {
    throw crearErrorHttp(
      400,
      'Debes indicar la sucursal destino para este tipo de alerta.'
    );
  }

  if (tipoDestino === 'USUARIO' && !idUsuarioDestino) {
    throw crearErrorHttp(
      400,
      'Debes indicar el usuario destino para este tipo de alerta.'
    );
  }

  if (
    ['SUCURSAL', 'ROL_SUCURSAL'].includes(tipoDestino) &&
    !contexto.esSuperAdmin &&
    !contexto.sucursalesUsuario.includes(idSucursalDestino)
  ) {
    throw crearErrorHttp(
      403,
      'No tienes permiso para enviar alertas a esa sucursal.'
    );
  }

  return contexto;
};

export const crearAlerta = async (req, res) => {
  try {
    const {
      titulo,
      mensaje,
      prioridad = 'NORMAL',
      tipo_destino,
      destino_tipo,
      destino_rol = null,
      id_sucursal = null,
      id_usuario_destino = null,
    } = req.body;

    if (!titulo || !titulo.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El título de la alerta es obligatorio.',
      });
    }

    if (!mensaje || !mensaje.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El mensaje de la alerta es obligatorio.',
      });
    }

    /*
     * destino_tipo se conserva como compatibilidad con versiones antiguas
     * del frontend. La propiedad oficial es tipo_destino.
     */
    const prioridadNormalizada = normalizarPrioridad(prioridad);
    const tipoDestinoNormalizado = normalizarTipoDestino(
      tipo_destino ?? destino_tipo ?? 'TODOS'
    );

    const destinoRolNormalizado = normalizarRolDestino(destino_rol);
    const idSucursalDestino = normalizarIdSucursal(id_sucursal);
    const idUsuarioDestino = id_usuario_destino
      ? Number(id_usuario_destino)
      : null;

    await validarDestinoAlerta({
      req,
      tipoDestino: tipoDestinoNormalizado,
      destinoRol: destinoRolNormalizado,
      idSucursalDestino,
      idUsuarioDestino,
    });

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
      RETURNING *;
      `,
      [
        titulo.trim(),
        mensaje.trim(),
        prioridadNormalizada,
        ['ROL', 'ROL_SUCURSAL'].includes(tipoDestinoNormalizado)
          ? destinoRolNormalizado
          : null,
        ['SUCURSAL', 'ROL_SUCURSAL'].includes(tipoDestinoNormalizado)
          ? idSucursalDestino
          : null,
        obtenerIdUsuario(req.usuario),
        tipoDestinoNormalizado,
        tipoDestinoNormalizado === 'USUARIO' ? idUsuarioDestino : null,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Alerta creada correctamente.',
      alerta: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al crear alerta:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.message || 'Error interno al crear alerta.',
    });
  }
};

/**
 * Historial administrativo global.
 *
 * Esta ruta debe utilizarse solo en la pantalla administrativa de alertas,
 * no en la campana de notificaciones de los usuarios.
 */
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
        COUNT(al.id_lectura)::int AS total_lecturas
      FROM alertas a
      LEFT JOIN sucursales s
        ON s.id_sucursal = a.id_sucursal
      LEFT JOIN usuarios u
        ON u.id_usuario = a.id_usuario_creador
      LEFT JOIN alertas_lecturas al
        ON al.id_alerta = a.id_alerta
      GROUP BY
        a.id_alerta,
        s.nombre,
        u.nombre
      ORDER BY a.fecha_creacion DESC;
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
      mensaje: 'Error interno al listar alertas.',
    });
  }
};

/**
 * Alertas de la campana del usuario actual.
 *
 * El frontend debe enviar la sucursal que el usuario tiene activa:
 * GET /alertas/mis-alertas?id_sucursal=2
 */
export const listarMisAlertas = async (req, res) => {
  try {
    const contexto = await obtenerContextoAlertas(req);

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
      LEFT JOIN sucursales s
        ON s.id_sucursal = a.id_sucursal
      LEFT JOIN alertas_lecturas al
        ON al.id_alerta = a.id_alerta
       AND al.id_usuario = $1
      WHERE ${construirFiltroAlertasUsuario()}
        ${construirFiltroHistorialReciente()}
      ORDER BY
        leida ASC,
        a.fecha_creacion DESC
      LIMIT 50;
      `,
      [
        contexto.idUsuario,
        contexto.rolUsuario,
        contexto.esSuperAdmin,
        contexto.idSucursalActiva,
        DIAS_HISTORIAL_ALERTAS,
      ]
    );

    return res.json({
      ok: true,
      dias_historial: DIAS_HISTORIAL_ALERTAS,
      id_sucursal_activa: contexto.idSucursalActiva,
      alertas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar mis alertas:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.message || 'Error interno al listar mis alertas.',
    });
  }
};

/**
 * Contador para la campana del usuario actual.
 *
 * El frontend debe enviar la sucursal que el usuario tiene activa:
 * GET /alertas/no-leidas?id_sucursal=2
 */
export const contarAlertasNoLeidas = async (req, res) => {
  try {
    const contexto = await obtenerContextoAlertas(req);

    const resultado = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM alertas a
      LEFT JOIN alertas_lecturas al
        ON al.id_alerta = a.id_alerta
       AND al.id_usuario = $1
      WHERE ${construirFiltroAlertasUsuario()}
        AND al.id_lectura IS NULL
        ${construirFiltroHistorialReciente()};
      `,
      [
        contexto.idUsuario,
        contexto.rolUsuario,
        contexto.esSuperAdmin,
        contexto.idSucursalActiva,
        DIAS_HISTORIAL_ALERTAS,
      ]
    );

    return res.json({
      ok: true,
      id_sucursal_activa: contexto.idSucursalActiva,
      total: resultado.rows[0]?.total || 0,
    });
  } catch (error) {
    console.error('Error al contar alertas no leídas:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.message || 'Error interno al contar alertas no leídas.',
    });
  }
};

export const marcarAlertaComoLeida = async (req, res) => {
  try {
    const idAlerta = Number(req.params.id);

    if (!Number.isInteger(idAlerta) || idAlerta <= 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El identificador de la alerta no es válido.',
      });
    }

    const contexto = await obtenerContextoAlertas(req);

    const alertaExiste = await pool.query(
      `
      SELECT a.id_alerta
      FROM alertas a
      WHERE a.id_alerta = $1
        AND ${construirFiltroAlertasUsuario({
          idUsuarioParam: '$2',
          rolUsuarioParam: '$3',
          esSuperAdminParam: '$4',
          idSucursalActivaParam: '$5',
        })};
      `,
      [
        idAlerta,
        contexto.idUsuario,
        contexto.rolUsuario,
        contexto.esSuperAdmin,
        contexto.idSucursalActiva,
      ]
    );

    if (alertaExiste.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'La alerta no existe o no corresponde a tu usuario y sucursal.',
      });
    }

    await pool.query(
      `
      INSERT INTO alertas_lecturas (
        id_alerta,
        id_usuario
      )
      VALUES ($1, $2)
      ON CONFLICT (id_alerta, id_usuario) DO NOTHING;
      `,
      [idAlerta, contexto.idUsuario]
    );

    return res.json({
      ok: true,
      mensaje: 'Alerta marcada como leída.',
    });
  } catch (error) {
    console.error('Error al marcar alerta como leída:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.message || 'Error interno al marcar alerta como leída.',
    });
  }
};

export const marcarTodasAlertasComoLeidas = async (req, res) => {
  try {
    const contexto = await obtenerContextoAlertas(req);

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
      ON CONFLICT (id_alerta, id_usuario) DO NOTHING;
      `,
      [
        contexto.idUsuario,
        contexto.rolUsuario,
        contexto.esSuperAdmin,
        contexto.idSucursalActiva,
        DIAS_HISTORIAL_ALERTAS,
      ]
    );

    return res.json({
      ok: true,
      mensaje: 'Alertas recientes de la sucursal activa marcadas como leídas.',
    });
  } catch (error) {
    console.error('Error al marcar todas las alertas como leídas:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje:
        error.message ||
        'Error interno al marcar todas las alertas como leídas.',
    });
  }
};

export const desactivarAlerta = async (req, res) => {
  try {
    const idAlerta = Number(req.params.id);

    if (!Number.isInteger(idAlerta) || idAlerta <= 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El identificador de la alerta no es válido.',
      });
    }

    const resultado = await pool.query(
      `
      UPDATE alertas
      SET activa = false
      WHERE id_alerta = $1
      RETURNING *;
      `,
      [idAlerta]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Alerta no encontrada.',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Alerta desactivada correctamente.',
      alerta: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al desactivar alerta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al desactivar alerta.',
    });
  }
};
