import { pool } from '../config/db.js';

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

const redondearDos = (valor) => {
  return Number(Number(valor || 0).toFixed(2));
};

const esValorActivo = (valor) => {
  return valor === true || valor === 'true' || valor === 1 || valor === '1';
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

export const crearVenta = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      id_sucursal,
      id_caja,
      id_sesion,
      metodo_pago,
      monto_recibido,
      descuento = 0,
      impuesto = 0,
      productos,
      id_tarjeta_puntos,
    } = req.body;

    if (!id_sucursal || !id_caja || !id_sesion) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Sucursal, caja y sesión son obligatorias',
      });
    }

    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La venta debe contener al menos un producto',
      });
    }

    const metodoPagoFinal = String(metodo_pago || 'EFECTIVO').toUpperCase();

    const metodosPermitidos = [
      'EFECTIVO',
      'TARJETA',
      'TRANSFERENCIA',
      'PUNTOS',
    ];

    if (!metodosPermitidos.includes(metodoPagoFinal)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Método de pago no válido',
      });
    }

    const esPagoConPuntos = metodoPagoFinal === 'PUNTOS';

    await client.query('BEGIN');

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

    let subtotalVenta = 0;
    let subtotalSinDescuentoVenta = 0;
    let descuentoOfertasVenta = 0;

    let puntosClienteGanados = 0;
    let puntosCajeroGanados = 0;

    const productosProcesados = [];

    for (const item of productos) {
      const { id_producto, cantidad } = item;

      if (!id_producto || !cantidad || Number(cantidad) <= 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'Cada producto debe tener id_producto y cantidad mayor a cero',
        });
      }

      const productoResultado = await client.query(
        `
        SELECT 
          id_producto,
          id_categoria,
          nombre,
          precio_venta,
          activo
        FROM productos
        WHERE id_producto = $1
        `,
        [id_producto]
      );

      if (productoResultado.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: `Producto no encontrado: ${id_producto}`,
        });
      }

      const producto = productoResultado.rows[0];

      if (!producto.activo) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `El producto ${producto.nombre} está desactivado`,
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

      const resultadoLotes = await descontarLotesFEFO({
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

      productosProcesados.push({
        id_producto,
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
      });
    }

    subtotalVenta = redondearDos(subtotalVenta);
    subtotalSinDescuentoVenta = redondearDos(subtotalSinDescuentoVenta);
    descuentoOfertasVenta = redondearDos(descuentoOfertasVenta);

    const descuentoVenta = redondearDos(descuento || 0);
    const impuestoVenta = redondearDos(impuesto || 0);
    const totalVenta = redondearDos(subtotalVenta - descuentoVenta + impuestoVenta);

    if (totalVenta < 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El total de la venta no puede ser negativo',
      });
    }

    const puntosUsados = esPagoConPuntos ? totalVenta : 0;
    const montoPagadoPuntos = esPagoConPuntos ? totalVenta : 0;
    const montoPagadoDinero = esPagoConPuntos ? 0 : totalVenta;

    if (
      esPagoConPuntos &&
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
      tarjetaPuntos && !esPagoConPuntos
        ? calcularPuntosPorcentaje({
            total: totalVenta,
            porcentaje: configuracionPuntos.porcentaje_cliente,
            activo: configuracionPuntos.puntos_cliente_activo,
          })
        : 0;

    puntosCajeroGanados = calcularPuntosPorcentaje({
      total: totalVenta,
      porcentaje: configuracionPuntos.porcentaje_cajero,
      activo: configuracionPuntos.puntos_cajero_activo,
    });

    const montoRecibidoFinal = esPagoConPuntos
      ? 0
      : redondearDos(monto_recibido || 0);

    if (metodoPagoFinal === 'EFECTIVO' && montoRecibidoFinal < totalVenta) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El monto recibido no cubre el total de la venta',
        total: totalVenta,
        monto_recibido: montoRecibidoFinal,
      });
    }

    const cambio =
      metodoPagoFinal === 'EFECTIVO'
        ? redondearDos(montoRecibidoFinal - totalVenta)
        : 0;

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
        puntos_usados
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'COMPLETADA',$15,$16,$17,$18,$19)
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
      ]
    );

    const venta = ventaResultado.rows[0];

    for (const item of productosProcesados) {
      await client.query(
        `
        INSERT INTO venta_detalle (
          id_venta,
          id_producto,
          cantidad,
          precio_unitario,
          precio_original,
          porcentaje_descuento,
          descuento_unitario,
          id_oferta,
          descuento,
          subtotal
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          venta.id_venta,
          item.id_producto,
          item.cantidad,
          item.precio_unitario,
          item.precio_original,
          item.porcentaje_descuento,
          item.descuento_unitario,
          item.id_oferta,
          item.descuento,
          item.subtotal,
        ]
      );

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

    let tarjetaActualizada = null;

    if (esPagoConPuntos) {
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

    if (!esPagoConPuntos && tarjetaPuntos && puntosClienteGanados > 0) {
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

    const montoMovimientoCaja = esPagoConPuntos ? 0 : totalVenta;

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
        montoMovimientoCaja,
        metodoPagoFinal,
        folio,
        tarjetaPuntos
          ? esPagoConPuntos
            ? `Venta pagada con puntos | Tarjeta ${tarjetaPuntos.codigo_barras} | Puntos usados: ${puntosUsados} | Descuento ofertas: ${descuentoOfertasVenta} | Puntos cajero: ${puntosCajeroGanados}`
            : `Venta registrada desde POS | Tarjeta ${tarjetaPuntos.codigo_barras} | Puntos cliente: ${puntosClienteGanados} | Descuento ofertas: ${descuentoOfertasVenta} | Puntos cajero: ${puntosCajeroGanados}`
          : `Venta registrada desde POS | Descuento ofertas: ${descuentoOfertasVenta} | Puntos cajero: ${puntosCajeroGanados}`,
        req.usuario.id_usuario,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Venta registrada correctamente',
      venta: {
        ...venta,
        productos: productosProcesados,
        tarjeta_puntos: tarjetaActualizada,
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
        puntos_ganados: puntosClienteGanados,
        puntos_ganados_cliente: puntosClienteGanados,
        puntos_ganados_cajero: puntosCajeroGanados,
        tarjeta_puntos: tarjetaActualizada,
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

export const listarVentas = async (req, res) => {
  try {
    const { sucursal, sesion, fecha_inicio, fecha_fin } = req.query;

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
        v.fecha_venta,
        COALESCE(cpm.puntos, 0)::numeric(12,2) AS puntos_cajero
      FROM ventas v
      INNER JOIN sucursales s ON s.id_sucursal = v.id_sucursal
      INNER JOIN cajas c ON c.id_caja = v.id_caja
      INNER JOIN usuarios u ON u.id_usuario = v.id_usuario
      LEFT JOIN tarjetas_puntos tp ON tp.id_tarjeta = v.id_tarjeta_puntos
      LEFT JOIN cajeros_puntos_movimientos cpm 
        ON cpm.id_venta = v.id_venta 
       AND cpm.id_usuario = v.id_usuario
       AND cpm.tipo_movimiento = 'VENTA'
      WHERE 1 = 1
    `;

    const params = [];

    if (sucursal) {
      params.push(sucursal);
      query += ` AND v.id_sucursal = $${params.length} `;
    }

    if (sesion) {
      params.push(sesion);
      query += ` AND v.id_sesion = $${params.length} `;
    }

    if (fecha_inicio) {
      params.push(fecha_inicio);
      query += ` AND v.fecha_venta >= $${params.length} `;
    }

    if (fecha_fin) {
      params.push(fecha_fin);
      query += ` AND v.fecha_venta <= $${params.length} `;
    }

    query += ` ORDER BY v.fecha_venta DESC `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      ventas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar ventas:', error);

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
        v.fecha_venta,
        COALESCE(cpm.puntos, 0)::numeric(12,2) AS puntos_cajero,
        cpm.porcentaje_aplicado AS porcentaje_cajero_aplicado
      FROM ventas v
      INNER JOIN sucursales s ON s.id_sucursal = v.id_sucursal
      INNER JOIN cajas c ON c.id_caja = v.id_caja
      INNER JOIN usuarios u ON u.id_usuario = v.id_usuario
      LEFT JOIN tarjetas_puntos tp ON tp.id_tarjeta = v.id_tarjeta_puntos
      LEFT JOIN cajeros_puntos_movimientos cpm 
        ON cpm.id_venta = v.id_venta 
       AND cpm.id_usuario = v.id_usuario
       AND cpm.tipo_movimiento = 'VENTA'
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

    const detalleResultado = await pool.query(
      `
      SELECT
        vd.id_detalle,
        vd.id_producto,
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
      LEFT JOIN ofertas_categorias oc ON oc.id_oferta = vd.id_oferta
      WHERE vd.id_venta = $1
      ORDER BY vd.id_detalle ASC
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

    return res.json({
      ok: true,
      venta: ventaResultado.rows[0],
      detalle: detalleResultado.rows,
      lotes: lotesResultado.rows,
    });
  } catch (error) {
    console.error('Error al obtener venta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener venta',
    });
  }
};