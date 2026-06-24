import { pool } from '../config/db.js';

const CONFIGURACION_TICKET_DEFAULT = {
  nombre_negocio: 'FARMACIAS SHADDAI',
  encabezado: [],
  rfc: '',
  direccion: '',
  telefono: '',

  mostrar_sucursal: true,
  mostrar_rfc: true,
  mostrar_direccion: true,
  mostrar_telefono: true,
  mostrar_fecha: true,
  mostrar_cajero: true,
  mostrar_caja: true,
  mostrar_folio: true,

  mostrar_articulos: true,
  mostrar_lote: true,
  mostrar_caducidad: true,

  mostrar_subtotal: true,
  mostrar_impuesto: true,
  mostrar_descuento: true,
  mostrar_total: true,

  mostrar_pagos: true,
  mostrar_metodo_pago: true,
  mostrar_cambio: true,
  mostrar_ahorro: true,

  pie_ticket: [
    '*** GRACIAS POR SU COMPRA ***',
    'CONSERVE SU TICKET PARA',
    'CUALQUIER DUDA O ACLARACION',
  ],
};

const CAMPOS_BOOLEANOS = [
  'mostrar_sucursal',
  'mostrar_rfc',
  'mostrar_direccion',
  'mostrar_telefono',
  'mostrar_fecha',
  'mostrar_cajero',
  'mostrar_caja',
  'mostrar_folio',
  'mostrar_articulos',
  'mostrar_lote',
  'mostrar_caducidad',
  'mostrar_subtotal',
  'mostrar_impuesto',
  'mostrar_descuento',
  'mostrar_total',
  'mostrar_pagos',
  'mostrar_metodo_pago',
  'mostrar_cambio',
  'mostrar_ahorro',
];

const esObjetoPlano = (valor) => {
  return (
    valor !== null &&
    typeof valor === 'object' &&
    !Array.isArray(valor)
  );
};

const normalizarBooleano = (valor, valorDefault = true) => {
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

const normalizarTexto = (valor, maximo = 150) => {
  return String(valor || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximo);
};

const normalizarLineas = (
  valor,
  maximoLineas = 6,
  maximoCaracteres = 100
) => {
  let lineas = [];

  if (Array.isArray(valor)) {
    lineas = valor;
  } else if (typeof valor === 'string') {
    lineas = valor.replace(/\r\n/g, '\n').split('\n');
  }

  /*
   * No se filtran las líneas vacías: permiten dejar separación visual
   * entre textos del encabezado y pie del ticket.
   */
  return lineas
    .slice(0, maximoLineas)
    .map((linea) =>
      String(linea ?? '')
        .replace(/\r/g, '')
        .slice(0, maximoCaracteres)
    );
};

const normalizarIdSucursal = (valor) => {
  if (valor === undefined || valor === null || valor === '') {
    return null;
  }

  const idSucursal = Number(valor);

  if (!Number.isInteger(idSucursal) || idSucursal <= 0) {
    throw new Error('El id_sucursal debe ser un número entero válido');
  }

  return idSucursal;
};

const obtenerObjetoConfiguracion = (valor) => {
  if (esObjetoPlano(valor)) return valor;

  if (typeof valor === 'string' && valor.trim()) {
    try {
      const parseado = JSON.parse(valor);

      if (esObjetoPlano(parseado)) return parseado;
    } catch (_) {
      throw new Error('La configuración del ticket no tiene un formato JSON válido');
    }
  }

  if (valor === undefined || valor === null) return {};

  throw new Error('La configuración del ticket debe ser un objeto válido');
};

const normalizarConfiguracionTicket = (
  configuracionEntrada = {},
  configuracionActual = {}
) => {
  const entrada = obtenerObjetoConfiguracion(configuracionEntrada);
  const actual = esObjetoPlano(configuracionActual)
    ? configuracionActual
    : {};

  const combinada = {
    ...CONFIGURACION_TICKET_DEFAULT,
    ...actual,
    ...entrada,
  };

  const configuracion = {
    ...combinada,

    nombre_negocio:
      normalizarTexto(combinada.nombre_negocio, 100) ||
      CONFIGURACION_TICKET_DEFAULT.nombre_negocio,

    encabezado: normalizarLineas(combinada.encabezado, 6, 100),

    rfc: normalizarTexto(combinada.rfc, 30),

    direccion: normalizarTexto(combinada.direccion, 200),

    telefono: normalizarTexto(combinada.telefono, 50),

    pie_ticket: normalizarLineas(
      combinada.pie_ticket,
      8,
      100
    ),
  };

  CAMPOS_BOOLEANOS.forEach((campo) => {
    configuracion[campo] = normalizarBooleano(
      combinada[campo],
      CONFIGURACION_TICKET_DEFAULT[campo]
    );
  });

  return configuracion;
};

const buscarConfiguracionExacta = async (idSucursal) => {
  const resultado = await pool.query(
    `
    SELECT
      id_configuracion_ticket,
      id_sucursal,
      nombre_configuracion,
      activo,
      configuracion,
      fecha_creacion,
      fecha_actualizacion
    FROM configuracion_ticket
    WHERE id_sucursal IS NOT DISTINCT FROM $1
    LIMIT 1
    `,
    [idSucursal]
  );

  return resultado.rows[0] || null;
};

const crearConfiguracionGlobalSiNoExiste = async () => {
  const existente = await buscarConfiguracionExacta(null);

  if (existente) return existente;

  try {
    const resultado = await pool.query(
      `
      INSERT INTO configuracion_ticket (
        id_sucursal,
        nombre_configuracion,
        activo,
        configuracion,
        fecha_creacion,
        fecha_actualizacion
      )
      VALUES (
        NULL,
        'Configuración global de ticket',
        true,
        $1::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING
        id_configuracion_ticket,
        id_sucursal,
        nombre_configuracion,
        activo,
        configuracion,
        fecha_creacion,
        fecha_actualizacion
      `,
      [JSON.stringify(CONFIGURACION_TICKET_DEFAULT)]
    );

    return resultado.rows[0];
  } catch (error) {
    // Por si dos peticiones intentan crear la global al mismo tiempo.
    if (error.code === '23505') {
      return buscarConfiguracionExacta(null);
    }

    throw error;
  }
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
    throw new Error('La sucursal indicada no existe');
  }

  return true;
};

