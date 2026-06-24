import nodemailer from 'nodemailer';
import { pool } from '../config/db.js';
import {
  cifrarPasswordSmtp,
  descifrarPasswordSmtp,
} from '../utils/cifradoSmtp.js';

const CONFIGURACION_CORREO_DEFAULT = {
  activo: true,
  enviar_ticket_automatico: false,

  nombre_remitente: 'Farmacias Shaddai',
  correo_remitente: '',

  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_require_tls: true,

  smtp_usuario: '',
};

const esCorreoValido = (correo = '') => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(correo).trim());
};

const normalizarTexto = (valor, maximo = 255) => {
  return String(valor ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximo);
};

const normalizarBooleano = (valor, valorDefault = false) => {
  if (valor === undefined || valor === null) return valorDefault;

  if (typeof valor === 'boolean') return valor;

  if (typeof valor === 'string') {
    const texto = valor.trim().toLowerCase();

    if (['true', '1', 'si', 'sí', 's'].includes(texto)) return true;
    if (['false', '0', 'no', 'n'].includes(texto)) return false;
  }

  if (typeof valor === 'number') return valor === 1;

  return Boolean(valor);
};

const normalizarPuerto = (valor, valorDefault = 587) => {
  if (valor === undefined || valor === null || valor === '') {
    return valorDefault;
  }

  const puerto = Number(valor);

  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
    throw new Error('El puerto SMTP debe ser un número entre 1 y 65535.');
  }

  return puerto;
};

const normalizarIdSucursal = (valor) => {
  if (valor === undefined || valor === null || valor === '') {
    return null;
  }

  const idSucursal = Number(valor);

  if (!Number.isInteger(idSucursal) || idSucursal <= 0) {
    throw new Error('El id_sucursal debe ser un número entero válido.');
  }

  return idSucursal;
};

const normalizarConfiguracionCorreo = (
  configuracionEntrada = {},
  configuracionActual = {}
) => {
  const combinada = {
    ...CONFIGURACION_CORREO_DEFAULT,
    ...(configuracionActual || {}),
    ...(configuracionEntrada || {}),
  };

  return {
    activo: normalizarBooleano(
      combinada.activo,
      CONFIGURACION_CORREO_DEFAULT.activo
    ),

    enviar_ticket_automatico: normalizarBooleano(
      combinada.enviar_ticket_automatico,
      CONFIGURACION_CORREO_DEFAULT.enviar_ticket_automatico
    ),

    nombre_remitente:
      normalizarTexto(combinada.nombre_remitente, 150) ||
      CONFIGURACION_CORREO_DEFAULT.nombre_remitente,

    correo_remitente: normalizarTexto(
      combinada.correo_remitente,
      150
    ).toLowerCase(),

    smtp_host: normalizarTexto(combinada.smtp_host, 255),

    smtp_port: normalizarPuerto(
      combinada.smtp_port,
      CONFIGURACION_CORREO_DEFAULT.smtp_port
    ),

    smtp_secure: normalizarBooleano(
      combinada.smtp_secure,
      CONFIGURACION_CORREO_DEFAULT.smtp_secure
    ),

    smtp_require_tls: normalizarBooleano(
      combinada.smtp_require_tls,
      CONFIGURACION_CORREO_DEFAULT.smtp_require_tls
    ),

    smtp_usuario: normalizarTexto(combinada.smtp_usuario, 255),
  };
};

const buscarConfiguracionExacta = async (idSucursal) => {
  const resultado = await pool.query(
    `
    SELECT
      id_configuracion_correo,
      id_sucursal,
      activo,
      enviar_ticket_automatico,
      nombre_remitente,
      correo_remitente,
      smtp_host,
      smtp_port,
      smtp_secure,
      smtp_require_tls,
      smtp_usuario,
      smtp_password_cifrada,
      fecha_creacion,
      fecha_actualizacion
    FROM configuracion_correo_smtp
    WHERE id_sucursal IS NOT DISTINCT FROM $1
    LIMIT 1
    `,
    [idSucursal]
  );

  return resultado.rows[0] || null;
};

const validarSucursalExiste = async (idSucursal) => {
  if (!idSucursal) return true;

  const resultado = await pool.query(
    `
    SELECT id_sucursal
    FROM sucursales
    WHERE id_sucursal = $1
    LIMIT 1
    `,
    [idSucursal]
  );

  if (resultado.rows.length === 0) {
    throw new Error('La sucursal indicada no existe.');
  }

  return true;
};

const prepararRespuestaPublica = (
  registro = null,
  origenConfiguracion = 'SIN_CONFIGURACION'
) => {
  if (!registro) {
    return {
      id_configuracion_correo: null,
      id_sucursal: null,
      ...CONFIGURACION_CORREO_DEFAULT,
      password_configurada: false,
      origen_configuracion: origenConfiguracion,
      fecha_creacion: null,
      fecha_actualizacion: null,
    };
  }

  const {
    smtp_password_cifrada,
    ...configuracionPublica
  } = registro;

  return {
    ...configuracionPublica,
    password_configurada: Boolean(smtp_password_cifrada),
    origen_configuracion: origenConfiguracion,
  };
};

