import { pool } from '../config/db.js';
import { enviarTicketDigitalVenta } from '../services/ticketDigitalCorreo.service.js';

const esSuperAdmin = (usuario) => {
  return String(usuario?.rol || '').trim().toUpperCase() === 'SUPER_ADMIN';
};

const obtenerIdUsuarioAutenticado = (usuario) => {
  const idUsuario = Number(usuario?.id_usuario);

  return Number.isInteger(idUsuario) && idUsuario > 0
    ? idUsuario
    : null;
};

/*
 * Un SUPER_ADMIN puede operar cualquier caja activa.
 * Cualquier otro usuario solo puede operar la caja activa que tenga asignada
 * en cajas.id_usuario_asignado.
 */
const validarAccesoCajaAsignada = async ({
  db,
  usuario,
  idCaja,
  idSucursal = null,
  bloquear = false,
}) => {
  const idCajaNumerico = Number(idCaja);
  const idSucursalNumerico =
    idSucursal === null || idSucursal === undefined || idSucursal === ''
      ? null
      : Number(idSucursal);

  if (!Number.isInteger(idCajaNumerico) || idCajaNumerico <= 0) {
    return {
      ok: false,
      status: 400,
      mensaje: 'La caja seleccionada no es válida',
    };
  }

  if (
    idSucursalNumerico !== null &&
    (!Number.isInteger(idSucursalNumerico) || idSucursalNumerico <= 0)
  ) {
    return {
      ok: false,
      status: 400,
      mensaje: 'La sucursal seleccionada no es válida',
    };
  }

  const esAdmin = esSuperAdmin(usuario);
  const idUsuario = obtenerIdUsuarioAutenticado(usuario);

  if (!esAdmin && !idUsuario) {
    return {
      ok: false,
      status: 401,
      mensaje: 'No se pudo identificar al usuario de la sesión',
    };
  }

  const params = [idCajaNumerico];

  let query = `
    SELECT
      c.id_caja,
      c.id_sucursal,
      c.nombre,
      c.activo,
      c.id_usuario_asignado
    FROM cajas c
    WHERE c.id_caja = $1
      AND c.activo = true
  `;

  if (idSucursalNumerico !== null) {
    params.push(idSucursalNumerico);
    query += ` AND c.id_sucursal = $${params.length}`;
  }

  if (!esAdmin) {
    params.push(idUsuario);
    query += ` AND c.id_usuario_asignado = $${params.length}`;
  }

  query += ' LIMIT 1';

  if (bloquear) {
    query += ' FOR UPDATE';
  }

  const resultado = await db.query(query, params);

  if (resultado.rows.length === 0) {
    return {
      ok: false,
      status: 403,
      mensaje: esAdmin
        ? 'La caja seleccionada no existe, está inactiva o no pertenece a la sucursal indicada'
        : 'No tienes permiso para operar esta caja. Solo puedes usar la caja asignada a tu usuario.',
    };
  }

  return {
    ok: true,
    caja: resultado.rows[0],
  };
};

const responderAccesoCajaDenegado = (res, acceso) => {
  return res.status(acceso.status || 403).json({
    ok: false,
    mensaje: acceso.mensaje || 'No tienes permiso para operar esta caja',
  });
};


const generarFolioVenta = () => {
  const fecha = new Date();

  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mi = String(fecha.getMinutes()).padStart(2, '0');
  const ss = String(fecha.getSeconds()).padStart(2, '0');
  const random = Math.floor(Math.random() * 9000) + 1000;

  return `V-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${random}`;
};

const generarFolioDevolucion = () => {
  const fecha = new Date();

  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mi = String(fecha.getMinutes()).padStart(2, '0');
  const ss = String(fecha.getSeconds()).padStart(2, '0');
  const random = Math.floor(Math.random() * 9000) + 1000;

  return `DEV-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${random}`;
};

const estadosVentaConDevolucionPermitida = [
  'COMPLETADA',
  'DEVUELTA_PARCIAL',
];

const redondearDos = (valor) => {
  return Number(Number(valor || 0).toFixed(2));
};

const esValorActivo = (valor) => {
  return valor === true || valor === 'true' || valor === 1 || valor === '1';
};

const limpiarTexto = (valor) => {
  const texto = String(valor ?? '').trim();
  return texto.length > 0 ? texto : null;
};

const normalizarFechaSQL = (valor) => {
  const texto = limpiarTexto(valor);
  if (!texto) return null;

  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) return null;

  return texto;
};

const normalizarNumeroPositivo = (valor) => {
  const numero = Number(valor || 0);
  if (Number.isNaN(numero) || numero < 0) return 0;
  return redondearDos(numero);
};

const calcularTipoSurtidoExterno = ({ cantidadRecetada, cantidadSurtida }) => {
  if (cantidadRecetada <= 0 || cantidadSurtida <= 0) return null;
  return cantidadSurtida >= cantidadRecetada ? 'COMPLETO' : 'PARCIAL';
};