const prepararRespuestaConfiguracion = (
  registro,
  origen = 'GLOBAL'
) => {
  return {
    ...registro,
    configuracion: normalizarConfiguracionTicket(
      registro?.configuracion || {}
    ),
    origen_configuracion: origen,
  };
};

export const obtenerConfiguracionTicket = async (req, res) => {
  try {
    const idSucursal = normalizarIdSucursal(req.query.id_sucursal);

    if (idSucursal) {
      const configuracionSucursal = await buscarConfiguracionExacta(idSucursal);

      if (configuracionSucursal?.activo) {
        return res.json({
          ok: true,
          configuracion: prepararRespuestaConfiguracion(
            configuracionSucursal,
            'SUCURSAL'
          ),
        });
      }
    }

    const configuracionGlobal = await crearConfiguracionGlobalSiNoExiste();

    return res.json({
      ok: true,
      configuracion: prepararRespuestaConfiguracion(
        configuracionGlobal,
        'GLOBAL'
      ),
    });
  } catch (error) {
    console.error('Error al obtener configuración de ticket:', error);

    return res.status(400).json({
      ok: false,
      mensaje:
        error.message ||
        'No se pudo obtener la configuración del ticket',
    });
  }
};

export const actualizarConfiguracionTicket = async (req, res) => {
  try {
    const body = req.body || {};

    const idSucursal = normalizarIdSucursal(body.id_sucursal);

    await validarSucursalExiste(idSucursal);

    const {
      id_sucursal,
      nombre_configuracion,
      activo,
      configuracion,
      ...camposDirectosConfiguracion
    } = body;

    const configuracionEntrada =
      configuracion !== undefined
        ? obtenerObjetoConfiguracion(configuracion)
        : camposDirectosConfiguracion;

    const configuracionExistente = await buscarConfiguracionExacta(idSucursal);

    const configuracionNormalizada = normalizarConfiguracionTicket(
      configuracionEntrada,
      configuracionExistente?.configuracion || {}
    );

    const nombreConfiguracion =
      normalizarTexto(nombre_configuracion, 100) ||
      configuracionExistente?.nombre_configuracion ||
      (idSucursal
        ? 'Configuración de ticket por sucursal'
        : 'Configuración global de ticket');

    const activoFinal = normalizarBooleano(
      activo,
      configuracionExistente?.activo ?? true
    );

    let resultado;

    if (configuracionExistente) {
      resultado = await pool.query(
        `
        UPDATE configuracion_ticket
        SET
          nombre_configuracion = $1,
          activo = $2,
          configuracion = $3::jsonb,
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_configuracion_ticket = $4
        RETURNING
          id_configuracion_ticket,
          id_sucursal,
          nombre_configuracion,
          activo,
          configuracion,
          fecha_creacion,
          fecha_actualizacion
        `,
        [
          nombreConfiguracion,
          activoFinal,
          JSON.stringify(configuracionNormalizada),
          configuracionExistente.id_configuracion_ticket,
        ]
      );
    } else {
      resultado = await pool.query(
        `
        INSERT INTO configuracion_ticket (
          id_sucursal,
          nombre_configuracion,
          activo,
          configuracion,
          fecha_creacion,
          fecha_actualizacion
        )
        VALUES (
          $1,
          $2,
          $3,
          $4::jsonb,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING
          id_configuracion_ticket,
          id_sucursal,
          nombre_configuracion,
          activo,
          configuracion,
          fecha_creacion,
          fecha_actualizacion
        `,
        [
          idSucursal,
          nombreConfiguracion,
          activoFinal,
          JSON.stringify(configuracionNormalizada),
        ]
      );
    }

    const registro = resultado.rows[0];

    return res.json({
      ok: true,
      mensaje: 'Configuración de ticket actualizada correctamente',
      configuracion: prepararRespuestaConfiguracion(
        registro,
        idSucursal ? 'SUCURSAL' : 'GLOBAL'
      ),
    });
  } catch (error) {
    console.error('Error al actualizar configuración de ticket:', error);

    return res.status(400).json({
      ok: false,
      mensaje:
        error.message ||
        'No se pudo actualizar la configuración del ticket',
    });
  }
};