const validarConfiguracionActiva = (
  configuracion,
  tienePasswordConfigurada
) => {
  if (
    configuracion.enviar_ticket_automatico &&
    !configuracion.activo
  ) {
    throw new Error(
      'No puedes activar el envío automático si el servicio de correo está desactivado.'
    );
  }

  if (!configuracion.activo) return;

  const faltantes = [];

  if (!configuracion.nombre_remitente) {
    faltantes.push('nombre del remitente');
  }

  if (!configuracion.correo_remitente) {
    faltantes.push('correo remitente');
  }

  if (!configuracion.smtp_host) {
    faltantes.push('servidor SMTP');
  }

  if (!configuracion.smtp_usuario) {
    faltantes.push('usuario SMTP');
  }

  if (faltantes.length > 0) {
    throw new Error(
      `Faltan datos SMTP obligatorios: ${faltantes.join(', ')}.`
    );
  }

  if (!esCorreoValido(configuracion.correo_remitente)) {
    throw new Error('El correo remitente no tiene un formato válido.');
  }

  if (!tienePasswordConfigurada) {
    throw new Error(
      'Debes capturar la contraseña SMTP para activar esta configuración.'
    );
  }
};

const resolverConfiguracionCorreo = async (idSucursal) => {
  if (idSucursal) {
    const configuracionSucursal = await buscarConfiguracionExacta(idSucursal);

    if (configuracionSucursal?.activo) {
      return {
        registro: configuracionSucursal,
        origen: 'SUCURSAL',
      };
    }
  }

  const configuracionGlobal = await buscarConfiguracionExacta(null);

  if (configuracionGlobal?.activo) {
    return {
      registro: configuracionGlobal,
      origen: 'GLOBAL',
    };
  }

  return {
    registro: null,
    origen: 'SIN_CONFIGURACION',
  };
};