const obtenerDatosControlSanitarioShaddai = async ({
  client,
  item,
  cantidadVenta,
}) => {
  if (!item.id_receta_shaddai || !item.id_detalle_receta_shaddai) {
    return null;
  }

  /**
   * Primero consultamos la receta y su detalle.
   * Esto evita depender de datos temporales enviados desde el frontend.
   */
  const recetaResultado = await client.query(
    `
    SELECT
      r.id_receta,
      r.id_doctor,
      r.folio_receta,
      r.nombre_paciente,
      r.telefono_paciente,
      r.fecha_creacion AS fecha_receta,
      r.observaciones AS observaciones_receta,

      d.id_detalle,
      d.cantidad AS cantidad_recetada,
      d.cantidad_surtida,
      d.dosis,
      d.frecuencia,
      d.duracion,
      d.indicaciones
    FROM recetas_shaddai r
    INNER JOIN recetas_shaddai_detalle d
      ON d.id_receta = r.id_receta
    WHERE r.id_receta = $1
      AND d.id_detalle = $2
      AND r.activo = true
      AND d.activo = true
    LIMIT 1
    `,
    [
      Number(item.id_receta_shaddai),
      Number(item.id_detalle_receta_shaddai),
    ]
  );

  if (recetaResultado.rows.length === 0) {
    throw new Error(
      `No se encontró la receta Doctor Shaddai #${item.id_receta_shaddai} o su detalle #${item.id_detalle_receta_shaddai}.`
    );
  }

  const receta = recetaResultado.rows[0];

  let medicoNombre = 'Doctor Shaddai';
  let medicoCedula = null;

  /**
   * La columna de cédula puede variar según tu tabla:
   * cedula_profesional, cedula, cedula_medico, no_cedula, etc.
   * Por eso detectamos primero las columnas disponibles y armamos una
   * consulta segura sin romper si alguna columna no existe.
   */
  if (receta.id_doctor) {
    const columnasDoctorResultado = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'doctores_shaddai_perfiles'
      `
    );

    const columnasDoctor = columnasDoctorResultado.rows.map((row) =>
      String(row.column_name)
    );

    const columnaNombre =
      columnasDoctor.includes('nombre_completo')
        ? 'nombre_completo'
        : columnasDoctor.includes('nombre')
          ? 'nombre'
          : null;

    const columnaCedula =
      columnasDoctor.includes('cedula_profesional')
        ? 'cedula_profesional'
        : columnasDoctor.includes('cedula')
          ? 'cedula'
          : columnasDoctor.includes('cedula_medico')
            ? 'cedula_medico'
            : columnasDoctor.includes('no_cedula')
              ? 'no_cedula'
              : columnasDoctor.includes('numero_cedula')
                ? 'numero_cedula'
                : null;

    const selects = [
      'id_perfil',
      columnaNombre ? `${columnaNombre} AS medico_nombre` : `NULL::varchar AS medico_nombre`,
      columnaCedula ? `${columnaCedula} AS medico_cedula` : `NULL::varchar AS medico_cedula`,
    ];

    const selectDoctorSql = selects.join(',\n        ');

    /*
     * recetas_shaddai.id_doctor normalmente guarda el id_perfil.
     * Primero lo buscamos como perfil y solamente, si no existe, como usuario.
     * Nunca usamos OR porque un mismo número puede pertenecer al perfil de un
     * doctor y al usuario de otro doctor distinto.
     */
    let doctorResultado = await client.query(
      `
      SELECT
        ${selectDoctorSql}
      FROM doctores_shaddai_perfiles
      WHERE id_perfil = $1
      LIMIT 1
      `,
      [receta.id_doctor]
    );

    if (doctorResultado.rows.length === 0) {
      doctorResultado = await client.query(
        `
        SELECT
          ${selectDoctorSql}
        FROM doctores_shaddai_perfiles
        WHERE id_usuario = $1
        LIMIT 1
        `,
        [receta.id_doctor]
      );
    }

    if (doctorResultado.rows.length > 0) {
      medicoNombre =
        limpiarTexto(doctorResultado.rows[0].medico_nombre) ||
        medicoNombre;

      medicoCedula =
        limpiarTexto(doctorResultado.rows[0].medico_cedula) ||
        null;
    }
  }

  const cantidadRecetada = normalizarNumeroPositivo(
    receta.cantidad_recetada || cantidadVenta
  );

  const cantidadSurtidaPrevia = normalizarNumeroPositivo(
    receta.cantidad_surtida || 0
  );

  const cantidadSurtidaActual = normalizarNumeroPositivo(cantidadVenta);

  const totalSurtido = redondearDos(
    cantidadSurtidaPrevia + cantidadSurtidaActual
  );

  const cantidadPendiente = Math.max(
    redondearDos(cantidadRecetada - totalSurtido),
    0
  );

  return {
    tipo_receta: 'SHADDAI',

    numero_receta:
      receta.folio_receta ||
      `SHADDAI-${receta.id_receta}`,

    fecha_receta: receta.fecha_receta || null,

    medico_nombre: medicoNombre,
    medico_cedula: medicoCedula,

    paciente_nombre:
      limpiarTexto(receta.nombre_paciente) ||
      'Paciente Doctor Shaddai',

    paciente_telefono:
      limpiarTexto(receta.telefono_paciente) ||
      null,

    cantidad_recetada: cantidadRecetada,
    cantidad_surtida: cantidadSurtidaActual,
    cantidad_pendiente: cantidadPendiente,

    tipo_surtido: cantidadPendiente === 0 ? 'COMPLETO' : 'PARCIAL',

    observaciones:
      limpiarTexto(receta.observaciones_receta) ||
      `Venta vinculada a receta Doctor Shaddai ${receta.folio_receta || receta.id_receta}`,
  };
};

const validarDatosControlSanitario = ({ productoDb, item, cantidadVenta }) => {
  const requiereControl =
    esValorActivo(productoDb.controlado) ||
    esValorActivo(productoDb.es_controlado) ||
    esValorActivo(productoDb.requiere_receta);

  if (!requiereControl) return null;

  const esRecetaShaddai =
    item.id_receta_shaddai && item.id_detalle_receta_shaddai;

  /**
   * Doctor Shaddai se resuelve con obtenerDatosControlSanitarioShaddai(),
   * consultando directamente recetas_shaddai y recetas_shaddai_detalle.
   * Aquí no exigimos datos de receta externa.
   */
  if (esRecetaShaddai) return null;

  const datos = item.datos_control_sanitario || null;

  if (!datos) {
    throw new Error(
      `El producto ${productoDb.nombre} requiere datos de control sanitario.`
    );
  }

  const numeroReceta = limpiarTexto(datos.numero_receta);
  const medicoNombre = limpiarTexto(datos.medico_nombre);
  const medicoCedula = limpiarTexto(datos.medico_cedula);
  const pacienteNombre = limpiarTexto(datos.paciente_nombre);

  if (!numeroReceta) {
    throw new Error(`El número de receta es obligatorio para ${productoDb.nombre}.`);
  }

  if (!medicoNombre) {
    throw new Error(`El nombre del médico es obligatorio para ${productoDb.nombre}.`);
  }

  if (!medicoCedula) {
    throw new Error(`La cédula profesional del médico es obligatoria para ${productoDb.nombre}.`);
  }

  if (!pacienteNombre) {
    throw new Error(`El nombre del paciente es obligatorio para ${productoDb.nombre}.`);
  }

  const tipoReceta = limpiarTexto(datos.tipo_receta) || 'EXTERNA';

  const cantidadRecetada = normalizarNumeroPositivo(datos.cantidad_recetada);
  const cantidadSurtida = normalizarNumeroPositivo(
    datos.cantidad_surtida || cantidadVenta
  );

  if (tipoReceta === 'EXTERNA') {
    if (cantidadRecetada <= 0) {
      throw new Error(
        `La cantidad indicada en receta es obligatoria para ${productoDb.nombre}.`
      );
    }

    if (cantidadSurtida <= 0) {
      throw new Error(
        `La cantidad a surtir es obligatoria para ${productoDb.nombre}.`
      );
    }

    if (cantidadSurtida > cantidadRecetada) {
      throw new Error(
        `No puedes surtir más de lo indicado en receta para ${productoDb.nombre}.`
      );
    }

    if (Number(cantidadVenta) !== Number(cantidadSurtida)) {
      throw new Error(
        `La cantidad vendida de ${productoDb.nombre} no coincide con la cantidad a surtir capturada.`
      );
    }
  }

  const cantidadPendiente = Math.max(
    redondearDos(cantidadRecetada - cantidadSurtida),
    0
  );

  return {
    tipo_receta: tipoReceta,
    numero_receta: numeroReceta,
    fecha_receta: normalizarFechaSQL(datos.fecha_receta),
    medico_nombre: medicoNombre,
    medico_cedula: medicoCedula,
    paciente_nombre: pacienteNombre,
    paciente_telefono: limpiarTexto(datos.paciente_telefono),

    cantidad_recetada: cantidadRecetada > 0 ? cantidadRecetada : null,
    cantidad_surtida: cantidadSurtida > 0 ? cantidadSurtida : Number(cantidadVenta),
    cantidad_pendiente: cantidadRecetada > 0 ? cantidadPendiente : null,
    tipo_surtido:
      limpiarTexto(datos.tipo_surtido) ||
      calcularTipoSurtidoExterno({ cantidadRecetada, cantidadSurtida }),

    observaciones: limpiarTexto(datos.observaciones),
  };
};

const registrarLibroControlSanitario = async ({
  client,
  idVenta,
  idDetalleVenta,
  idProducto,
  idLote,
  idSucursal,
  tipoMovimiento = 'SALIDA',
  cantidadEntrada = 0,
  cantidadSalida = 0,
  existenciaDespues,
  datosControl,
  idUsuario,
}) => {
  if (!datosControl) return;

  await client.query(
    `
    INSERT INTO libro_control_sanitario (
      id_venta,
      id_detalle_venta,
      id_producto,
      id_lote,
      id_sucursal,
      tipo_movimiento,
      cantidad_entrada,
      cantidad_salida,
      existencia_despues,
      tipo_receta,
      numero_receta,
      fecha_receta,
      medico_nombre,
      medico_cedula,
      paciente_nombre,
      paciente_telefono,
      cantidad_recetada,
      cantidad_surtida,
      cantidad_pendiente,
      tipo_surtido,
      observaciones,
      id_usuario
    )
    VALUES (
      $1,$2,$3,$4,$5,
      $6,$7,$8,$9,
      $10,$11,$12,$13,$14,$15,$16,
      $17,$18,$19,$20,$21,$22
    )
    `,
    [
      idVenta,
      idDetalleVenta,
      idProducto,
      idLote,
      idSucursal,
      tipoMovimiento,
      redondearDos(cantidadEntrada || 0),
      redondearDos(cantidadSalida || 0),
      existenciaDespues ?? null,
      datosControl.tipo_receta || 'EXTERNA',
      datosControl.numero_receta,
      datosControl.fecha_receta,
      datosControl.medico_nombre,
      datosControl.medico_cedula,
      datosControl.paciente_nombre,
      datosControl.paciente_telefono,
      datosControl.cantidad_recetada,
      datosControl.cantidad_surtida,
      datosControl.cantidad_pendiente,
      datosControl.tipo_surtido,
      datosControl.observaciones,
      idUsuario,
    ]
  );
};

const METODOS_PAGO_PERMITIDOS = [
  'EFECTIVO',
  'TARJETA',
  'TRANSFERENCIA',
  'PUNTOS',
  'MIXTO',
];

const METODOS_PAGO_DETALLE_PERMITIDOS = [
  'EFECTIVO',
  'TARJETA',
  'TRANSFERENCIA',
  'PUNTOS',
];

const normalizarPagosMixtos = (pagos = []) => {
  const acumulado = {
    EFECTIVO: 0,
    TARJETA: 0,
    TRANSFERENCIA: 0,
    PUNTOS: 0,
  };

  if (!Array.isArray(pagos)) {
    return {
      ok: false,
      mensaje: 'Los pagos de una venta mixta deben enviarse como arreglo',
      pagos: [],
      acumulado,
    };
  }

  for (const pago of pagos) {
    const metodo = String(pago?.metodo_pago || '').trim().toUpperCase();
    const monto = redondearDos(pago?.monto || 0);

    if (!metodo) continue;

    if (!METODOS_PAGO_DETALLE_PERMITIDOS.includes(metodo)) {
      return {
        ok: false,
        mensaje: `Método de pago mixto no válido: ${metodo}`,
        pagos: [],
        acumulado,
      };
    }

    if (monto < 0) {
      return {
        ok: false,
        mensaje: 'Los montos de pago no pueden ser negativos',
        pagos: [],
        acumulado,
      };
    }

    if (monto > 0) {
      acumulado[metodo] = redondearDos(acumulado[metodo] + monto);
    }
  }

  const pagosNormalizados = Object.entries(acumulado)
    .filter(([, monto]) => Number(monto || 0) > 0)
    .map(([metodo_pago, monto]) => ({
      metodo_pago,
      monto: redondearDos(monto),
    }));

  return {
    ok: true,
    mensaje: null,
    pagos: pagosNormalizados,
    acumulado,
  };
};

const descontarLotesFEFO = async ({
  client,
  id_sucursal,
  id_producto,
  cantidadVenta,
}) => {
  let cantidadPendiente = Number(cantidadVenta);

  const lotesResultado = await client.query(
    `
    SELECT 
      id_lote,
      lote,
      fecha_caducidad,
      stock_actual
    FROM inventario_lotes
    WHERE id_sucursal = $1
      AND id_producto = $2
      AND activo = true
      AND stock_actual > 0
    ORDER BY
      fecha_caducidad ASC NULLS LAST,
      fecha_entrada ASC,
      id_lote ASC
    FOR UPDATE
    `,
    [id_sucursal, id_producto]
  );

  const stockTotalLotes = lotesResultado.rows.reduce((acc, lote) => {
    return acc + Number(lote.stock_actual || 0);
  }, 0);

  if (stockTotalLotes < cantidadPendiente) {
    return {
      ok: false,
      mensaje: 'No hay stock suficiente por lotes para completar la venta',
      stock_lotes: stockTotalLotes,
      cantidad_solicitada: cantidadVenta,
      lotes_descontados: [],
    };
  }

  const lotesDescontados = [];

  for (const loteItem of lotesResultado.rows) {
    if (cantidadPendiente <= 0) break;

    const stockLoteAnterior = Number(loteItem.stock_actual);
    const cantidadADescontar = Math.min(stockLoteAnterior, cantidadPendiente);
    const stockLoteNuevo = stockLoteAnterior - cantidadADescontar;

    await client.query(
      `
      UPDATE inventario_lotes
      SET
        stock_actual = $1::numeric,
        activo = CASE WHEN $1::numeric <= 0::numeric THEN false ELSE true END,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_lote = $2
      `,
      [stockLoteNuevo, loteItem.id_lote]
    );

    lotesDescontados.push({
      id_lote: loteItem.id_lote,
      lote: loteItem.lote,
      fecha_caducidad: loteItem.fecha_caducidad,
      cantidad_descontada: cantidadADescontar,
      stock_lote_anterior: stockLoteAnterior,
      stock_lote_nuevo: stockLoteNuevo,
    });

    cantidadPendiente -= cantidadADescontar;
  }

  return {
    ok: true,
    lotes_descontados: lotesDescontados,
  };
};

const descontarLoteSeleccionado = async ({
  client,
  id_sucursal,
  id_producto,
  id_lote,
  cantidadVenta,
}) => {
  const cantidadADescontar = Number(cantidadVenta);

  const loteResultado = await client.query(
    `
    SELECT
      id_lote,
      id_sucursal,
      id_producto,
      lote,
      fecha_caducidad,
      stock_actual,
      activo
    FROM inventario_lotes
    WHERE id_lote = $1
      AND id_sucursal = $2
      AND id_producto = $3
    FOR UPDATE
    `,
    [id_lote, id_sucursal, id_producto]
  );

  if (loteResultado.rows.length === 0) {
    return {
      ok: false,
      mensaje:
        'El lote seleccionado no existe o no pertenece al producto/sucursal',
      lotes_descontados: [],
    };
  }

  const loteItem = loteResultado.rows[0];

  if (!loteItem.activo) {
    return {
      ok: false,
      mensaje: `El lote ${loteItem.lote} está inactivo`,
      lotes_descontados: [],
    };
  }

  const stockLoteAnterior = Number(loteItem.stock_actual || 0);

  if (stockLoteAnterior <= 0) {
    return {
      ok: false,
      mensaje: `El lote ${loteItem.lote} no tiene stock disponible`,
      stock_lote: stockLoteAnterior,
      cantidad_solicitada: cantidadADescontar,
      lotes_descontados: [],
    };
  }

  if (stockLoteAnterior < cantidadADescontar) {
    return {
      ok: false,
      mensaje: `Stock insuficiente en el lote ${loteItem.lote}`,
      stock_lote: stockLoteAnterior,
      cantidad_solicitada: cantidadADescontar,
      lotes_descontados: [],
    };
  }

  const stockLoteNuevo = stockLoteAnterior - cantidadADescontar;

  await client.query(
    `
    UPDATE inventario_lotes
    SET
      stock_actual = $1::numeric,
      activo = CASE WHEN $1::numeric <= 0::numeric THEN false ELSE true END,
      fecha_actualizacion = CURRENT_TIMESTAMP
    WHERE id_lote = $2
    `,
    [stockLoteNuevo, loteItem.id_lote]
  );

  return {
    ok: true,
    lotes_descontados: [
      {
        id_lote: loteItem.id_lote,
        lote: loteItem.lote,
        fecha_caducidad: loteItem.fecha_caducidad,
        cantidad_descontada: cantidadADescontar,
        stock_lote_anterior: stockLoteAnterior,
        stock_lote_nuevo: stockLoteNuevo,
      },
    ],
  };
};

const obtenerConfiguracionPuntos = async (client) => {
  const resultado = await client.query(
    `
    SELECT
      id_configuracion,
      porcentaje_cliente,
      porcentaje_cajero,
      puntos_cliente_activo,
      puntos_cajero_activo
    FROM configuracion_puntos
    ORDER BY id_configuracion DESC
    LIMIT 1
    `
  );

  if (resultado.rows.length > 0) {
    return resultado.rows[0];
  }

  const creada = await client.query(
    `
    INSERT INTO configuracion_puntos (
      porcentaje_cliente,
      porcentaje_cajero,
      puntos_cliente_activo,
      puntos_cajero_activo
    )
    VALUES (1.00, 0.50, true, true)
    RETURNING
      id_configuracion,
      porcentaje_cliente,
      porcentaje_cajero,
      puntos_cliente_activo,
      puntos_cajero_activo
    `
  );

  return creada.rows[0];
};

const calcularPuntosPorcentaje = ({ total, porcentaje, activo }) => {
  if (!esValorActivo(activo)) return 0;

  const totalNumerico = Number(total || 0);
  const porcentajeNumerico = Number(porcentaje || 0);

  if (totalNumerico <= 0 || porcentajeNumerico <= 0) return 0;

  return redondearDos(totalNumerico * (porcentajeNumerico / 100));
};

const validarOfertaProducto = async ({
  client,
  idOferta,
  idProducto,
  idCategoriaProducto,
}) => {
  if (!idOferta) return null;

  const ofertaResultado = await client.query(
    `
    SELECT
      oc.id_oferta,
      oc.id_categoria,
      oc.nombre,
      oc.porcentaje_descuento,
      oc.fecha_inicio,
      oc.fecha_fin,
      oc.activo
    FROM ofertas_categorias oc
    WHERE oc.id_oferta = $1
      AND oc.id_categoria = $2
      AND oc.activo = true
      AND CURRENT_DATE BETWEEN oc.fecha_inicio AND oc.fecha_fin
    LIMIT 1
    `,
    [idOferta, idCategoriaProducto]
  );

  if (ofertaResultado.rows.length === 0) {
    throw new Error(
      `La oferta enviada para el producto ${idProducto} no existe, no está vigente o no pertenece a su categoría`
    );
  }

  return ofertaResultado.rows[0];
};

const actualizarEstatusRecetaShaddai = async ({ client, idReceta }) => {
  if (!idReceta) return null;

  const resumenDetalle = await client.query(
    `
    SELECT
      COUNT(*)::int AS total_productos,
      SUM(
        CASE
          WHEN COALESCE(cantidad_surtida, 0) >= COALESCE(cantidad, 0)
            THEN 1
          ELSE 0
        END
      )::int AS productos_completos,
      SUM(COALESCE(cantidad, 0))::numeric AS total_recetado,
      SUM(COALESCE(cantidad_surtida, 0))::numeric AS total_surtido
    FROM recetas_shaddai_detalle
    WHERE id_receta = $1
    `,
    [idReceta]
  );

  const resumen = resumenDetalle.rows[0];

  const totalProductos = Number(resumen?.total_productos || 0);
  const productosCompletos = Number(resumen?.productos_completos || 0);
  const totalSurtido = Number(resumen?.total_surtido || 0);

  let estatus = 'PENDIENTE_CAJERO';

  if (totalProductos > 0 && productosCompletos === totalProductos) {
    estatus = 'SURTIDA';
  } else if (totalSurtido > 0) {
    estatus = 'SURTIDA_PARCIAL';
  }

  const recetaActualizada = await client.query(
    `
    UPDATE recetas_shaddai
    SET
      estatus = $1,
      fecha_actualizacion = CURRENT_TIMESTAMP
    WHERE id_receta = $2
    RETURNING
      id_receta,
      folio_receta,
      estatus
    `,
    [estatus, idReceta]
  );

  return recetaActualizada.rows[0] || null;
};

export const crearVenta = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      id_sucursal,
      id_caja,
      id_sesion,
      metodo_pago,
      monto_recibido,
      pagos = [],
      descuento = 0,
      impuesto = 0,
      productos = [],
      servicios = [],
      id_tarjeta_puntos,
      id_doctor,
      id_receta_shaddai,
      enviar_ticket_digital = false,
    } = req.body;

    if (!id_sucursal || !id_caja || !id_sesion) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Sucursal, caja y sesión son obligatorias',
      });
    }

    const productosVenta = Array.isArray(productos) ? productos : [];
    const serviciosVenta = Array.isArray(servicios) ? servicios : [];

    if (productosVenta.length === 0 && serviciosVenta.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La venta debe contener al menos un producto o servicio',
      });
    }

    const metodoPagoFinal = String(metodo_pago || 'EFECTIVO').toUpperCase();

    if (!METODOS_PAGO_PERMITIDOS.includes(metodoPagoFinal)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Método de pago no válido',
      });
    }

    const esPagoConPuntos = metodoPagoFinal === 'PUNTOS';

    await client.query('BEGIN');

    const accesoCaja = await validarAccesoCajaAsignada({
      db: client,
      usuario: req.usuario,
      idCaja: id_caja,
      idSucursal: id_sucursal,
      bloquear: true,
    });

    if (!accesoCaja.ok) {
      await client.query('ROLLBACK');
      return responderAccesoCajaDenegado(res, accesoCaja);
    }

    const sesion = await client.query(
      `
      SELECT 
        id_sesion,
        id_caja,
        id_sucursal,
        estado
      FROM caja_sesiones
      WHERE id_sesion = $1
        AND id_caja = $2
        AND id_sucursal = $3
      FOR UPDATE
      `,
      [id_sesion, id_caja, id_sucursal]
    );

    if (sesion.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró la sesión de caja indicada',
      });
    }

    if (sesion.rows[0].estado !== 'ABIERTA') {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'La caja no está abierta',
      });
    }

    let tarjetaPuntos = null;

    if (id_tarjeta_puntos) {
      const tarjetaResultado = await client.query(
        `
        SELECT
          id_tarjeta,
          codigo_barras,
          nombre_cliente,
          correo,
          puntos_actuales,
          puntos_acumulados,
          puntos_canjeados,
          activo
        FROM tarjetas_puntos
        WHERE id_tarjeta = $1
        FOR UPDATE
        `,
        [id_tarjeta_puntos]
      );

      if (tarjetaResultado.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: 'Tarjeta de puntos no encontrada',
        });
      }

      tarjetaPuntos = tarjetaResultado.rows[0];

      if (!tarjetaPuntos.activo) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'La tarjeta de puntos está inactiva',
        });
      }
    }

    if (esPagoConPuntos && !tarjetaPuntos) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'Para pagar con puntos debes vincular una tarjeta de puntos',
      });
    }

    let doctorShaddaiVenta = null;
    let idDoctorVenta = null;

    const productoConRecetaShaddai = productosVenta.find(
      (item) => item.id_receta_shaddai
    );

    const idRecetaShaddaiVenta = id_receta_shaddai
      ? Number(id_receta_shaddai)
      : productoConRecetaShaddai?.id_receta_shaddai
        ? Number(productoConRecetaShaddai.id_receta_shaddai)
        : null;

    const servicioClinicoVenta = serviciosVenta.find(
      (item) => item.id_solicitud_servicio
    );

    const idSolicitudServicioVenta =
      servicioClinicoVenta?.id_solicitud_servicio
        ? Number(servicioClinicoVenta.id_solicitud_servicio)
        : null;

    /*
     * En servicios_clinicos_solicitudes, id_doctor corresponde al id_usuario
     * del doctor. La solicitud es la fuente oficial y tiene prioridad sobre
     * cualquier id_doctor enviado por el frontend.
     */
    if (idSolicitudServicioVenta) {
      const servicioDoctorResultado = await client.query(
        `
        SELECT
          s.id_doctor,
          d.id_perfil,
          d.id_usuario,
          d.nombre_completo,
          d.porcentaje_puntos_venta,
          d.puntos_activo,
          d.activo
        FROM servicios_clinicos_solicitudes s
        LEFT JOIN doctores_shaddai_perfiles d
          ON d.id_usuario = s.id_doctor
        WHERE s.id_solicitud_servicio = $1
          AND s.activo = true
        LIMIT 1
        `,
        [idSolicitudServicioVenta]
      );

      if (servicioDoctorResultado.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: 'No se encontró la solicitud del servicio clínico.',
        });
      }

      const doctorServicio = servicioDoctorResultado.rows[0];

      if (!doctorServicio.id_doctor) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'La solicitud del servicio clínico no tiene doctor asignado.',
        });
      }

      if (!doctorServicio.id_perfil) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje:
            'No se encontró el perfil Shaddai asociado al usuario doctor de la solicitud.',
        });
      }

      if (!esValorActivo(doctorServicio.activo)) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'El doctor asociado al servicio clínico está inactivo.',
        });
      }

      doctorShaddaiVenta = doctorServicio;
      idDoctorVenta = Number(doctorServicio.id_perfil);
    }

    /*
     * Para recetas Shaddai, primero interpretamos recetas_shaddai.id_doctor
     * como id_perfil. Solo si no existe ese perfil intentamos id_usuario.
     */
    else if (idRecetaShaddaiVenta) {
      const recetaDoctorResultado = await client.query(
        `
        SELECT
          id_doctor
        FROM recetas_shaddai
        WHERE id_receta = $1
          AND activo = true
        LIMIT 1
        `,
        [idRecetaShaddaiVenta]
      );

      if (
        recetaDoctorResultado.rows.length === 0 ||
        !recetaDoctorResultado.rows[0].id_doctor
      ) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: 'La receta Shaddai no tiene un doctor válido asociado.',
        });
      }

      const idDoctorReceta = Number(
        recetaDoctorResultado.rows[0].id_doctor
      );

      let doctorResultado = await client.query(
        `
        SELECT
          id_perfil,
          id_usuario,
          nombre_completo,
          porcentaje_puntos_venta,
          puntos_activo,
          activo
        FROM doctores_shaddai_perfiles
        WHERE id_perfil = $1
        LIMIT 1
        `,
        [idDoctorReceta]
      );

      if (doctorResultado.rows.length === 0) {
        doctorResultado = await client.query(
          `
          SELECT
            id_perfil,
            id_usuario,
            nombre_completo,
            porcentaje_puntos_venta,
            puntos_activo,
            activo
          FROM doctores_shaddai_perfiles
          WHERE id_usuario = $1
          LIMIT 1
          `,
          [idDoctorReceta]
        );
      }

      if (doctorResultado.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: 'No se encontró el doctor Shaddai asociado a la receta.',
        });
      }

      doctorShaddaiVenta = doctorResultado.rows[0];
      idDoctorVenta = Number(doctorShaddaiVenta.id_perfil);

      if (!esValorActivo(doctorShaddaiVenta.activo)) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'El doctor Shaddai asociado a la venta está inactivo.',
        });
      }
    }

    /*
     * Cuando no hay servicio ni receta, id_doctor se considera id_perfil.
     * Si el perfil no existe, se intenta como id_usuario solo como respaldo.
     */
    else if (id_doctor) {
      const idDoctorEnviado = Number(id_doctor);

      let doctorResultado = await client.query(
        `
        SELECT
          id_perfil,
          id_usuario,
          nombre_completo,
          porcentaje_puntos_venta,
          puntos_activo,
          activo
        FROM doctores_shaddai_perfiles
        WHERE id_perfil = $1
        LIMIT 1
        `,
        [idDoctorEnviado]
      );

      if (doctorResultado.rows.length === 0) {
        doctorResultado = await client.query(
          `
          SELECT
            id_perfil,
            id_usuario,
            nombre_completo,
            porcentaje_puntos_venta,
            puntos_activo,
            activo
          FROM doctores_shaddai_perfiles
          WHERE id_usuario = $1
          LIMIT 1
          `,
          [idDoctorEnviado]
        );
      }

      if (doctorResultado.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: 'No se encontró el doctor Shaddai asociado a la venta.',
        });
      }

      doctorShaddaiVenta = doctorResultado.rows[0];
      idDoctorVenta = Number(doctorShaddaiVenta.id_perfil);

      if (!esValorActivo(doctorShaddaiVenta.activo)) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'El doctor Shaddai asociado a la venta está inactivo.',
        });
      }
    }

    let subtotalVenta = 0;
    let subtotalSinDescuentoVenta = 0;
    let descuentoOfertasVenta = 0;

    let puntosClienteGanados = 0;
    let puntosCajeroGanados = 0;
    let puntosDoctorShaddaiGanados = 0;
    let doctorShaddaiPuntos = null;
    let recetaShaddaiActualizada = null;

    const productosProcesados = [];
    const serviciosProcesados = [];

    for (const item of productosVenta) {
      const { id_producto, cantidad } = item;
      const idLoteSeleccionado = item.id_lote ? Number(item.id_lote) : null;

      if (!id_producto || !cantidad || Number(cantidad) <= 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje:
            'Cada producto debe tener id_producto y cantidad mayor a cero',
        });
      }

      const productoResultado = await client.query(
        `
  SELECT 
    id_producto,
    id_categoria,
    nombre,
    precio_venta,
    activo,
    es_controlado AS controlado,
    requiere_receta,
    NULL::varchar AS fraccion_control,
    NULL::varchar AS tipo_control_sanitario
  FROM productos
  WHERE id_producto = $1
    AND activo = true
  `,
        [id_producto]
      );

      if (productoResultado.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: `Producto no encontrado o desactivado: ${id_producto}`,
        });
      }

      const producto = productoResultado.rows[0];

      let datosControlSanitario = null;

      try {
        const esRecetaShaddai =
          item.id_receta_shaddai && item.id_detalle_receta_shaddai;

        if (
          esRecetaShaddai &&
          (
            esValorActivo(producto.controlado) ||
            esValorActivo(producto.es_controlado) ||
            esValorActivo(producto.requiere_receta)
          )
        ) {
          datosControlSanitario = await obtenerDatosControlSanitarioShaddai({
            client,
            item,
            cantidadVenta: Number(cantidad),
          });
        } else {
          datosControlSanitario = validarDatosControlSanitario({
            productoDb: producto,
            item,
            cantidadVenta: Number(cantidad),
          });
        }
      } catch (error) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: error.message,
        });
      }

      const inventarioResultado = await client.query(
        `
        SELECT 
          id_inventario,
          stock_actual
        FROM inventario_sucursal
        WHERE id_sucursal = $1
          AND id_producto = $2
        FOR UPDATE
        `,
        [id_sucursal, id_producto]
      );

      if (inventarioResultado.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: `El producto ${producto.nombre} no tiene inventario en esta sucursal`,
        });
      }

      const stockActual = Number(inventarioResultado.rows[0].stock_actual);
      const cantidadVenta = Number(cantidad);

      if (stockActual < cantidadVenta) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `Stock insuficiente para ${producto.nombre}`,
          stock_actual: stockActual,
          cantidad_solicitada: cantidadVenta,
        });
      }

      const precioBaseDB = redondearDos(producto.precio_venta);

      const idOferta = item.id_oferta ? Number(item.id_oferta) : null;
      const porcentajeDescuento = redondearDos(item.porcentaje_descuento || 0);
      const descuentoUnitario = redondearDos(item.descuento_unitario || 0);

      const precioOriginal =
        item.precio_original !== undefined &&
          item.precio_original !== null &&
          item.precio_original !== ''
          ? redondearDos(item.precio_original)
          : precioBaseDB;

      let precioUnitario =
        item.precio_unitario !== undefined &&
          item.precio_unitario !== null &&
          item.precio_unitario !== ''
          ? redondearDos(item.precio_unitario)
          : precioBaseDB;

      let ofertaValidada = null;

      if (idOferta || porcentajeDescuento > 0 || descuentoUnitario > 0) {
        if (!idOferta) {
          await client.query('ROLLBACK');

          return res.status(400).json({
            ok: false,
            mensaje: `El producto ${producto.nombre} tiene descuento de oferta, pero no trae id_oferta`,
          });
        }

        ofertaValidada = await validarOfertaProducto({
          client,
          idOferta,
          idProducto: id_producto,
          idCategoriaProducto: producto.id_categoria,
        });

        const porcentajeDB = redondearDos(ofertaValidada.porcentaje_descuento);
        const descuentoUnitarioCalculado = redondearDos(
          precioBaseDB * (porcentajeDB / 100)
        );
        const precioConDescuentoCalculado = redondearDos(
          precioBaseDB - descuentoUnitarioCalculado
        );

        const diferenciaPrecio = Math.abs(
          precioUnitario - precioConDescuentoCalculado
        );

        if (diferenciaPrecio > 0.02) {
          await client.query('ROLLBACK');

          return res.status(400).json({
            ok: false,
            mensaje: `El precio con oferta del producto ${producto.nombre} no coincide con la configuración vigente`,
            precio_enviado: precioUnitario,
            precio_esperado: precioConDescuentoCalculado,
          });
        }

        precioUnitario = precioConDescuentoCalculado;
      }

      const descuentoProductoManual = redondearDos(item.descuento || 0);
      const subtotalProducto = redondearDos(
        cantidadVenta * precioUnitario - descuentoProductoManual
      );

      const subtotalOriginalProducto = redondearDos(
        cantidadVenta * precioOriginal
      );

      const descuentoOfertaProducto = redondearDos(
        cantidadVenta * descuentoUnitario
      );

      if (subtotalProducto < 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `El subtotal del producto ${producto.nombre} no puede ser negativo`,
        });
      }

      const resultadoLotes = idLoteSeleccionado
        ? await descontarLoteSeleccionado({
          client,
          id_sucursal,
          id_producto,
          id_lote: idLoteSeleccionado,
          cantidadVenta,
        })
        : await descontarLotesFEFO({
          client,
          id_sucursal,
          id_producto,
          cantidadVenta,
        });

      if (!resultadoLotes.ok) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `${resultadoLotes.mensaje} para ${producto.nombre}`,
          stock_lotes: resultadoLotes.stock_lotes,
          stock_lote: resultadoLotes.stock_lote,
          cantidad_solicitada: resultadoLotes.cantidad_solicitada,
        });
      }

      const stockNuevo = stockActual - cantidadVenta;

      await client.query(
        `
        UPDATE inventario_sucursal
        SET 
          stock_actual = $1,
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_sucursal = $2
          AND id_producto = $3
        `,
        [stockNuevo, id_sucursal, id_producto]
      );

      subtotalVenta += subtotalProducto;
      subtotalSinDescuentoVenta += subtotalOriginalProducto;
      descuentoOfertasVenta += descuentoOfertaProducto;

      const lotePrincipal = resultadoLotes.lotes_descontados?.[0] || null;

      productosProcesados.push({
        id_producto,
        id_lote: lotePrincipal?.id_lote || null,
        lote: lotePrincipal?.lote || null,
        fecha_caducidad: lotePrincipal?.fecha_caducidad || null,

        nombre: producto.nombre,
        cantidad: cantidadVenta,

        precio_original: precioOriginal,
        precio_unitario: precioUnitario,

        porcentaje_descuento: ofertaValidada
          ? redondearDos(ofertaValidada.porcentaje_descuento)
          : 0,
        descuento_unitario: ofertaValidada ? descuentoUnitario : 0,
        id_oferta: ofertaValidada ? ofertaValidada.id_oferta : null,
        oferta_nombre: ofertaValidada ? ofertaValidada.nombre : null,

        descuento: descuentoProductoManual,
        subtotal: subtotalProducto,
        subtotal_original: subtotalOriginalProducto,
        descuento_oferta: descuentoOfertaProducto,

        stock_anterior: stockActual,
        stock_nuevo: stockNuevo,
        lotes_descontados: resultadoLotes.lotes_descontados,

        id_receta_shaddai: item.id_receta_shaddai
          ? Number(item.id_receta_shaddai)
          : null,

        id_detalle_receta_shaddai: item.id_detalle_receta_shaddai
          ? Number(item.id_detalle_receta_shaddai)
          : null,

        controlado: esValorActivo(producto.controlado),
        requiere_receta: esValorActivo(producto.requiere_receta),
        datos_control_sanitario: datosControlSanitario,
      });
    }

    for (const item of serviciosVenta) {
      const idSolicitudServicio = item.id_solicitud_servicio
        ? Number(item.id_solicitud_servicio)
        : null;

      const idDetalleServicio = item.id_detalle_servicio
        ? Number(item.id_detalle_servicio)
        : null;

      if (!idSolicitudServicio || !idDetalleServicio) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'Cada servicio debe tener id_solicitud_servicio e id_detalle_servicio',
        });
      }

      const servicioResultado = await client.query(
        `
        SELECT
          s.id_solicitud_servicio,
          s.folio_servicio,
          s.nombre_paciente,
          s.id_doctor,
          s.estatus,
          s.activo AS solicitud_activa,

          sd.id_detalle_servicio,
          sd.id_servicio,
          sd.id_producto,
          sd.nombre_servicio,
          sd.cantidad,
          sd.precio_unitario,
          sd.subtotal,
          sd.activo AS detalle_activo
        FROM servicios_clinicos_solicitudes s
        INNER JOIN servicios_clinicos_solicitudes_detalle sd
          ON sd.id_solicitud_servicio = s.id_solicitud_servicio
        WHERE s.id_solicitud_servicio = $1
          AND sd.id_detalle_servicio = $2
        FOR UPDATE OF s, sd
        `,
        [idSolicitudServicio, idDetalleServicio]
      );

      if (servicioResultado.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: `No se encontró el servicio clínico ${idSolicitudServicio}.`,
        });
      }

      const servicioDb = servicioResultado.rows[0];

      if (!esValorActivo(servicioDb.solicitud_activa) || !esValorActivo(servicioDb.detalle_activo)) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `El servicio ${servicioDb.nombre_servicio} está inactivo.`,
        });
      }

      const estatusServicio = String(servicioDb.estatus || '').toUpperCase();

      if (estatusServicio !== 'PENDIENTE_CAJERO') {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `El servicio ${servicioDb.folio_servicio || idSolicitudServicio} no está pendiente de caja.`,
        });
      }

      const cantidadServicio = normalizarNumeroPositivo(
        item.cantidad ?? servicioDb.cantidad ?? 1
      );

      const precioUnitarioServicio = redondearDos(
        item.precio_unitario ?? servicioDb.precio_unitario ?? 0
      );

      if (cantidadServicio <= 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `La cantidad del servicio ${servicioDb.nombre_servicio} debe ser mayor a cero.`,
        });
      }

      if (precioUnitarioServicio < 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `El precio del servicio ${servicioDb.nombre_servicio} no puede ser negativo.`,
        });
      }

      const subtotalServicio = redondearDos(cantidadServicio * precioUnitarioServicio);

      subtotalVenta += subtotalServicio;
      subtotalSinDescuentoVenta += subtotalServicio;

      serviciosProcesados.push({
        id_solicitud_servicio: servicioDb.id_solicitud_servicio,
        id_detalle_servicio: servicioDb.id_detalle_servicio,
        id_servicio: servicioDb.id_servicio,
        id_producto: servicioDb.id_producto || null,
        folio_servicio: servicioDb.folio_servicio,
        nombre_paciente: servicioDb.nombre_paciente,
        nombre_servicio: servicioDb.nombre_servicio,
        cantidad: cantidadServicio,
        precio_unitario: precioUnitarioServicio,
        subtotal: subtotalServicio,
        id_doctor: servicioDb.id_doctor || null,
      });
    }

    subtotalVenta = redondearDos(subtotalVenta);
    subtotalSinDescuentoVenta = redondearDos(subtotalSinDescuentoVenta);
    descuentoOfertasVenta = redondearDos(descuentoOfertasVenta);

    const descuentoVenta = redondearDos(descuento || 0);
    const impuestoVenta = redondearDos(impuesto || 0);
    const totalVenta = redondearDos(
      subtotalVenta - descuentoVenta + impuestoVenta
    );

    if (totalVenta < 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El total de la venta no puede ser negativo',
      });
    }

    const esPagoMixto = metodoPagoFinal === 'MIXTO';

    let pagosVenta = [];
    let puntosUsados = 0;
    let montoPagadoPuntos = 0;
    let montoPagadoDinero = 0;
    let montoRecibidoFinal = 0;
    let cambio = 0;

    if (esPagoMixto) {
      const pagosNormalizados = normalizarPagosMixtos(pagos);

      if (!pagosNormalizados.ok) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: pagosNormalizados.mensaje,
        });
      }

      if (pagosNormalizados.pagos.length === 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'Debes capturar al menos un pago para una venta mixta',
        });
      }

      const efectivoRecibido = redondearDos(pagosNormalizados.acumulado.EFECTIVO || 0);
      const tarjetaPagada = redondearDos(pagosNormalizados.acumulado.TARJETA || 0);
      const transferenciaPagada = redondearDos(pagosNormalizados.acumulado.TRANSFERENCIA || 0);
      const puntosPagados = redondearDos(pagosNormalizados.acumulado.PUNTOS || 0);

      const pagosNoEfectivo = redondearDos(
        tarjetaPagada + transferenciaPagada + puntosPagados
      );

      if (pagosNoEfectivo - totalVenta > 0.02) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje:
            'Los pagos con tarjeta, transferencia o puntos no pueden exceder el total de la venta',
          total: totalVenta,
          pagos_no_efectivo: pagosNoEfectivo,
        });
      }

      const pendienteAntesDeEfectivo = redondearDos(
        Math.max(totalVenta - pagosNoEfectivo, 0)
      );

      const efectivoAplicado = redondearDos(
        Math.min(efectivoRecibido, pendienteAntesDeEfectivo)
      );

      cambio = redondearDos(
        Math.max(efectivoRecibido - pendienteAntesDeEfectivo, 0)
      );

      montoPagadoPuntos = puntosPagados;
      puntosUsados = puntosPagados;
      montoPagadoDinero = redondearDos(
        efectivoAplicado + tarjetaPagada + transferenciaPagada
      );

      const totalCubierto = redondearDos(montoPagadoDinero + montoPagadoPuntos);

      if (totalCubierto + 0.02 < totalVenta) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'El total pagado no cubre el total de la venta',
          total: totalVenta,
          total_pagado: totalCubierto,
          pendiente: redondearDos(totalVenta - totalCubierto),
        });
      }

      montoRecibidoFinal = redondearDos(
        efectivoRecibido + tarjetaPagada + transferenciaPagada + puntosPagados
      );

      pagosVenta = [
        efectivoAplicado > 0
          ? {
            metodo_pago: 'EFECTIVO',
            monto: efectivoAplicado,
            referencia: null,
            monto_recibido: efectivoRecibido,
            cambio,
          }
          : null,
        tarjetaPagada > 0
          ? {
            metodo_pago: 'TARJETA',
            monto: tarjetaPagada,
            referencia: null,
          }
          : null,
        transferenciaPagada > 0
          ? {
            metodo_pago: 'TRANSFERENCIA',
            monto: transferenciaPagada,
            referencia: null,
          }
          : null,
        puntosPagados > 0
          ? {
            metodo_pago: 'PUNTOS',
            monto: puntosPagados,
            referencia: tarjetaPuntos?.codigo_barras || null,
          }
          : null,
      ].filter(Boolean);
    } else {
      if (esPagoConPuntos) {
        puntosUsados = totalVenta;
        montoPagadoPuntos = totalVenta;
        montoPagadoDinero = 0;
        montoRecibidoFinal = 0;
        cambio = 0;
      } else {
        puntosUsados = 0;
        montoPagadoPuntos = 0;
        montoPagadoDinero = totalVenta;
        montoRecibidoFinal = redondearDos(monto_recibido || 0);

        if (metodoPagoFinal === 'EFECTIVO' && montoRecibidoFinal < totalVenta) {
          await client.query('ROLLBACK');

          return res.status(400).json({
            ok: false,
            mensaje: 'El monto recibido no cubre el total de la venta',
            total: totalVenta,
            monto_recibido: montoRecibidoFinal,
          });
        }

        cambio =
          metodoPagoFinal === 'EFECTIVO'
            ? redondearDos(montoRecibidoFinal - totalVenta)
            : 0;
      }

      pagosVenta = [
        {
          metodo_pago: metodoPagoFinal,
          monto: totalVenta,
          referencia:
            metodoPagoFinal === 'PUNTOS'
              ? tarjetaPuntos?.codigo_barras || null
              : null,
          monto_recibido:
            metodoPagoFinal === 'EFECTIVO' ? montoRecibidoFinal : totalVenta,
          cambio,
        },
      ];
    }

    if (puntosUsados > 0 && !tarjetaPuntos) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'Para pagar con puntos debes vincular una tarjeta de puntos',
      });
    }

    if (
      puntosUsados > 0 &&
      Number(tarjetaPuntos.puntos_actuales || 0) < puntosUsados
    ) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'La tarjeta no tiene puntos suficientes para pagar la venta',
        puntos_actuales: Number(tarjetaPuntos.puntos_actuales || 0),
        puntos_requeridos: puntosUsados,
      });
    }

    const configuracionPuntos = await obtenerConfiguracionPuntos(client);

    puntosClienteGanados =
      tarjetaPuntos && montoPagadoDinero > 0
        ? calcularPuntosPorcentaje({
          total: montoPagadoDinero,
          porcentaje: configuracionPuntos.porcentaje_cliente,
          activo: configuracionPuntos.puntos_cliente_activo,
        })
        : 0;

    puntosCajeroGanados = calcularPuntosPorcentaje({
      total: totalVenta,
      porcentaje: configuracionPuntos.porcentaje_cajero,
      activo: configuracionPuntos.puntos_cajero_activo,
    });

    const folio = generarFolioVenta();

    const ventaResultado = await client.query(
      `
  INSERT INTO ventas (
    folio,
    id_sucursal,
    id_caja,
    id_sesion,
    id_usuario,
    subtotal,
    subtotal_sin_descuento,
    descuento_ofertas,
    descuento,
    impuesto,
    total,
    metodo_pago,
    monto_recibido,
    cambio,
    estado,
    id_tarjeta_puntos,
    puntos_ganados,
    monto_pagado_dinero,
    monto_pagado_puntos,
    puntos_usados,
    id_doctor
  )
  VALUES (
    $1,$2,$3,$4,$5,
    $6,$7,$8,$9,$10,
    $11,$12,$13,$14,'COMPLETADA',
    $15,$16,$17,$18,$19,$20
  )
  RETURNING *
  `,
      [
        folio,
        id_sucursal,
        id_caja,
        id_sesion,
        req.usuario.id_usuario,
        subtotalVenta,
        subtotalSinDescuentoVenta,
        descuentoOfertasVenta,
        descuentoVenta,
        impuestoVenta,
        totalVenta,
        metodoPagoFinal,
        montoRecibidoFinal,
        cambio,
        tarjetaPuntos?.id_tarjeta || null,
        puntosClienteGanados,
        montoPagadoDinero,
        montoPagadoPuntos,
        puntosUsados,
        idDoctorVenta || null,
      ]
    );

    const venta = ventaResultado.rows[0];

    for (const pago of pagosVenta) {
      await client.query(
        `
        INSERT INTO ventas_pagos (
          id_venta,
          metodo_pago,
          monto,
          referencia
        )
        VALUES ($1,$2,$3,$4)
        `,
        [
          venta.id_venta,
          pago.metodo_pago,
          redondearDos(pago.monto),
          pago.referencia || null,
        ]
      );
    }

    if (doctorShaddaiVenta) {
      const porcentajeDoctor = Number(
        doctorShaddaiVenta.porcentaje_puntos_venta || 0
      );

      if (
        esValorActivo(doctorShaddaiVenta.puntos_activo) &&
        porcentajeDoctor > 0 &&
        totalVenta > 0
      ) {
        puntosDoctorShaddaiGanados = calcularPuntosPorcentaje({
          total: totalVenta,
          porcentaje: porcentajeDoctor,
          activo: true,
        });

        if (puntosDoctorShaddaiGanados > 0) {
          await client.query(
            `
            INSERT INTO doctores_puntos_movimientos (
              id_doctor,
              id_usuario,
              id_receta,
              id_venta,
              tipo_movimiento,
              puntos,
              descripcion,
              fecha_movimiento,
              origen_doctor
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              'ACUMULACION_VENTA_SHADDAI',
              $5,
              $6,
              CURRENT_TIMESTAMP,
              'SHADDAI'
            )
            `,
            [
              doctorShaddaiVenta.id_perfil,
              doctorShaddaiVenta.id_usuario,
              null,
              venta.id_venta,
              puntosDoctorShaddaiGanados,
              `Puntos generados por venta ${folio} | Doctor Shaddai ${doctorShaddaiVenta.nombre_completo} | Receta Shaddai #${idRecetaShaddaiVenta || 'N/A'} | Servicio clínico #${idSolicitudServicioVenta || 'N/A'} | ${porcentajeDoctor}% sobre $${totalVenta.toFixed(2)}`,
            ]
          );

          doctorShaddaiPuntos = {
            id_doctor: doctorShaddaiVenta.id_perfil,
            nombre_completo: doctorShaddaiVenta.nombre_completo,
            porcentaje_puntos_venta: porcentajeDoctor,
            puntos_ganados: puntosDoctorShaddaiGanados,
          };
        }
      }
    }

    for (const item of productosProcesados) {
      const detalleVentaResultado = await client.query(
        `
        INSERT INTO venta_detalle (
          id_venta,
          id_producto,
          id_lote,
          cantidad,
          precio_unitario,
          precio_original,
          porcentaje_descuento,
          descuento_unitario,
          id_oferta,
          descuento,
          subtotal,
          id_receta_shaddai,
          id_detalle_receta_shaddai
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
        )
        RETURNING id_detalle
        `,
        [
          venta.id_venta,
          item.id_producto,
          item.id_lote,
          item.cantidad,
          item.precio_unitario,
          item.precio_original,
          item.porcentaje_descuento,
          item.descuento_unitario,
          item.id_oferta,
          item.descuento,
          item.subtotal,
          item.id_receta_shaddai,
          item.id_detalle_receta_shaddai,
        ]
      );

      const idDetalleVenta = detalleVentaResultado.rows[0].id_detalle;

      if (item.datos_control_sanitario) {
        const loteControl = item.lotes_descontados?.[0] || null;

        await registrarLibroControlSanitario({
          client,
          idVenta: venta.id_venta,
          idDetalleVenta,
          idProducto: item.id_producto,
          idLote: item.id_lote || loteControl?.id_lote || null,
          idSucursal: id_sucursal,
          tipoMovimiento: 'SALIDA',
          cantidadEntrada: 0,
          cantidadSalida: item.cantidad,
          existenciaDespues:
            loteControl?.stock_lote_nuevo ?? item.stock_nuevo ?? null,
          datosControl: item.datos_control_sanitario,
          idUsuario: req.usuario.id_usuario,
        });
      }

      if (item.id_receta_shaddai && item.id_detalle_receta_shaddai) {
        await client.query(
          `
          UPDATE recetas_shaddai_detalle
          SET
            cantidad_surtida = LEAST(
              COALESCE(cantidad, 0),
              COALESCE(cantidad_surtida, 0) + $1
            ),
            fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_detalle = $2
            AND id_receta = $3
          `,
          [
            Number(item.cantidad || 0),
            item.id_detalle_receta_shaddai,
            item.id_receta_shaddai,
          ]
        );
      }

      for (const loteDesc of item.lotes_descontados) {
        await client.query(
          `
          INSERT INTO inventario_movimientos (
            id_sucursal,
            id_producto,
            id_lote,
            tipo_movimiento,
            cantidad,
            stock_anterior,
            stock_nuevo,
            referencia,
            observaciones,
            id_usuario
          )
          VALUES ($1,$2,$3,'VENTA',$4,$5,$6,$7,$8,$9)
          `,
          [
            id_sucursal,
            item.id_producto,
            loteDesc.id_lote,
            loteDesc.cantidad_descontada,
            item.stock_anterior,
            item.stock_nuevo,
            folio,
            `Venta ${folio} | Lote ${loteDesc.lote}`,
            req.usuario.id_usuario,
          ]
        );
      }
    }

    for (const item of serviciosProcesados) {
      await client.query(
        `
        INSERT INTO venta_servicios_detalle (
          id_venta,
          id_solicitud_servicio,
          id_detalle_servicio,
          id_servicio,
          nombre_servicio,
          cantidad,
          precio_unitario,
          subtotal,
          folio_servicio,
          nombre_paciente
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          venta.id_venta,
          item.id_solicitud_servicio,
          item.id_detalle_servicio,
          item.id_servicio,
          item.nombre_servicio,
          item.cantidad,
          item.precio_unitario,
          item.subtotal,
          item.folio_servicio,
          item.nombre_paciente,
        ]
      );
    }

    const solicitudesServiciosVendidas = [
      ...new Set(
        serviciosProcesados
          .map((item) => item.id_solicitud_servicio)
          .filter(Boolean)
      ),
    ];

    for (const idSolicitudServicio of solicitudesServiciosVendidas) {
      await client.query(
        `
        UPDATE servicios_clinicos_solicitudes
        SET
          estatus = 'PAGADO',
          fecha_pago = CURRENT_TIMESTAMP,
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_solicitud_servicio = $1
          AND estatus = 'PENDIENTE_CAJERO'
        `,
        [idSolicitudServicio]
      );

      await client.query(
        `
        UPDATE documentos_clinicos
        SET
          estatus = 'PAGADO',
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE tabla_origen = 'servicios_clinicos_solicitudes'
          AND id_origen = $1
        `,
        [idSolicitudServicio]
      );
    }

    const recetasShaddaiVendidas = [
      ...new Set(
        productosProcesados
          .map((item) => item.id_receta_shaddai)
          .filter(Boolean)
      ),
    ];

    for (const idRecetaVendida of recetasShaddaiVendidas) {
      recetaShaddaiActualizada = await actualizarEstatusRecetaShaddai({
        client,
        idReceta: idRecetaVendida,
      });
    }

    let tarjetaActualizada = null;

    if (puntosUsados > 0) {
      const puntosAnteriores = Number(tarjetaPuntos.puntos_actuales || 0);
      const puntosNuevos = redondearDos(puntosAnteriores - puntosUsados);

      const tarjetaUpdate = await client.query(
        `
        UPDATE tarjetas_puntos
        SET
          puntos_actuales = puntos_actuales - $1,
          puntos_canjeados = puntos_canjeados + $1,
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_tarjeta = $2
        RETURNING
          id_tarjeta,
          codigo_barras,
          nombre_cliente,
          puntos_actuales,
          puntos_acumulados,
          puntos_canjeados,
          activo
        `,
        [puntosUsados, tarjetaPuntos.id_tarjeta]
      );

      tarjetaActualizada = tarjetaUpdate.rows[0];

      await client.query(
        `
        INSERT INTO tarjetas_puntos_movimientos (
          id_tarjeta,
          id_venta,
          id_usuario,
          tipo_movimiento,
          puntos,
          puntos_anteriores,
          puntos_nuevos,
          descripcion
        )
        VALUES ($1,$2,$3,'CANJE',$4,$5,$6,$7)
        `,
        [
          tarjetaPuntos.id_tarjeta,
          venta.id_venta,
          req.usuario.id_usuario,
          puntosUsados * -1,
          puntosAnteriores,
          puntosNuevos,
          `Pago con puntos en venta ${folio}`,
        ]
      );
    }

    if (tarjetaPuntos && puntosClienteGanados > 0) {
      const puntosAnteriores = Number(tarjetaPuntos.puntos_actuales || 0);
      const puntosNuevos = redondearDos(puntosAnteriores + puntosClienteGanados);

      const tarjetaUpdate = await client.query(
        `
        UPDATE tarjetas_puntos
        SET
          puntos_actuales = puntos_actuales + $1,
          puntos_acumulados = puntos_acumulados + $1,
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_tarjeta = $2
        RETURNING
          id_tarjeta,
          codigo_barras,
          nombre_cliente,
          puntos_actuales,
          puntos_acumulados,
          puntos_canjeados,
          activo
        `,
        [puntosClienteGanados, tarjetaPuntos.id_tarjeta]
      );

      tarjetaActualizada = tarjetaUpdate.rows[0];

      await client.query(
        `
        INSERT INTO tarjetas_puntos_movimientos (
          id_tarjeta,
          id_venta,
          id_usuario,
          tipo_movimiento,
          puntos,
          puntos_anteriores,
          puntos_nuevos,
          descripcion
        )
        VALUES ($1,$2,$3,'ACUMULACION',$4,$5,$6,$7)
        `,
        [
          tarjetaPuntos.id_tarjeta,
          venta.id_venta,
          req.usuario.id_usuario,
          puntosClienteGanados,
          puntosAnteriores,
          puntosNuevos,
          `Puntos acumulados por venta ${folio}`,
        ]
      );
    }

    if (puntosCajeroGanados > 0) {
      await client.query(
        `
        INSERT INTO cajeros_puntos_movimientos (
          id_usuario,
          id_venta,
          tipo_movimiento,
          puntos,
          porcentaje_aplicado,
          monto_base,
          descripcion
        )
        VALUES ($1,$2,'VENTA',$3,$4,$5,$6)
        `,
        [
          req.usuario.id_usuario,
          venta.id_venta,
          puntosCajeroGanados,
          Number(configuracionPuntos.porcentaje_cajero || 0),
          totalVenta,
          `Puntos generados al cajero por venta ${folio}`,
        ]
      );
    }

    const pagosConMovimientoCaja = pagosVenta.filter((pago) => {
      return Number(pago.monto || 0) > 0;
    });

    for (const pagoCaja of pagosConMovimientoCaja) {
      await client.query(
        `
    INSERT INTO caja_movimientos (
      id_sesion,
      id_sucursal,
      tipo_movimiento,
      concepto,
      monto,
      metodo_pago,
      referencia,
      observaciones,
      id_usuario
    )
    VALUES ($1,$2,'VENTA',$3,$4,$5,$6,$7,$8)
    `,
        [
          id_sesion,
          id_sucursal,
          `Venta ${folio}`,
          redondearDos(pagoCaja.monto),
          pagoCaja.metodo_pago,
          folio,
          tarjetaPuntos
            ? `Venta registrada desde POS | Método ${pagoCaja.metodo_pago} | Tarjeta ${tarjetaPuntos.codigo_barras} | Puntos usados: ${puntosUsados} | Puntos cliente: ${puntosClienteGanados} | Descuento ofertas: ${descuentoOfertasVenta} | Puntos cajero: ${puntosCajeroGanados} | Puntos doctor Shaddai: ${puntosDoctorShaddaiGanados}`
            : `Venta registrada desde POS | Método ${pagoCaja.metodo_pago} | Descuento ofertas: ${descuentoOfertasVenta} | Puntos cajero: ${puntosCajeroGanados} | Puntos doctor Shaddai: ${puntosDoctorShaddaiGanados}`,
          req.usuario.id_usuario,
        ]
      );
    }

    await client.query('COMMIT');

    /*
     * El envío del ticket digital ocurre después del COMMIT.
     * Si el correo falla, la venta ya quedó registrada y el error solo se
     * devuelve como información al POS; nunca se revierte una venta válida.
     */
    const tarjetaParaTicketDigital = tarjetaPuntos
      ? {
        ...tarjetaPuntos,
        ...(tarjetaActualizada || {}),
      }
      : null;

    const ticketDigital = esValorActivo(enviar_ticket_digital)
      ? await enviarTicketDigitalVenta({
        idSucursal: Number(id_sucursal),
        tarjeta: tarjetaParaTicketDigital,
        venta,
        productos: productosProcesados,
        servicios: serviciosProcesados,
        pagos: pagosVenta,
        resumen: {
          subtotal: subtotalVenta,
          subtotal_sin_descuento: subtotalSinDescuentoVenta,
          descuento_ofertas: descuentoOfertasVenta,
          descuento: descuentoVenta,
          impuesto: impuestoVenta,
          total: totalVenta,
          metodo_pago: metodoPagoFinal,
          monto_recibido: montoRecibidoFinal,
          cambio,
          monto_pagado_dinero: montoPagadoDinero,
          monto_pagado_puntos: montoPagadoPuntos,
          puntos_usados: puntosUsados,
          puntos_ganados: puntosClienteGanados,
          puntos_ganados_cliente: puntosClienteGanados,
        },
      })
      : {
        solicitado: false,
        enviado: false,
        estatus: 'NO_SOLICITADO',
        mensaje: 'No se solicitó el envío de ticket digital para esta venta.',
      };

    return res.status(201).json({
      ok: true,
      mensaje: 'Venta registrada correctamente',
      venta: {
        ...venta,
        productos: productosProcesados,
        servicios: serviciosProcesados,
        pagos: pagosVenta,
        tarjeta_puntos: tarjetaActualizada,
        doctor_shaddai_puntos: doctorShaddaiPuntos,
        receta_shaddai_actualizada: recetaShaddaiActualizada,
        ticket_digital: ticketDigital,
      },
      resumen: {
        subtotal: subtotalVenta,
        subtotal_sin_descuento: subtotalSinDescuentoVenta,
        descuento_ofertas: descuentoOfertasVenta,
        descuento: descuentoVenta,
        impuesto: impuestoVenta,
        total: totalVenta,
        metodo_pago: metodoPagoFinal,
        monto_recibido: montoRecibidoFinal,
        cambio,
        monto_pagado_dinero: montoPagadoDinero,
        monto_pagado_puntos: montoPagadoPuntos,
        puntos_usados: puntosUsados,
        pagos: pagosVenta,
        puntos_ganados: puntosClienteGanados,
        puntos_ganados_cliente: puntosClienteGanados,
        puntos_ganados_cajero: puntosCajeroGanados,
        puntos_ganados_doctor_shaddai: puntosDoctorShaddaiGanados,
        doctor_shaddai_puntos: doctorShaddaiPuntos,
        estatus_receta_shaddai: recetaShaddaiActualizada?.estatus || null,
        tarjeta_puntos: tarjetaActualizada,
        ticket_digital: ticketDigital,
        configuracion_puntos: {
          porcentaje_cliente: configuracionPuntos.porcentaje_cliente,
          porcentaje_cajero: configuracionPuntos.porcentaje_cajero,
          puntos_cliente_activo: configuracionPuntos.puntos_cliente_activo,
          puntos_cajero_activo: configuracionPuntos.puntos_cajero_activo,
        },
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al crear venta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: error.message || 'Error interno al registrar venta',
    });
  } finally {
    client.release();
  }
};

export const obtenerInfoDevolucionVenta = async (req, res) => {
  try {
    const { id } = req.params;

    const ventaResultado = await pool.query(
      `
      SELECT
        v.id_venta,
        v.folio,
        v.id_sucursal,
        s.nombre AS sucursal,
        v.id_caja,
        c.nombre AS caja,
        v.id_sesion,
        v.id_usuario,
        u.nombre AS usuario,
        v.subtotal,
        v.descuento,
        v.impuesto,
        v.total,
        v.metodo_pago,
        v.monto_recibido,
        v.cambio,
        v.estado,
        v.fecha_venta
      FROM ventas v
      INNER JOIN sucursales s ON s.id_sucursal = v.id_sucursal
      INNER JOIN cajas c ON c.id_caja = v.id_caja
      INNER JOIN usuarios u ON u.id_usuario = v.id_usuario
      WHERE v.id_venta = $1
      `,
      [id]
    );

    if (ventaResultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Venta no encontrada',
      });
    }

    const venta = ventaResultado.rows[0];

    const accesoCaja = await validarAccesoCajaAsignada({
      db: pool,
      usuario: req.usuario,
      idCaja: venta.id_caja,
      idSucursal: venta.id_sucursal,
    });

    if (!accesoCaja.ok) {
      return responderAccesoCajaDenegado(res, accesoCaja);
    }

    const detalleResultado = await pool.query(
      `
      SELECT
        vd.id_detalle,
        vd.id_venta,
        vd.id_producto,
        p.nombre AS producto,
        p.codigo_barras,
        vd.id_lote,
        il.lote,
        il.fecha_caducidad,
        vd.cantidad,
        vd.precio_unitario,
        vd.descuento,
        vd.subtotal,
        COALESCE(dev.cantidad_devuelta, 0)::numeric(12,2) AS cantidad_devuelta,
        (
          COALESCE(vd.cantidad, 0) - COALESCE(dev.cantidad_devuelta, 0)
        )::numeric(12,2) AS cantidad_disponible_devolver
      FROM venta_detalle vd
      INNER JOIN productos p ON p.id_producto = vd.id_producto
      LEFT JOIN inventario_lotes il ON il.id_lote = vd.id_lote
      LEFT JOIN (
        SELECT
          id_detalle,
          COALESCE(SUM(cantidad_devuelta), 0)::numeric(12,2) AS cantidad_devuelta
        FROM ventas_devoluciones_detalle
        GROUP BY id_detalle
      ) dev ON dev.id_detalle = vd.id_detalle
      WHERE vd.id_venta = $1
      ORDER BY vd.id_detalle ASC
      `,
      [id]
    );

    const montoDevueltoResultado = await pool.query(
      `
      SELECT COALESCE(SUM(monto_devuelto), 0)::numeric(12,2) AS monto_devuelto
      FROM ventas_devoluciones
      WHERE id_venta = $1
        AND estado = 'APLICADA'
      `,
      [id]
    );

    return res.json({
      ok: true,
      venta: {
        ...venta,
        monto_devuelto: Number(montoDevueltoResultado.rows[0]?.monto_devuelto || 0),
      },
      productos: detalleResultado.rows,
    });
  } catch (error) {
    console.error('Error al obtener información de devolución:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener información de devolución',
    });
  }
};

export const listarVentas = async (req, res) => {
  try {
    const {
      sucursal,
      sesion,
      fecha_inicio,
      fecha_fin,
    } = req.query;

    let query = `
      SELECT
        v.id_venta,
        v.folio,
        v.id_sucursal,
        s.nombre AS sucursal,
        v.id_caja,
        c.nombre AS caja,
        v.id_sesion,
        v.id_usuario,
        u.nombre AS usuario,
        v.subtotal,
        v.subtotal_sin_descuento,
        v.descuento_ofertas,
        v.descuento,
        v.impuesto,
        v.total,
        v.monto_pagado_dinero,
        v.monto_pagado_puntos,
        v.puntos_usados,
        v.metodo_pago,
        v.monto_recibido,
        v.cambio,
        v.estado,
        v.id_tarjeta_puntos,
        tp.codigo_barras AS tarjeta_codigo_barras,
        tp.nombre_cliente AS tarjeta_cliente,
        v.puntos_ganados,
        v.id_doctor,
        dsp.nombre_completo AS doctor_shaddai,
        v.fecha_venta,
        COALESCE(cpm.puntos, 0)::numeric(12,2) AS puntos_cajero,
        COALESCE(dpm.puntos, 0)::numeric(12,2)
          AS puntos_doctor_shaddai
      FROM ventas v
      INNER JOIN sucursales s
        ON s.id_sucursal = v.id_sucursal
      INNER JOIN cajas c
        ON c.id_caja = v.id_caja
      INNER JOIN usuarios u
        ON u.id_usuario = v.id_usuario
      LEFT JOIN tarjetas_puntos tp
        ON tp.id_tarjeta = v.id_tarjeta_puntos
      LEFT JOIN doctores_shaddai_perfiles dsp
        ON dsp.id_perfil = v.id_doctor
      LEFT JOIN cajeros_puntos_movimientos cpm
        ON cpm.id_venta = v.id_venta
       AND cpm.id_usuario = v.id_usuario
       AND cpm.tipo_movimiento = 'VENTA'
      LEFT JOIN doctores_puntos_movimientos dpm
        ON dpm.id_venta = v.id_venta
       AND dpm.origen_doctor = 'SHADDAI'
       AND dpm.tipo_movimiento =
         'ACUMULACION_VENTA_SHADDAI'
      WHERE 1 = 1
    `;

    const params = [];

    /*
     * Los usuarios normales solamente pueden consultar las ventas
     * correspondientes a la caja que tienen asignada.
     */
    if (!esSuperAdmin(req.usuario)) {
      const idUsuario =
        obtenerIdUsuarioAutenticado(req.usuario);

      if (!idUsuario) {
        return res.status(401).json({
          ok: false,
          mensaje:
            'No se pudo identificar al usuario de la sesión',
        });
      }

      params.push(idUsuario);

      query += `
        AND c.id_usuario_asignado = $${params.length}
      `;
    }

    if (sucursal) {
      params.push(Number(sucursal));

      query += `
        AND v.id_sucursal = $${params.length}
      `;
    }

    if (sesion) {
      params.push(Number(sesion));

      query += `
        AND v.id_sesion = $${params.length}
      `;
    }

    if (fecha_inicio) {
      params.push(fecha_inicio);

      query += `
        AND (
          v.fecha_venta AT TIME ZONE 'America/Mexico_City'
        )::date >= $${params.length}::date
      `;
    }

    if (fecha_fin) {
      params.push(fecha_fin);

      query += `
        AND (
          v.fecha_venta AT TIME ZONE 'America/Mexico_City'
        )::date <= $${params.length}::date
      `;
    }

    query += `
      ORDER BY v.fecha_venta DESC
    `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      ventas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar ventas:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack,
    });

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar ventas',
    });
  }
};

export const obtenerVenta = async (req, res) => {
  try {
    const { id } = req.params;

    const ventaResultado = await pool.query(
      `
      SELECT
        v.id_venta,
        v.folio,
        v.id_sucursal,
        s.nombre AS sucursal,
        v.id_caja,
        c.nombre AS caja,
        v.id_sesion,
        v.id_usuario,
        u.nombre AS usuario,
        v.subtotal,
        v.subtotal_sin_descuento,
        v.descuento_ofertas,
        v.descuento,
        v.impuesto,
        v.total,
        v.monto_pagado_dinero,
        v.monto_pagado_puntos,
        v.puntos_usados,
        v.metodo_pago,
        v.monto_recibido,
        v.cambio,
        v.estado,
        v.id_tarjeta_puntos,
        tp.codigo_barras AS tarjeta_codigo_barras,
        tp.nombre_cliente AS tarjeta_cliente,
        v.puntos_ganados,
        v.id_doctor,
        dsp.nombre_completo AS doctor_shaddai,
        v.fecha_venta,
        COALESCE(cpm.puntos, 0)::numeric(12,2) AS puntos_cajero,
        cpm.porcentaje_aplicado AS porcentaje_cajero_aplicado,
        COALESCE(dpm.puntos, 0)::numeric(12,2) AS puntos_doctor_shaddai,
        dpm.descripcion AS descripcion_puntos_doctor_shaddai
      FROM ventas v
      INNER JOIN sucursales s ON s.id_sucursal = v.id_sucursal
      INNER JOIN cajas c ON c.id_caja = v.id_caja
      INNER JOIN usuarios u ON u.id_usuario = v.id_usuario
      LEFT JOIN tarjetas_puntos tp ON tp.id_tarjeta = v.id_tarjeta_puntos
      LEFT JOIN doctores_shaddai_perfiles dsp ON dsp.id_perfil = v.id_doctor
      LEFT JOIN cajeros_puntos_movimientos cpm 
        ON cpm.id_venta = v.id_venta 
       AND cpm.id_usuario = v.id_usuario
       AND cpm.tipo_movimiento = 'VENTA'
      LEFT JOIN doctores_puntos_movimientos dpm
        ON dpm.id_venta = v.id_venta
       AND dpm.origen_doctor = 'SHADDAI'
       AND dpm.tipo_movimiento = 'ACUMULACION_VENTA_SHADDAI'
      WHERE v.id_venta = $1
      `,
      [id]
    );

    if (ventaResultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Venta no encontrada',
      });
    }

    const venta = ventaResultado.rows[0];

    const accesoCaja = await validarAccesoCajaAsignada({
      db: pool,
      usuario: req.usuario,
      idCaja: venta.id_caja,
      idSucursal: venta.id_sucursal,
    });

    if (!accesoCaja.ok) {
      return responderAccesoCajaDenegado(res, accesoCaja);
    }

    const detalleResultado = await pool.query(
      `
      SELECT
        vd.id_detalle,
        vd.id_producto,
        vd.id_lote,
        vd.id_receta_shaddai,
        vd.id_detalle_receta_shaddai,
        il.lote,
        il.fecha_caducidad,
        p.codigo_barras,
        p.nombre AS producto,
        vd.cantidad,
        vd.precio_unitario,
        vd.precio_original,
        vd.porcentaje_descuento,
        vd.descuento_unitario,
        vd.id_oferta,
        oc.nombre AS oferta_nombre,
        vd.descuento,
        vd.subtotal
      FROM venta_detalle vd
      INNER JOIN productos p ON p.id_producto = vd.id_producto
      LEFT JOIN inventario_lotes il ON il.id_lote = vd.id_lote
      LEFT JOIN ofertas_categorias oc ON oc.id_oferta = vd.id_oferta
      WHERE vd.id_venta = $1
      ORDER BY vd.id_detalle ASC
      `,
      [id]
    );

    const pagosResultado = await pool.query(
      `
      SELECT
        id_pago,
        id_venta,
        metodo_pago,
        monto,
        referencia,
        fecha_pago
      FROM ventas_pagos
      WHERE id_venta = $1
      ORDER BY id_pago ASC
      `,
      [id]
    );

    const lotesResultado = await pool.query(
      `
      SELECT
        im.id_movimiento,
        im.id_producto,
        p.nombre AS producto,
        im.id_lote,
        il.lote,
        il.fecha_caducidad,
        im.cantidad,
        im.stock_anterior,
        im.stock_nuevo,
        im.referencia,
        im.observaciones,
        im.fecha_movimiento
      FROM inventario_movimientos im
      INNER JOIN productos p ON p.id_producto = im.id_producto
      LEFT JOIN inventario_lotes il ON il.id_lote = im.id_lote
      WHERE im.referencia = $1
        AND im.tipo_movimiento = 'VENTA'
      ORDER BY p.nombre ASC, il.fecha_caducidad ASC NULLS LAST
      `,
      [ventaResultado.rows[0].folio]
    );

    const controlSanitarioResultado = await pool.query(
      `
      SELECT
        lcs.id_movimiento,
        lcs.id_venta,
        lcs.id_detalle_venta,
        lcs.id_producto,
        p.nombre AS producto,
        lcs.id_lote,
        il.lote,
        il.fecha_caducidad,
        lcs.tipo_movimiento,
        lcs.cantidad_entrada,
        lcs.cantidad_salida,
        lcs.existencia_despues,
        lcs.tipo_receta,
        lcs.numero_receta,
        lcs.fecha_receta,
        lcs.medico_nombre,
        lcs.medico_cedula,
        lcs.paciente_nombre,
        lcs.paciente_telefono,
        lcs.cantidad_recetada,
        lcs.cantidad_surtida,
        lcs.cantidad_pendiente,
        lcs.tipo_surtido,
        lcs.observaciones,
        lcs.estatus,
        lcs.fecha_registro
      FROM libro_control_sanitario lcs
      INNER JOIN productos p ON p.id_producto = lcs.id_producto
      LEFT JOIN inventario_lotes il ON il.id_lote = lcs.id_lote
      WHERE lcs.id_venta = $1
      ORDER BY lcs.fecha_registro ASC, lcs.id_movimiento ASC
      `,
      [id]
    );

    return res.json({
      ok: true,
      venta: ventaResultado.rows[0],
      detalle: detalleResultado.rows,
      pagos: pagosResultado.rows,
      lotes: lotesResultado.rows,
      control_sanitario: controlSanitarioResultado.rows,
    });
  } catch (error) {
    console.error('Error al obtener venta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener venta',
    });
  }
};


export const devolverVenta = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { productos, motivo, observaciones } = req.body;

    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Debes enviar al menos un producto para devolver',
      });
    }

    if (!motivo || !String(motivo).trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El motivo de la devolución es obligatorio',
      });
    }

    await client.query('BEGIN');

    const ventaResultado = await client.query(
      `
  SELECT
    id_venta,
    folio,
    id_sucursal,
    id_caja,
    id_sesion,
    subtotal,
    descuento,
    impuesto,
    total,
    metodo_pago,
    estado
  FROM ventas
  WHERE id_venta = $1
  FOR UPDATE
  `,
      [id]
    );

    if (ventaResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Venta no encontrada',
      });
    }

    const venta = ventaResultado.rows[0];

    const accesoCaja = await validarAccesoCajaAsignada({
      db: client,
      usuario: req.usuario,
      idCaja: venta.id_caja,
      idSucursal: venta.id_sucursal,
      bloquear: true,
    });

    if (!accesoCaja.ok) {
      await client.query('ROLLBACK');
      return responderAccesoCajaDenegado(res, accesoCaja);
    }

    const estadoVenta = String(venta.estado || '').toUpperCase();

    if (!estadosVentaConDevolucionPermitida.includes(estadoVenta)) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: `No se puede devolver una venta con estado ${estadoVenta}`,
      });
    }

    const sesionResultado = await client.query(
      `
      SELECT id_sesion, estado
      FROM caja_sesiones
      WHERE id_sesion = $1
      `,
      [venta.id_sesion]
    );

    if (sesionResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró la sesión de caja de la venta',
      });
    }

    if (sesionResultado.rows[0].estado !== 'ABIERTA') {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje:
          'La caja de esta venta ya está cerrada. Por ahora solo se permiten devoluciones de ventas de la caja abierta.',
      });
    }

    let montoDevueltoTotal = 0;
    const detallesDevueltos = [];

    for (const item of productos) {
      const idDetalle = Number(item.id_detalle);
      const cantidadSolicitada = Number(item.cantidad || 0);

      if (!idDetalle || cantidadSolicitada <= 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'Cada producto debe incluir id_detalle y cantidad mayor a cero',
        });
      }

      const detalleResultado = await client.query(
        `
        SELECT
          vd.id_detalle,
          vd.id_venta,
          vd.id_producto,
          p.nombre AS producto,
          vd.cantidad,
          vd.precio_unitario,
          vd.subtotal
        FROM venta_detalle vd
        INNER JOIN productos p ON p.id_producto = vd.id_producto
        WHERE vd.id_detalle = $1
          AND vd.id_venta = $2
        FOR UPDATE
        `,
        [idDetalle, venta.id_venta]
      );

      if (detalleResultado.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: `No se encontró el detalle de venta ${idDetalle}`,
        });
      }

      const detalle = detalleResultado.rows[0];

      const devueltoResultado = await client.query(
        `
        SELECT COALESCE(SUM(cantidad_devuelta), 0)::numeric(12,2) AS cantidad_devuelta
        FROM ventas_devoluciones_detalle
        WHERE id_detalle = $1
        `,
        [idDetalle]
      );

      const cantidadVendida = Number(detalle.cantidad || 0);
      const cantidadYaDevuelta = Number(
        devueltoResultado.rows[0]?.cantidad_devuelta || 0
      );
      const cantidadDisponible = cantidadVendida - cantidadYaDevuelta;

      if (cantidadSolicitada > cantidadDisponible) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `No puedes devolver ${cantidadSolicitada} de ${detalle.producto}. Disponible para devolver: ${cantidadDisponible}`,
        });
      }

      const subtotalDetalle = Number(detalle.subtotal || 0);
      const totalVenta = Number(venta.total || 0);
      const subtotalVenta = Number(venta.subtotal || 0);

      const factorTotalVenta =
        subtotalVenta > 0
          ? totalVenta / subtotalVenta
          : 1;

      const precioProporcionalSubtotal = redondearDos(
        subtotalDetalle / cantidadVendida
      );

      const subtotalDevuelto = redondearDos(
        precioProporcionalSubtotal * cantidadSolicitada
      );

      const totalDevueltoConImpuesto = redondearDos(
        subtotalDevuelto * factorTotalVenta
      );

      montoDevueltoTotal += totalDevueltoConImpuesto;

      detallesDevueltos.push({
        id_detalle: detalle.id_detalle,
        id_producto: detalle.id_producto,
        producto: detalle.producto,
        cantidad_devuelta: cantidadSolicitada,
        precio_unitario: precioProporcionalSubtotal,
        subtotal_devuelto: subtotalDevuelto,
      });
    }

    montoDevueltoTotal = redondearDos(montoDevueltoTotal);

    if (montoDevueltoTotal <= 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El monto de la devolución debe ser mayor a cero',
      });
    }

    const folioDevolucion = generarFolioDevolucion();

    const devolucionResultado = await client.query(
      `
      INSERT INTO ventas_devoluciones (
        id_venta,
        id_sesion,
        id_sucursal,
        id_usuario,
        folio_devolucion,
        metodo_pago_original,
        monto_devuelto,
        motivo,
        observaciones,
        estado
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'APLICADA')
      RETURNING *
      `,
      [
        venta.id_venta,
        venta.id_sesion,
        venta.id_sucursal,
        req.usuario.id_usuario,
        folioDevolucion,
        venta.metodo_pago,
        montoDevueltoTotal,
        motivo.trim(),
        observaciones ? observaciones.trim() : null,
      ]
    );

    const devolucion = devolucionResultado.rows[0];

    for (const detalle of detallesDevueltos) {
      let cantidadPendienteRestituir = Number(detalle.cantidad_devuelta);

      const lotesVentaResultado = await client.query(
        `
        SELECT
          im.id_lote,
          il.lote,
          im.cantidad,
          im.stock_nuevo
        FROM inventario_movimientos im
        LEFT JOIN inventario_lotes il ON il.id_lote = im.id_lote
        WHERE im.referencia = $1
          AND im.tipo_movimiento = 'VENTA'
          AND im.id_producto = $2
        ORDER BY im.fecha_movimiento ASC, im.id_movimiento ASC
        `,
        [venta.folio, detalle.id_producto]
      );

      if (lotesVentaResultado.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `No se encontraron movimientos de inventario de venta para ${detalle.producto}`,
        });
      }

      for (const loteVenta of lotesVentaResultado.rows) {
        if (cantidadPendienteRestituir <= 0) break;

        const devueltoPorLoteResultado = await client.query(
          `
          SELECT COALESCE(SUM(cantidad_devuelta), 0)::numeric(12,2) AS cantidad_devuelta
          FROM ventas_devoluciones_detalle
          WHERE id_venta = $1
            AND id_producto = $2
            AND id_lote IS NOT DISTINCT FROM $3
          `,
          [venta.id_venta, detalle.id_producto, loteVenta.id_lote]
        );

        const cantidadLoteVendida = Number(loteVenta.cantidad || 0);
        const cantidadLoteYaDevuelta = Number(
          devueltoPorLoteResultado.rows[0]?.cantidad_devuelta || 0
        );
        const cantidadLoteDisponible =
          cantidadLoteVendida - cantidadLoteYaDevuelta;

        if (cantidadLoteDisponible <= 0) continue;

        const cantidadARestituir = Math.min(
          cantidadPendienteRestituir,
          cantidadLoteDisponible
        );

        const loteActualResultado = await client.query(
          `
          SELECT
            id_lote,
            stock_actual
          FROM inventario_lotes
          WHERE id_lote = $1
          FOR UPDATE
          `,
          [loteVenta.id_lote]
        );

        if (loteActualResultado.rows.length === 0) {
          await client.query('ROLLBACK');

          return res.status(404).json({
            ok: false,
            mensaje: `No se encontró el lote para restituir ${detalle.producto}`,
          });
        }

        const stockLoteAnterior = Number(
          loteActualResultado.rows[0].stock_actual || 0
        );
        const stockLoteNuevo = redondearDos(
          stockLoteAnterior + cantidadARestituir
        );

        await client.query(
          `
          UPDATE inventario_lotes
          SET
            stock_actual = $1,
            activo = true,
            fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_lote = $2
          `,
          [stockLoteNuevo, loteVenta.id_lote]
        );

        const inventarioResultado = await client.query(
          `
          SELECT
            id_inventario,
            stock_actual
          FROM inventario_sucursal
          WHERE id_sucursal = $1
            AND id_producto = $2
          FOR UPDATE
          `,
          [venta.id_sucursal, detalle.id_producto]
        );

        if (inventarioResultado.rows.length === 0) {
          await client.query('ROLLBACK');

          return res.status(404).json({
            ok: false,
            mensaje: `No se encontró inventario de sucursal para ${detalle.producto}`,
          });
        }

        const stockSucursalAnterior = Number(
          inventarioResultado.rows[0].stock_actual || 0
        );
        const stockSucursalNuevo = redondearDos(
          stockSucursalAnterior + cantidadARestituir
        );

        await client.query(
          `
          UPDATE inventario_sucursal
          SET
            stock_actual = $1,
            fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_sucursal = $2
            AND id_producto = $3
          `,
          [stockSucursalNuevo, venta.id_sucursal, detalle.id_producto]
        );

        const subtotalParcial = redondearDos(
          detalle.precio_unitario * cantidadARestituir
        );

        await client.query(
          `
          INSERT INTO ventas_devoluciones_detalle (
            id_devolucion,
            id_venta,
            id_detalle,
            id_producto,
            id_lote,
            producto,
            cantidad_devuelta,
            precio_unitario,
            subtotal_devuelto
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
          [
            devolucion.id_devolucion,
            venta.id_venta,
            detalle.id_detalle,
            detalle.id_producto,
            loteVenta.id_lote,
            detalle.producto,
            cantidadARestituir,
            detalle.precio_unitario,
            subtotalParcial,
          ]
        );

        await client.query(
          `
          INSERT INTO inventario_movimientos (
            id_sucursal,
            id_producto,
            id_lote,
            tipo_movimiento,
            cantidad,
            stock_anterior,
            stock_nuevo,
            referencia,
            observaciones,
            id_usuario
          )
          VALUES ($1,$2,$3,'DEVOLUCION_VENTA',$4,$5,$6,$7,$8,$9)
          `,
          [
            venta.id_sucursal,
            detalle.id_producto,
            loteVenta.id_lote,
            cantidadARestituir,
            stockSucursalAnterior,
            stockSucursalNuevo,
            folioDevolucion,
            `Devolución ${folioDevolucion} de venta ${venta.folio} | ${motivo.trim()}`,
            req.usuario.id_usuario,
          ]
        );

        const controlOriginalResultado = await client.query(
          `
          SELECT
            tipo_receta,
            numero_receta,
            fecha_receta,
            medico_nombre,
            medico_cedula,
            paciente_nombre,
            paciente_telefono,
            cantidad_recetada,
            cantidad_surtida,
            cantidad_pendiente,
            tipo_surtido,
            observaciones
          FROM libro_control_sanitario
          WHERE id_venta = $1
            AND id_producto = $2
            AND id_lote IS NOT DISTINCT FROM $3
            AND tipo_movimiento = 'SALIDA'
          ORDER BY id_movimiento ASC
          LIMIT 1
          `,
          [venta.id_venta, detalle.id_producto, loteVenta.id_lote]
        );

        if (controlOriginalResultado.rows.length > 0) {
          const controlOriginal = controlOriginalResultado.rows[0];

          await registrarLibroControlSanitario({
            client,
            idVenta: venta.id_venta,
            idDetalleVenta: detalle.id_detalle,
            idProducto: detalle.id_producto,
            idLote: loteVenta.id_lote,
            idSucursal: venta.id_sucursal,
            tipoMovimiento: 'CANCELACION',
            cantidadEntrada: cantidadARestituir,
            cantidadSalida: 0,
            existenciaDespues: stockLoteNuevo,
            datosControl: {
              ...controlOriginal,
              observaciones: `Cancelación/devolución ${folioDevolucion} de venta ${venta.folio}. ${controlOriginal.observaciones || ''}`.trim(),
            },
            idUsuario: req.usuario.id_usuario,
          });
        }

        cantidadPendienteRestituir = redondearDos(
          cantidadPendienteRestituir - cantidadARestituir
        );
      }

      if (cantidadPendienteRestituir > 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `No se pudo restituir completamente ${detalle.producto}. Pendiente: ${cantidadPendienteRestituir}`,
        });
      }
    }

    const totalVendidoResultado = await client.query(
      `
      SELECT COALESCE(SUM(cantidad), 0)::numeric(12,2) AS cantidad_vendida
      FROM venta_detalle
      WHERE id_venta = $1
      `,
      [venta.id_venta]
    );

    const totalDevueltoResultado = await client.query(
      `
      SELECT COALESCE(SUM(cantidad_devuelta), 0)::numeric(12,2) AS cantidad_devuelta
      FROM ventas_devoluciones_detalle
      WHERE id_venta = $1
      `,
      [venta.id_venta]
    );

    const cantidadVendidaTotal = Number(
      totalVendidoResultado.rows[0]?.cantidad_vendida || 0
    );
    const cantidadDevueltaTotal = Number(
      totalDevueltoResultado.rows[0]?.cantidad_devuelta || 0
    );

    const nuevoEstadoVenta =
      cantidadDevueltaTotal >= cantidadVendidaTotal
        ? 'DEVUELTA'
        : 'DEVUELTA_PARCIAL';

    const ventaActualizadaResultado = await client.query(
      `
      UPDATE ventas
      SET estado = $1
      WHERE id_venta = $2
      RETURNING *
      `,
      [nuevoEstadoVenta, venta.id_venta]
    );

    await client.query(
      `
      INSERT INTO caja_movimientos (
        id_sesion,
        id_sucursal,
        tipo_movimiento,
        concepto,
        monto,
        metodo_pago,
        referencia,
        observaciones,
        id_usuario
      )
      VALUES ($1,$2,'DEVOLUCION_VENTA',$3,$4,$5,$6,$7,$8)
      `,
      [
        venta.id_sesion,
        venta.id_sucursal,
        `Devolución de venta ${venta.folio}`,
        montoDevueltoTotal,
        venta.metodo_pago,
        folioDevolucion,
        `Devolución ligada a venta ${venta.folio} | Motivo: ${motivo.trim()}`,
        req.usuario.id_usuario,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Devolución aplicada correctamente',
      devolucion,
      venta: ventaActualizadaResultado.rows[0],
      resumen: {
        folio_devolucion: folioDevolucion,
        folio_venta: venta.folio,
        metodo_pago_original: venta.metodo_pago,
        monto_devuelto: montoDevueltoTotal,
        estado_venta: nuevoEstadoVenta,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al devolver venta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: error.message || 'Error interno al devolver venta',
    });
  } finally {
    client.release();
  }
};


