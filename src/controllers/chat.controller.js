import { pool } from '../config/db.js';

const DIAS_HISTORIAL_CHAT = 7;

const obtenerRolUsuario = (usuario) => {
  return String(usuario?.rol || usuario?.perfil || '').toUpperCase();
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

const normalizarTipoDestino = (tipoDestino) => {
  const valor = String(tipoDestino || 'TODOS').toUpperCase();

  const tiposPermitidos = ['TODOS', 'ROL', 'SUCURSAL', 'USUARIO'];

  return tiposPermitidos.includes(valor) ? valor : 'TODOS';
};

const construirFiltroMensajes = () => {
  return `
    cm.activo = true
    AND (
      cm.id_usuario_emisor = $1

      OR cm.tipo_destino = 'TODOS'

      OR (
        cm.tipo_destino = 'ROL'
        AND cm.destino_rol = $2
      )

      OR (
        cm.tipo_destino = 'SUCURSAL'
        AND (
          $3 = true
          OR cm.id_sucursal = ANY($4::int[])
        )
      )

      OR (
        cm.tipo_destino = 'USUARIO'
        AND cm.id_usuario_destino = $1
      )
    )
  `;
};

const construirFiltroHistorialReciente = () => {
  return `
    AND cm.fecha_envio >= NOW() - ($5::int * INTERVAL '1 day')
  `;
};

export const listarMensajesChat = async (req, res) => {
  try {
    const idUsuario = req.usuario.id_usuario;
    const rolUsuario = obtenerRolUsuario(req.usuario);
    const sucursalesUsuario = obtenerSucursalesUsuario(req.usuario);
    const esSuperAdmin = rolUsuario === 'SUPER_ADMIN';

    const resultado = await pool.query(
      `
      SELECT
        cm.id_mensaje,
        cm.id_usuario_emisor,
        u.nombre AS usuario_emisor,
        NULL AS rol_emisor,
        cm.mensaje,
        cm.tipo_destino,
        cm.destino_rol,
        cm.id_sucursal,
        s.nombre AS sucursal,
        cm.id_usuario_destino,
        ud.nombre AS usuario_destino,
        cm.fecha_envio,
        CASE
          WHEN cl.id_lectura IS NULL THEN false
          ELSE true
        END AS leido,
        CASE
          WHEN cm.id_usuario_emisor = $1 THEN true
          ELSE false
        END AS es_mio
      FROM chat_mensajes cm
      INNER JOIN usuarios u 
        ON u.id_usuario = cm.id_usuario_emisor
      LEFT JOIN usuarios ud 
        ON ud.id_usuario = cm.id_usuario_destino
      LEFT JOIN sucursales s 
        ON s.id_sucursal = cm.id_sucursal
      LEFT JOIN chat_lecturas cl
        ON cl.id_mensaje = cm.id_mensaje
       AND cl.id_usuario = $1
      WHERE ${construirFiltroMensajes()}
        ${construirFiltroHistorialReciente()}
      ORDER BY cm.fecha_envio ASC
      LIMIT 150
      `,
      [
        idUsuario,
        rolUsuario,
        esSuperAdmin,
        sucursalesUsuario,
        DIAS_HISTORIAL_CHAT,
      ]
    );

    return res.json({
      ok: true,
      dias_historial: DIAS_HISTORIAL_CHAT,
      mensajes: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar mensajes del chat:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar mensajes del chat',
    });
  }
};

export const contarMensajesNoLeidos = async (req, res) => {
  try {
    const idUsuario = req.usuario.id_usuario;
    const rolUsuario = obtenerRolUsuario(req.usuario);
    const sucursalesUsuario = obtenerSucursalesUsuario(req.usuario);
    const esSuperAdmin = rolUsuario === 'SUPER_ADMIN';

    const resultado = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM chat_mensajes cm
      LEFT JOIN chat_lecturas cl
        ON cl.id_mensaje = cm.id_mensaje
       AND cl.id_usuario = $1
      WHERE ${construirFiltroMensajes()}
        AND cm.id_usuario_emisor <> $1
        AND cl.id_lectura IS NULL
        ${construirFiltroHistorialReciente()}
      `,
      [
        idUsuario,
        rolUsuario,
        esSuperAdmin,
        sucursalesUsuario,
        DIAS_HISTORIAL_CHAT,
      ]
    );

    return res.json({
      ok: true,
      total: resultado.rows[0]?.total || 0,
    });
  } catch (error) {
    console.error('Error al contar mensajes no leídos:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al contar mensajes no leídos',
    });
  }
};

export const enviarMensajeChat = async (req, res) => {
  try {
    const {
      mensaje,
      tipo_destino = 'TODOS',
      destino_rol = null,
      id_sucursal = null,
      id_usuario_destino = null,
    } = req.body;

    if (!mensaje || !mensaje.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El mensaje no puede estar vacío',
      });
    }

    const tipoDestinoNormalizado = normalizarTipoDestino(tipo_destino);

    if (tipoDestinoNormalizado === 'ROL' && !destino_rol) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Debes seleccionar un rol destino',
      });
    }

    if (tipoDestinoNormalizado === 'SUCURSAL' && !id_sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Debes seleccionar una sucursal destino',
      });
    }

    if (tipoDestinoNormalizado === 'USUARIO' && !id_usuario_destino) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Debes seleccionar un usuario destino',
      });
    }

    if (tipoDestinoNormalizado === 'USUARIO') {
      const usuarioDestinoExiste = await pool.query(
        `
        SELECT id_usuario
        FROM usuarios
        WHERE id_usuario = $1
        `,
        [id_usuario_destino]
      );

      if (usuarioDestinoExiste.rows.length === 0) {
        return res.status(404).json({
          ok: false,
          mensaje: 'El usuario destino no existe',
        });
      }
    }

    if (tipoDestinoNormalizado === 'SUCURSAL') {
      const sucursalExiste = await pool.query(
        `
        SELECT id_sucursal
        FROM sucursales
        WHERE id_sucursal = $1
        `,
        [id_sucursal]
      );

      if (sucursalExiste.rows.length === 0) {
        return res.status(404).json({
          ok: false,
          mensaje: 'La sucursal destino no existe',
        });
      }
    }

    const resultado = await pool.query(
      `
      INSERT INTO chat_mensajes (
        id_usuario_emisor,
        mensaje,
        tipo_destino,
        destino_rol,
        id_sucursal,
        id_usuario_destino,
        activo
      )
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING *
      `,
      [
        req.usuario.id_usuario,
        mensaje.trim(),
        tipoDestinoNormalizado,
        tipoDestinoNormalizado === 'ROL'
          ? String(destino_rol).toUpperCase()
          : null,
        tipoDestinoNormalizado === 'SUCURSAL'
          ? Number(id_sucursal)
          : null,
        tipoDestinoNormalizado === 'USUARIO'
          ? Number(id_usuario_destino)
          : null,
      ]
    );

    await pool.query(
      `
      INSERT INTO chat_lecturas (
        id_mensaje,
        id_usuario
      )
      VALUES ($1, $2)
      ON CONFLICT (id_mensaje, id_usuario) DO NOTHING
      `,
      [
        resultado.rows[0].id_mensaje,
        req.usuario.id_usuario,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Mensaje enviado correctamente',
      chat: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al enviar mensaje del chat:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al enviar mensaje del chat',
    });
  }
};

export const marcarMensajesComoLeidos = async (req, res) => {
  try {
    const idUsuario = req.usuario.id_usuario;
    const rolUsuario = obtenerRolUsuario(req.usuario);
    const sucursalesUsuario = obtenerSucursalesUsuario(req.usuario);
    const esSuperAdmin = rolUsuario === 'SUPER_ADMIN';

    await pool.query(
      `
      INSERT INTO chat_lecturas (
        id_mensaje,
        id_usuario
      )
      SELECT
        cm.id_mensaje,
        $1
      FROM chat_mensajes cm
      LEFT JOIN chat_lecturas cl
        ON cl.id_mensaje = cm.id_mensaje
       AND cl.id_usuario = $1
      WHERE ${construirFiltroMensajes()}
        AND cm.id_usuario_emisor <> $1
        AND cl.id_lectura IS NULL
        ${construirFiltroHistorialReciente()}
      ON CONFLICT (id_mensaje, id_usuario) DO NOTHING
      `,
      [
        idUsuario,
        rolUsuario,
        esSuperAdmin,
        sucursalesUsuario,
        DIAS_HISTORIAL_CHAT,
      ]
    );

    return res.json({
      ok: true,
      mensaje: 'Mensajes recientes marcados como leídos',
    });
  } catch (error) {
    console.error('Error al marcar mensajes como leídos:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al marcar mensajes como leídos',
    });
  }
};