const crearTransporter = (configuracion) => {
  if (!configuracion?.smtp_password_cifrada) {
    throw new Error(
      'La configuración SMTP no tiene una contraseña registrada.'
    );
  }

  const passwordSmtp = descifrarPasswordSmtp(
    configuracion.smtp_password_cifrada
  );

  return nodemailer.createTransport({
    host: configuracion.smtp_host,
    port: Number(configuracion.smtp_port || 587),
    secure: Boolean(configuracion.smtp_secure),
    requireTLS: Boolean(configuracion.smtp_require_tls),

    auth: {
      user: configuracion.smtp_usuario,
      pass: passwordSmtp,
    },

    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
};

export const obtenerConfiguracionCorreoSmtp = async (req, res) => {
  try {
    const idSucursal = normalizarIdSucursal(req.query.id_sucursal);

    const { registro, origen } =
      await resolverConfiguracionCorreo(idSucursal);

    return res.json({
      ok: true,
      configuracion: prepararRespuestaPublica(registro, origen),
    });
  } catch (error) {
    console.error('Error al obtener configuración SMTP:', error);

    return res.status(400).json({
      ok: false,
      mensaje:
        error.message ||
        'No se pudo obtener la configuración de correo.',
    });
  }
};

export const actualizarConfiguracionCorreoSmtp = async (req, res) => {
  try {
    const body = req.body || {};

    const idSucursal = normalizarIdSucursal(body.id_sucursal);

    await validarSucursalExiste(idSucursal);

    const {
      id_sucursal,
      smtp_password,
      smtp_password_cifrada,
      fecha_creacion,
      fecha_actualizacion,
      ...camposConfiguracion
    } = body;

    const configuracionExistente =
      await buscarConfiguracionExacta(idSucursal);

    /*
     * Si se crea una configuración exclusiva de sucursal, toma como base
     * la configuración global para conservar los datos y contraseña SMTP.
     */
    const configuracionGlobal =
      idSucursal && !configuracionExistente
        ? await buscarConfiguracionExacta(null)
        : null;

    const configuracionBase =
      configuracionExistente || configuracionGlobal || {};

    const configuracionNormalizada = normalizarConfiguracionCorreo(
      camposConfiguracion,
      configuracionBase
    );

    const passwordEntrada =
      smtp_password === undefined || smtp_password === null
        ? null
        : String(smtp_password);

    const hayNuevaPassword =
      passwordEntrada !== null &&
      passwordEntrada.trim().length > 0;

    const passwordCifradaFinal = hayNuevaPassword
      ? cifrarPasswordSmtp(passwordEntrada)
      : configuracionBase.smtp_password_cifrada || null;

    validarConfiguracionActiva(
      configuracionNormalizada,
      Boolean(passwordCifradaFinal)
    );

    let resultado;

    if (configuracionExistente) {
      resultado = await pool.query(
        `
        UPDATE configuracion_correo_smtp
        SET
          activo = $1,
          enviar_ticket_automatico = $2,
          nombre_remitente = $3,
          correo_remitente = $4,
          smtp_host = $5,
          smtp_port = $6,
          smtp_secure = $7,
          smtp_require_tls = $8,
          smtp_usuario = $9,
          smtp_password_cifrada = $10,
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_configuracion_correo = $11
        RETURNING
          id_configuracion_correo,
          id_sucursal,
          activo,
          enviar_ticket_automatico,
          nombre_remitente,
          correo_remitente,
          smtp_host,
          smtp_port,
          smtp_secure,
          smtp_require_tls,
          smtp_usuario,
          smtp_password_cifrada,
          fecha_creacion,
          fecha_actualizacion
        `,
        [
          configuracionNormalizada.activo,
          configuracionNormalizada.enviar_ticket_automatico,
          configuracionNormalizada.nombre_remitente,
          configuracionNormalizada.correo_remitente,
          configuracionNormalizada.smtp_host,
          configuracionNormalizada.smtp_port,
          configuracionNormalizada.smtp_secure,
          configuracionNormalizada.smtp_require_tls,
          configuracionNormalizada.smtp_usuario,
          passwordCifradaFinal,
          configuracionExistente.id_configuracion_correo,
        ]
      );
    } else {
      resultado = await pool.query(
        `
        INSERT INTO configuracion_correo_smtp (
          id_sucursal,
          activo,
          enviar_ticket_automatico,
          nombre_remitente,
          correo_remitente,
          smtp_host,
          smtp_port,
          smtp_secure,
          smtp_require_tls,
          smtp_usuario,
          smtp_password_cifrada,
          fecha_creacion,
          fecha_actualizacion
        )
        VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,
          $11,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING
          id_configuracion_correo,
          id_sucursal,
          activo,
          enviar_ticket_automatico,
          nombre_remitente,
          correo_remitente,
          smtp_host,
          smtp_port,
          smtp_secure,
          smtp_require_tls,
          smtp_usuario,
          smtp_password_cifrada,
          fecha_creacion,
          fecha_actualizacion
        `,
        [
          idSucursal,
          configuracionNormalizada.activo,
          configuracionNormalizada.enviar_ticket_automatico,
          configuracionNormalizada.nombre_remitente,
          configuracionNormalizada.correo_remitente,
          configuracionNormalizada.smtp_host,
          configuracionNormalizada.smtp_port,
          configuracionNormalizada.smtp_secure,
          configuracionNormalizada.smtp_require_tls,
          configuracionNormalizada.smtp_usuario,
          passwordCifradaFinal,
        ]
      );
    }

    const registro = resultado.rows[0];

    return res.json({
      ok: true,
      mensaje: 'Configuración de correo actualizada correctamente.',
      configuracion: prepararRespuestaPublica(
        registro,
        idSucursal ? 'SUCURSAL' : 'GLOBAL'
      ),
    });
  } catch (error) {
    console.error('Error al actualizar configuración SMTP:', error);

    return res.status(400).json({
      ok: false,
      mensaje:
        error.message ||
        'No se pudo actualizar la configuración de correo.',
    });
  }
};

export const probarConfiguracionCorreoSmtp = async (req, res) => {
  try {
    const body = req.body || {};

    const idSucursal = normalizarIdSucursal(body.id_sucursal);
    const correoDestino = normalizarTexto(
      body.correo_destino,
      150
    ).toLowerCase();

    if (!correoDestino || !esCorreoValido(correoDestino)) {
      throw new Error(
        'Debes indicar un correo de destino válido para la prueba.'
      );
    }

    const { registro, origen } =
      await resolverConfiguracionCorreo(idSucursal);

    if (!registro) {
      throw new Error(
        'No existe una configuración SMTP activa para esta sucursal.'
      );
    }

    const transporter = crearTransporter(registro);

    await transporter.verify();

    const info = await transporter.sendMail({
      from: {
        name: registro.nombre_remitente,
        address: registro.correo_remitente,
      },
      to: correoDestino,
      subject: 'Prueba de ticket digital - Farmacias Shaddai',
      text: [
        `Hola.`,
        ``,
        `Esta es una prueba de la configuración SMTP de Farmacias Shaddai.`,
        `Origen de configuración: ${origen}.`,
        ``,
        `Si recibiste este correo, el envío de tickets digitales está listo para integrarse al POS.`,
      ].join('\n'),

      html: `
        <div style="font-family:Arial,sans-serif;color:#1f2937;max-width:600px;margin:auto;padding:24px">
          <h2 style="margin:0 0 16px;color:#0369a1">
            Farmacias Shaddai
          </h2>

          <p>Hola.</p>

          <p>
            Esta es una prueba de la configuración SMTP para el envío
            de tickets digitales.
          </p>

          <p>
            <strong>Origen de configuración:</strong> ${origen}
          </p>

          <p>
            Si recibiste este correo, la configuración funciona correctamente.
          </p>
        </div>
      `,
    });

    return res.json({
      ok: true,
      mensaje: 'Correo de prueba enviado correctamente.',
      message_id: info.messageId,
      correo_destino: correoDestino,
      origen_configuracion: origen,
    });
  } catch (error) {
    console.error('Error al enviar correo SMTP de prueba:', error);

    return res.status(400).json({
      ok: false,
      mensaje:
        error.message ||
        'No se pudo enviar el correo de prueba.',
    });
  }
};