export const listarVentasServiciosClinicos = async (req, res) => {
  try {
    const {
      sucursal,
      fecha_inicio,
      fecha_fin,
      busqueda,
      estado = 'COMPLETADA',
    } = req.query;

    const params = [];

    let where = `
      WHERE 1 = 1
    `;

    if (!esSuperAdmin(req.usuario)) {
      const idUsuario = obtenerIdUsuarioAutenticado(req.usuario);

      if (!idUsuario) {
        return res.status(401).json({
          ok: false,
          mensaje: 'No se pudo identificar al usuario de la sesión',
        });
      }

      params.push(idUsuario);
      where += ` AND c.id_usuario_asignado = $${params.length} `;
    }

    if (estado && String(estado).toUpperCase() !== 'TODOS') {
      params.push(String(estado).toUpperCase());
      where += ` AND v.estado = $${params.length} `;
    }

    if (sucursal) {
      params.push(Number(sucursal));
      where += ` AND v.id_sucursal = $${params.length} `;
    }

    if (fecha_inicio) {
      params.push(fecha_inicio);
      where += ` AND v.fecha_venta::date >= $${params.length}::date `;
    }

    if (fecha_fin) {
      params.push(fecha_fin);
      where += ` AND v.fecha_venta::date <= $${params.length}::date `;
    }

    if (busqueda && String(busqueda).trim()) {
      params.push(`%${String(busqueda).trim()}%`);
      where += `
        AND (
          v.folio ILIKE $${params.length}
          OR vsd.folio_servicio ILIKE $${params.length}
          OR vsd.nombre_paciente ILIKE $${params.length}
          OR vsd.nombre_servicio ILIKE $${params.length}
          OR COALESCE(scs.diagnostico, '') ILIKE $${params.length}
          OR COALESCE(
            doctor_venta.nombre_completo,
            doctor_solicitud.nombre_completo,
            ''
          ) ILIKE $${params.length}
        )
      `;
    }

    const query = `
      SELECT
        vsd.id_venta_servicio,
        vsd.id_venta,
        vsd.id_solicitud_servicio,
        vsd.id_detalle_servicio,
        vsd.id_servicio,
        vsd.nombre_servicio,
        vsd.cantidad,
        vsd.precio_unitario,
        vsd.subtotal AS subtotal_servicio,
        vsd.folio_servicio,
        vsd.nombre_paciente,
        vsd.fecha_creacion AS fecha_registro_servicio,

        v.folio AS folio_venta,
        v.id_sucursal,
        suc.nombre AS sucursal,
        v.id_caja,
        c.nombre AS caja,
        v.id_sesion,
        v.id_usuario,
        u.nombre AS cajero,
        v.subtotal AS subtotal_venta,
        v.subtotal_sin_descuento,
        v.descuento_ofertas,
        v.descuento,
        v.impuesto,
        v.total AS total_venta,
        v.metodo_pago,
        v.monto_recibido,
        v.cambio,
        v.estado AS estado_venta,
        v.fecha_venta,

        scs.estatus AS estatus_servicio,
        scs.fecha_pago,
        scs.fecha_realizado,
        scs.diagnostico,
        scs.observaciones,
        scs.id_doctor AS id_usuario_doctor_solicitud,
        v.id_doctor AS id_perfil_doctor_venta,

        COALESCE(
          doctor_venta.nombre_completo,
          doctor_solicitud.nombre_completo
        ) AS doctor_shaddai
      FROM venta_servicios_detalle vsd
      INNER JOIN ventas v
        ON v.id_venta = vsd.id_venta
      LEFT JOIN servicios_clinicos_solicitudes scs
        ON scs.id_solicitud_servicio = vsd.id_solicitud_servicio
      LEFT JOIN sucursales suc
        ON suc.id_sucursal = v.id_sucursal
      LEFT JOIN cajas c
        ON c.id_caja = v.id_caja
      LEFT JOIN usuarios u
        ON u.id_usuario = v.id_usuario
      LEFT JOIN doctores_shaddai_perfiles doctor_venta
        ON doctor_venta.id_perfil = v.id_doctor
      LEFT JOIN doctores_shaddai_perfiles doctor_solicitud
        ON doctor_solicitud.id_usuario = scs.id_doctor
      ${where}
      ORDER BY v.fecha_venta DESC, vsd.id_venta_servicio DESC
    `;

    const resultado = await pool.query(query, params);

    const resumenQuery = `
      SELECT
        COUNT(*)::int AS total_registros,
        COUNT(DISTINCT v.id_venta)::int AS total_ventas,
        COALESCE(SUM(vsd.cantidad), 0)::numeric(12,2) AS total_cantidad_servicios,
        COALESCE(SUM(vsd.subtotal), 0)::numeric(12,2) AS subtotal_servicios
      FROM venta_servicios_detalle vsd
      INNER JOIN ventas v
        ON v.id_venta = vsd.id_venta
      LEFT JOIN servicios_clinicos_solicitudes scs
        ON scs.id_solicitud_servicio = vsd.id_solicitud_servicio
      LEFT JOIN sucursales suc
        ON suc.id_sucursal = v.id_sucursal
      LEFT JOIN cajas c
        ON c.id_caja = v.id_caja
      LEFT JOIN usuarios u
        ON u.id_usuario = v.id_usuario
      LEFT JOIN doctores_shaddai_perfiles doctor_venta
        ON doctor_venta.id_perfil = v.id_doctor
      LEFT JOIN doctores_shaddai_perfiles doctor_solicitud
        ON doctor_solicitud.id_usuario = scs.id_doctor
      ${where}
    `;

    const resumenResultado = await pool.query(resumenQuery, params);
    const resumen = resumenResultado.rows[0] || {};

    return res.json({
      ok: true,
      ventas_servicios: resultado.rows,
      resumen: {
        total_registros: Number(resumen.total_registros || 0),
        total_ventas: Number(resumen.total_ventas || 0),
        total_cantidad_servicios: Number(resumen.total_cantidad_servicios || 0),
        subtotal_servicios: Number(resumen.subtotal_servicios || 0),
      },
    });
  } catch (error) {
    console.error('Error al listar ventas de servicios clínicos:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar ventas de servicios clínicos',
      error: error.message,
    });
  }
};

