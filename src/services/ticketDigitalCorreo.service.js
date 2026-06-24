import nodemailer from 'nodemailer';

import { pool } from '../config/db.js';
import { descifrarPasswordSmtp } from '../utils/cifradoSmtp.js';

const CONFIGURACION_TICKET_DEFAULT = {
  nombre_negocio: 'FARMACIAS SHADDAI',
  encabezado: [],
  rfc: '',
  direccion: '',
  telefono: '',
  pie_ticket: [
    '*** GRACIAS POR SU COMPRA ***',
    'CONSERVE SU TICKET PARA CUALQUIER DUDA O ACLARACIÓN',
  ],
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

const escaparHtml = (valor = '') => {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const formatearMoneda = (valor) => {
  return Number(valor || 0).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  });
};

const formatearCantidad = (valor) => {
  return Number(valor || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

const formatearFecha = (valor) => {
  const fecha = valor ? new Date(valor) : new Date();

  if (Number.isNaN(fecha.getTime())) {
    return new Date().toLocaleString('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  return fecha.toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const normalizarLineas = (valor, limite = 8) => {
  const lineas = Array.isArray(valor)
    ? valor
    : String(valor ?? '').replace(/\r\n/g, '\n').split('\n');

  return lineas
    .slice(0, limite)
    .map((linea) => String(linea ?? '').slice(0, 160));
};

const buscarConfiguracionCorreoExacta = async (idSucursal) => {
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
      smtp_password_cifrada
    FROM configuracion_correo_smtp
    WHERE id_sucursal IS NOT DISTINCT FROM $1
      AND activo = true
    LIMIT 1
    `,
    [idSucursal]
  );

  return resultado.rows[0] || null;
};

const resolverConfiguracionCorreo = async (idSucursal) => {
  const idSucursalNumerico = Number(idSucursal || 0);

  if (Number.isInteger(idSucursalNumerico) && idSucursalNumerico > 0) {
    const configuracionSucursal = await buscarConfiguracionCorreoExacta(
      idSucursalNumerico
    );

    if (configuracionSucursal) {
      return {
        configuracion: configuracionSucursal,
        origen_configuracion: 'SUCURSAL',
      };
    }
  }

  const configuracionGlobal = await buscarConfiguracionCorreoExacta(null);

  if (configuracionGlobal) {
    return {
      configuracion: configuracionGlobal,
      origen_configuracion: 'GLOBAL',
    };
  }

  return {
    configuracion: null,
    origen_configuracion: 'SIN_CONFIGURACION',
  };
};

const buscarConfiguracionTicketExacta = async (idSucursal) => {
  const resultado = await pool.query(
    `
    SELECT
      id_sucursal,
      configuracion
    FROM configuracion_ticket
    WHERE id_sucursal IS NOT DISTINCT FROM $1
      AND activo = true
    LIMIT 1
    `,
    [idSucursal]
  );

  return resultado.rows[0] || null;
};

const resolverConfiguracionTicket = async (idSucursal) => {
  const idSucursalNumerico = Number(idSucursal || 0);

  if (Number.isInteger(idSucursalNumerico) && idSucursalNumerico > 0) {
    const configuracionSucursal = await buscarConfiguracionTicketExacta(
      idSucursalNumerico
    );

    if (configuracionSucursal?.configuracion) {
      return {
        ...CONFIGURACION_TICKET_DEFAULT,
        ...configuracionSucursal.configuracion,
      };
    }
  }

  const configuracionGlobal = await buscarConfiguracionTicketExacta(null);

  return {
    ...CONFIGURACION_TICKET_DEFAULT,
    ...(configuracionGlobal?.configuracion || {}),
  };
};

const obtenerDatosOperativosVenta = async ({
  idSucursal,
  idCaja,
  idUsuario,
}) => {
  const resultado = await pool.query(
    `
    SELECT
      s.nombre AS sucursal,
      c.nombre AS caja,
      u.nombre AS cajero
    FROM sucursales s
    LEFT JOIN cajas c
      ON c.id_caja = $2
    LEFT JOIN usuarios u
      ON u.id_usuario = $3
    WHERE s.id_sucursal = $1
    LIMIT 1
    `,
    [idSucursal, idCaja || null, idUsuario || null]
  );

  return resultado.rows[0] || {
    sucursal: null,
    caja: null,
    cajero: null,
  };
};

const crearTransporter = (configuracion) => {
  const host = normalizarTexto(configuracion?.smtp_host, 255);
  const usuario = normalizarTexto(configuracion?.smtp_usuario, 255);
  const passwordCifrada = String(
    configuracion?.smtp_password_cifrada || ''
  ).trim();

  if (!host || !usuario || !passwordCifrada) {
    throw new Error(
      'La configuración SMTP activa está incompleta. Revisa servidor, usuario y contraseña.'
    );
  }

  const password = descifrarPasswordSmtp(passwordCifrada);

  return nodemailer.createTransport({
    host,
    port: Number(configuracion.smtp_port || 587),
    secure: Boolean(configuracion.smtp_secure),
    requireTLS: Boolean(configuracion.smtp_require_tls),
    auth: {
      user: usuario,
      pass: password,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
};

const crearFilasProductosHtml = (productos = [], servicios = []) => {
  const filas = [];

  for (const producto of productos) {
    filas.push({
      tipo: 'Producto',
      nombre: producto?.nombre || producto?.producto || 'Producto',
      cantidad: producto?.cantidad || 0,
      precio_unitario: producto?.precio_unitario ?? producto?.precio_venta ?? 0,
      subtotal: producto?.subtotal || 0,
    });
  }

  for (const servicio of servicios) {
    filas.push({
      tipo: 'Servicio',
      nombre:
        servicio?.nombre_servicio ||
        servicio?.nombre ||
        'Servicio clínico',
      cantidad: servicio?.cantidad || 0,
      precio_unitario:
        servicio?.precio_unitario ?? servicio?.precio_venta ?? 0,
      subtotal: servicio?.subtotal || 0,
    });
  }

  if (filas.length === 0) {
    return `
      <tr>
        <td colspan="4" style="padding:12px;color:#64748b;text-align:center">
          No hay artículos disponibles para mostrar.
        </td>
      </tr>
    `;
  }

  return filas
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;color:#334155">
            ${escaparHtml(item.tipo)}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;color:#0f172a">
            ${escaparHtml(item.nombre)}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;text-align:center;color:#334155">
            ${escaparHtml(formatearCantidad(item.cantidad))}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-weight:600">
            ${escaparHtml(formatearMoneda(item.subtotal))}
          </td>
        </tr>
      `
    )
    .join('');
};

const crearFilasPagosHtml = (pagos = []) => {
  if (!Array.isArray(pagos) || pagos.length === 0) {
    return '';
  }

  const filas = pagos
    .filter((pago) => Number(pago?.monto || 0) > 0)
    .map(
      (pago) => `
        <tr>
          <td style="padding:6px 0;color:#475569">
            ${escaparHtml(String(pago.metodo_pago || 'PAGO').toUpperCase())}
          </td>
          <td style="padding:6px 0;text-align:right;color:#0f172a;font-weight:600">
            ${escaparHtml(formatearMoneda(pago.monto))}
          </td>
        </tr>
      `
    )
    .join('');

  if (!filas) return '';

  return `
    <div style="margin-top:22px">
      <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a">
        Pagos
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
};

const crearTicketDigitalHtml = ({
  configuracionTicket,
  datosOperativos,
  tarjeta,
  venta,
  productos,
  servicios,
  pagos,
  resumen,
}) => {
  const nombreNegocio =
    normalizarTexto(configuracionTicket?.nombre_negocio, 120) ||
    'FARMACIAS SHADDAI';

  const encabezado = normalizarLineas(
    configuracionTicket?.encabezado,
    6
  ).filter((linea) => linea.trim());

  const pieTicket = normalizarLineas(
    configuracionTicket?.pie_ticket,
    8
  ).filter((linea) => linea.trim());

  const subtotal = Number(
    resumen?.subtotal ??
      venta?.subtotal ??
      0
  );

  const descuento = Number(
    resumen?.descuento ??
      venta?.descuento ??
      0
  );

  const descuentoOfertas = Number(
    resumen?.descuento_ofertas ??
      venta?.descuento_ofertas ??
      0
  );

  const impuesto = Number(
    resumen?.impuesto ??
      venta?.impuesto ??
      0
  );

  const total = Number(
    resumen?.total ??
      venta?.total ??
      0
  );

  const puntosGanados = Number(
    resumen?.puntos_ganados_cliente ??
      resumen?.puntos_ganados ??
      venta?.puntos_ganados ??
      0
  );

  const puntosUsados = Number(
    resumen?.puntos_usados ??
      venta?.puntos_usados ??
      0
  );

  const cambio = Number(
    resumen?.cambio ??
      venta?.cambio ??
      0
  );

  const ahorroTotal = descuento + descuentoOfertas;

  const datosContacto = [
    configuracionTicket?.rfc
      ? `<div>RFC: ${escaparHtml(configuracionTicket.rfc)}</div>`
      : '',
    configuracionTicket?.direccion
      ? `<div>${escaparHtml(configuracionTicket.direccion)}</div>`
      : '',
    configuracionTicket?.telefono
      ? `<div>Tel. ${escaparHtml(configuracionTicket.telefono)}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const datosCabeceraExtra = encabezado
    .map((linea) => `<div>${escaparHtml(linea)}</div>`)
    .join('');

  const pieHtml = pieTicket
    .map((linea) => `<div>${escaparHtml(linea)}</div>`)
    .join('');

  const puntosHtml = tarjeta
    ? `
      <div style="margin-top:22px;border-radius:10px;background:#eff6ff;padding:14px">
        <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1d4ed8">
          Tarjeta de fidelidad
        </p>
        <p style="margin:0;color:#1e3a8a;font-size:13px">
          Cliente: <strong>${escaparHtml(tarjeta.nombre_cliente || 'Cliente')}</strong>
        </p>
        <p style="margin:6px 0 0;color:#1e3a8a;font-size:13px">
          Puntos ganados: <strong>${escaparHtml(formatearCantidad(puntosGanados))}</strong>
          ${puntosUsados > 0 ? ` · Puntos usados: <strong>${escaparHtml(formatearCantidad(puntosUsados))}</strong>` : ''}
        </p>
        <p style="margin:6px 0 0;color:#1e3a8a;font-size:13px">
          Puntos actuales: <strong>${escaparHtml(formatearCantidad(tarjeta.puntos_actuales || 0))}</strong>
        </p>
      </div>
    `
    : '';

  return `
    <!doctype html>
    <html lang="es">
      <body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
        <div style="max-width:680px;margin:0 auto;padding:24px 12px">
          <div style="overflow:hidden;border-radius:16px;background:#ffffff;box-shadow:0 10px 25px rgba(15,23,42,.10)">
            <div style="padding:26px 24px;background:linear-gradient(135deg,#0369a1,#1d4ed8);color:#ffffff;text-align:center">
              <h1 style="margin:0;font-size:25px;line-height:1.3">${escaparHtml(nombreNegocio)}</h1>
              ${datosOperativos?.sucursal ? `<p style="margin:8px 0 0;font-size:14px;opacity:.92">${escaparHtml(datosOperativos.sucursal)}</p>` : ''}
              ${datosCabeceraExtra ? `<div style="margin-top:12px;font-size:13px;line-height:1.55;opacity:.95">${datosCabeceraExtra}</div>` : ''}
            </div>

            <div style="padding:24px">
              <div style="text-align:center;color:#475569;font-size:13px;line-height:1.6">
                ${datosContacto}
              </div>

              <div style="margin-top:22px;border-radius:10px;background:#f8fafc;padding:14px;font-size:14px;line-height:1.7">
                <div><strong>Folio:</strong> ${escaparHtml(venta?.folio || 'N/A')}</div>
                <div><strong>Fecha:</strong> ${escaparHtml(formatearFecha(venta?.fecha_venta || new Date()))}</div>
                ${datosOperativos?.caja ? `<div><strong>Caja:</strong> ${escaparHtml(datosOperativos.caja)}</div>` : ''}
                ${datosOperativos?.cajero ? `<div><strong>Cajero:</strong> ${escaparHtml(datosOperativos.cajero)}</div>` : ''}
              </div>

              <h2 style="margin:24px 0 10px;font-size:17px;color:#0f172a">
                Detalle de compra
              </h2>

              <div style="overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                  <thead>
                    <tr style="background:#e0f2fe;color:#0c4a6e">
                      <th style="padding:10px 8px;text-align:left">Tipo</th>
                      <th style="padding:10px 8px;text-align:left">Descripción</th>
                      <th style="padding:10px 8px;text-align:center">Cant.</th>
                      <th style="padding:10px 8px;text-align:right">Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${crearFilasProductosHtml(productos, servicios)}
                  </tbody>
                </table>
              </div>

              <div style="margin:22px 0 0 auto;max-width:330px">
                <table style="width:100%;border-collapse:collapse;font-size:14px">
                  <tbody>
                    <tr>
                      <td style="padding:5px 0;color:#475569">Subtotal</td>
                      <td style="padding:5px 0;text-align:right">${escaparHtml(formatearMoneda(subtotal))}</td>
                    </tr>
                    ${ahorroTotal > 0 ? `
                      <tr>
                        <td style="padding:5px 0;color:#15803d">Descuentos / ahorro</td>
                        <td style="padding:5px 0;text-align:right;color:#15803d">-${escaparHtml(formatearMoneda(ahorroTotal))}</td>
                      </tr>
                    ` : ''}
                    ${impuesto > 0 ? `
                      <tr>
                        <td style="padding:5px 0;color:#475569">Impuesto</td>
                        <td style="padding:5px 0;text-align:right">${escaparHtml(formatearMoneda(impuesto))}</td>
                      </tr>
                    ` : ''}
                    <tr>
                      <td style="padding:11px 0 0;font-size:18px;font-weight:800;color:#0f172a">Total</td>
                      <td style="padding:11px 0 0;text-align:right;font-size:18px;font-weight:800;color:#0f172a">${escaparHtml(formatearMoneda(total))}</td>
                    </tr>
                    ${cambio > 0 ? `
                      <tr>
                        <td style="padding:8px 0 0;color:#475569">Cambio</td>
                        <td style="padding:8px 0 0;text-align:right">${escaparHtml(formatearMoneda(cambio))}</td>
                      </tr>
                    ` : ''}
                  </tbody>
                </table>
              </div>

              ${crearFilasPagosHtml(pagos)}
              ${puntosHtml}

              <div style="margin-top:28px;padding-top:18px;border-top:1px solid #e2e8f0;text-align:center;color:#64748b;font-size:13px;line-height:1.6">
                ${pieHtml || '<div>Gracias por su compra.</div>'}
                <div style="margin-top:10px;font-size:11px">
                  Este correo es un comprobante digital de compra y no sustituye una factura fiscal.
                </div>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
};

export const enviarTicketDigitalVenta = async ({
  idSucursal,
  tarjeta,
  venta,
  productos = [],
  servicios = [],
  pagos = [],
  resumen = {},
}) => {
  try {
    const correoDestino = normalizarTexto(tarjeta?.correo, 150).toLowerCase();

    if (!tarjeta?.id_tarjeta) {
      return {
        solicitado: true,
        enviado: false,
        estatus: 'OMITIDO_SIN_TARJETA',
        mensaje:
          'No se envió el ticket digital porque la venta no tiene una tarjeta de fidelidad vinculada.',
      };
    }

    if (!correoDestino || !esCorreoValido(correoDestino)) {
      return {
        solicitado: true,
        enviado: false,
        estatus: 'OMITIDO_SIN_CORREO',
        mensaje:
          'No se envió el ticket digital porque la tarjeta vinculada no tiene un correo válido.',
      };
    }

    const { configuracion, origen_configuracion } =
      await resolverConfiguracionCorreo(idSucursal);

    if (!configuracion) {
      return {
        solicitado: true,
        enviado: false,
        estatus: 'OMITIDO_SIN_CONFIGURACION',
        mensaje:
          'No se envió el ticket digital porque no existe una configuración SMTP activa para la sucursal.',
        correo_destino: correoDestino,
      };
    }

    const configuracionTicket = await resolverConfiguracionTicket(idSucursal);

    const datosOperativos = await obtenerDatosOperativosVenta({
      idSucursal,
      idCaja: venta?.id_caja,
      idUsuario: venta?.id_usuario,
    });

    const transporter = crearTransporter(configuracion);

    const html = crearTicketDigitalHtml({
      configuracionTicket,
      datosOperativos,
      tarjeta,
      venta,
      productos,
      servicios,
      pagos,
      resumen,
    });

    const info = await transporter.sendMail({
      from: {
        name: configuracion.nombre_remitente,
        address: configuracion.correo_remitente,
      },
      to: correoDestino,
      subject: `${configuracionTicket.nombre_negocio || 'Farmacias Shaddai'} | Ticket ${venta?.folio || ''}`.trim(),
      text: [
        `Hola ${tarjeta?.nombre_cliente || ''}`.trim(),
        '',
        'Gracias por tu compra.',
        `Folio: ${venta?.folio || 'N/A'}`,
        `Fecha: ${formatearFecha(venta?.fecha_venta || new Date())}`,
        `Total: ${formatearMoneda(resumen?.total ?? venta?.total ?? 0)}`,
        '',
        'Consulta el detalle completo de tu compra en la versión HTML de este correo.',
      ].join('\n'),
      html,
    });

    return {
      solicitado: true,
      enviado: true,
      estatus: 'ENVIADO',
      mensaje: 'Ticket digital enviado correctamente.',
      correo_destino: correoDestino,
      origen_configuracion,
      message_id: info.messageId,
    };
  } catch (error) {
    console.error(
      `Error al enviar ticket digital de la venta ${venta?.folio || 'N/A'}:`,
      error
    );

    return {
      solicitado: true,
      enviado: false,
      estatus: 'ERROR_ENVIO',
      mensaje:
        error?.message ||
        'La venta se registró, pero no se pudo enviar el ticket digital.',
      correo_destino: normalizarTexto(tarjeta?.correo, 150).toLowerCase() || null,
    };
  }
};