/**
 * Cancela una solicitud clínica antes de que sea cobrada.
 *
 * Reglas:
 * - Solamente puede cancelarse cuando está en PENDIENTE_CAJERO.
 * - La solicitud debe pertenecer a la sucursal enviada por el POS.
 * - El usuario debe tener acceso a la caja indicada.
 * - No debe existir todavía en venta_servicios_detalle.
 * - No genera venta, devolución ni movimiento de caja.
 */
export const cancelarServicioClinicoPendiente = async (req, res) => {
  const client = await pool.connect();

  try {
    const idSolicitud = Number(req.params.idSolicitud);
    const idSucursal = Number(req.body?.id_sucursal);
    const idCaja = Number(req.body?.id_caja);
    const motivo = limpiarTexto(req.body?.motivo);
    const idUsuario = obtenerIdUsuarioAutenticado(req.usuario);

    if (!Number.isInteger(idSolicitud) || idSolicitud <= 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La solicitud del servicio clínico no es válida',
      });
    }

    if (!Number.isInteger(idSucursal) || idSucursal <= 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sucursal seleccionada no es válida',
      });
    }

    if (!Number.isInteger(idCaja) || idCaja <= 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La caja seleccionada no es válida',
      });
    }

    if (!motivo) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El motivo de cancelación es obligatorio',
      });
    }

    if (!idUsuario) {
      return res.status(401).json({
        ok: false,
        mensaje: 'No se pudo identificar al usuario de la sesión',
      });
    }

    await client.query('BEGIN');

    /*
     * El bloqueo evita que una cancelación y un cobro se procesen al mismo
     * tiempo sobre la misma solicitud.
     */
    const solicitudResultado = await client.query(
      `
      SELECT
        id_solicitud_servicio,
        id_sucursal,
        folio_servicio,
        nombre_paciente,
        estatus,
        activo,
        observaciones,
        fecha_pago,
        fecha_realizado
      FROM servicios_clinicos_solicitudes
      WHERE id_solicitud_servicio = $1
      FOR UPDATE
      `,
      [idSolicitud]
    );

    if (solicitudResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró la solicitud del servicio clínico',
      });
    }

    const solicitud = solicitudResultado.rows[0];

    if (!esValorActivo(solicitud.activo)) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'La solicitud del servicio clínico está inactiva',
      });
    }

    if (Number(solicitud.id_sucursal) !== idSucursal) {
      await client.query('ROLLBACK');

      return res.status(403).json({
        ok: false,
        mensaje:
          'La solicitud no pertenece a la sucursal actualmente seleccionada',
      });
    }

    /*
     * Se reutiliza la misma validación de acceso a caja que usa crearVenta.
     * SUPER_ADMIN puede operar cualquier caja activa; los demás usuarios
     * solamente la caja activa que tengan asignada.
     */
    const accesoCaja = await validarAccesoCajaAsignada({
      db: client,
      usuario: req.usuario,
      idCaja,
      idSucursal: solicitud.id_sucursal,
      bloquear: true,
    });

    if (!accesoCaja.ok) {
      await client.query('ROLLBACK');
      return responderAccesoCajaDenegado(res, accesoCaja);
    }

    const estatusActual = String(solicitud.estatus || '')
      .trim()
      .toUpperCase();

    if (estatusActual === 'CANCELADO' || estatusActual === 'CANCELADA') {
      await client.query('ROLLBACK');

      return res.status(409).json({
        ok: false,
        mensaje: 'La solicitud ya se encuentra cancelada',
      });
    }

    if (estatusActual !== 'PENDIENTE_CAJERO') {
      await client.query('ROLLBACK');

      return res.status(409).json({
        ok: false,
        mensaje:
          estatusActual === 'PAGADO'
            ? 'El servicio ya fue cobrado y no puede cancelarse desde pendientes'
            : `El servicio tiene estatus ${estatusActual || 'DESCONOCIDO'} y ya no puede cancelarse desde caja`,
      });
    }

    /*
     * Protección adicional: aunque el estatus siguiera desactualizado,
     * no se permite cancelar una solicitud que ya tenga vínculo con una venta.
     */
    const ventaServicioResultado = await client.query(
      `
      SELECT
        vsd.id_venta_servicio,
        vsd.id_venta,
        v.folio AS folio_venta,
        v.estado AS estado_venta
      FROM venta_servicios_detalle vsd
      INNER JOIN ventas v
        ON v.id_venta = vsd.id_venta
      WHERE vsd.id_solicitud_servicio = $1
      ORDER BY vsd.id_venta_servicio DESC
      LIMIT 1
      `,
      [idSolicitud]
    );

    if (ventaServicioResultado.rows.length > 0) {
      await client.query('ROLLBACK');

      const ventaRelacionada = ventaServicioResultado.rows[0];

      return res.status(409).json({
        ok: false,
        mensaje:
          'El servicio ya está vinculado a una venta y no puede cancelarse como pendiente',
        venta: {
          id_venta: ventaRelacionada.id_venta,
          folio: ventaRelacionada.folio_venta,
          estado: ventaRelacionada.estado_venta,
        },
      });
    }

    const solicitudActualizadaResultado = await client.query(
      `
      UPDATE servicios_clinicos_solicitudes
      SET
        estatus = 'CANCELADO',
        observaciones = CONCAT_WS(
          E'\n',
          NULLIF(BTRIM(COALESCE(observaciones, '')), ''),
          FORMAT(
            '[CANCELADO EN CAJA %s] Motivo: %s | Usuario: %s',
            TO_CHAR(
              CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City',
              'DD/MM/YYYY HH24:MI'
            ),
            $2::text,
            $3::text
          )
        ),
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_solicitud_servicio = $1
        AND estatus = 'PENDIENTE_CAJERO'
      RETURNING
        id_solicitud_servicio,
        id_sucursal,
        folio_servicio,
        nombre_paciente,
        estatus,
        observaciones,
        fecha_actualizacion
      `,
      [idSolicitud, motivo, idUsuario]
    );

    if (solicitudActualizadaResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        ok: false,
        mensaje:
          'La solicitud cambió de estatus mientras se procesaba la cancelación',
      });
    }

    /*
     * Mantiene sincronizado el documento clínico generado para la solicitud.
     * No se borra el documento; solamente se conserva como cancelado.
     */
    await client.query(
      `
      UPDATE documentos_clinicos
      SET
        estatus = 'CANCELADO',
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE tabla_origen = 'servicios_clinicos_solicitudes'
        AND id_origen = $1
        AND COALESCE(UPPER(estatus), '') NOT IN (
          'PAGADO',
          'REALIZADO',
          'CANCELADO',
          'CANCELADA'
        )
      `,
      [idSolicitud]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje:
        'El servicio clínico fue cancelado y retirado de los pendientes de caja',
      solicitud: solicitudActualizadaResultado.rows[0],
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // La transacción puede no haber iniciado.
    }

    console.error(
      'Error al cancelar servicio clínico pendiente:',
      {
        message: error.message,
        code: error.code,
        detail: error.detail,
        stack: error.stack,
      }
    );

    return res.status(500).json({
      ok: false,
      mensaje:
        error.message ||
        'Error interno al cancelar el servicio clínico pendiente',
    });
  } finally {
    client.release();
  }
};

