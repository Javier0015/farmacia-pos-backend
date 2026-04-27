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

    const metodoPagoFinal = metodo_pago || 'EFECTIVO';

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

    let subtotalVenta = 0;
    let puntosGanados = 0;
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
          nombre,
          precio_venta,
          puntos_por_unidad,
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

      const precioUnitario = Number(item.precio_unitario ?? producto.precio_venta);
      const descuentoProducto = Number(item.descuento || 0);
      const subtotalProducto = cantidadVenta * precioUnitario - descuentoProducto;

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

      const puntosPorUnidad = Number(producto.puntos_por_unidad || 0);
      const puntosProducto = tarjetaPuntos ? cantidadVenta * puntosPorUnidad : 0;

      subtotalVenta += subtotalProducto;
      puntosGanados += puntosProducto;

      productosProcesados.push({
        id_producto,
        nombre: producto.nombre,
        cantidad: cantidadVenta,
        precio_unitario: precioUnitario,
        descuento: descuentoProducto,
        subtotal: subtotalProducto,
        puntos_por_unidad: puntosPorUnidad,
        puntos_ganados: puntosProducto,
        stock_anterior: stockActual,
        stock_nuevo: stockNuevo,
        lotes_descontados: resultadoLotes.lotes_descontados,
      });
    }

    const descuentoVenta = Number(descuento || 0);
    const impuestoVenta = Number(impuesto || 0);
    const totalVenta = subtotalVenta - descuentoVenta + impuestoVenta;

    if (totalVenta < 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El total de la venta no puede ser negativo',
      });
    }

    const montoRecibidoFinal = Number(monto_recibido || 0);

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
        ? montoRecibidoFinal - totalVenta
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
        descuento,
        impuesto,
        total,
        metodo_pago,
        monto_recibido,
        cambio,
        estado,
        id_tarjeta_puntos,
        puntos_ganados
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'COMPLETADA',$13,$14)
      RETURNING *
      `,
      [
        folio,
        id_sucursal,
        id_caja,
        id_sesion,
        req.usuario.id_usuario,
        subtotalVenta,
        descuentoVenta,
        impuestoVenta,
        totalVenta,
        metodoPagoFinal,
        montoRecibidoFinal,
        cambio,
        tarjetaPuntos?.id_tarjeta || null,
        puntosGanados,
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
          descuento,
          subtotal
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          venta.id_venta,
          item.id_producto,
          item.cantidad,
          item.precio_unitario,
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

    if (tarjetaPuntos && puntosGanados > 0) {
      const puntosAnteriores = Number(tarjetaPuntos.puntos_actuales || 0);
      const puntosNuevos = puntosAnteriores + puntosGanados;

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
        [puntosGanados, tarjetaPuntos.id_tarjeta]
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
          puntosGanados,
          puntosAnteriores,
          puntosNuevos,
          `Puntos acumulados por venta ${folio}`,
        ]
      );
    }

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
        totalVenta,
        metodoPagoFinal,
        folio,
        tarjetaPuntos
          ? `Venta registrada desde POS | Tarjeta ${tarjetaPuntos.codigo_barras} | Puntos ganados: ${puntosGanados}`
          : 'Venta registrada desde POS',
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
        descuento: descuentoVenta,
        impuesto: impuestoVenta,
        total: totalVenta,
        monto_recibido: montoRecibidoFinal,
        cambio,
        puntos_ganados: puntosGanados,
        tarjeta_puntos: tarjetaActualizada,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al crear venta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al registrar venta',
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
        v.descuento,
        v.impuesto,
        v.total,
        v.metodo_pago,
        v.monto_recibido,
        v.cambio,
        v.estado,
        v.id_tarjeta_puntos,
        tp.codigo_barras AS tarjeta_codigo_barras,
        tp.nombre_cliente AS tarjeta_cliente,
        v.puntos_ganados,
        v.fecha_venta
      FROM ventas v
      INNER JOIN sucursales s ON s.id_sucursal = v.id_sucursal
      INNER JOIN cajas c ON c.id_caja = v.id_caja
      INNER JOIN usuarios u ON u.id_usuario = v.id_usuario
      LEFT JOIN tarjetas_puntos tp ON tp.id_tarjeta = v.id_tarjeta_puntos
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
        v.descuento,
        v.impuesto,
        v.total,
        v.metodo_pago,
        v.monto_recibido,
        v.cambio,
        v.estado,
        v.id_tarjeta_puntos,
        tp.codigo_barras AS tarjeta_codigo_barras,
        tp.nombre_cliente AS tarjeta_cliente,
        v.puntos_ganados,
        v.fecha_venta
      FROM ventas v
      INNER JOIN sucursales s ON s.id_sucursal = v.id_sucursal
      INNER JOIN cajas c ON c.id_caja = v.id_caja
      INNER JOIN usuarios u ON u.id_usuario = v.id_usuario
      LEFT JOIN tarjetas_puntos tp ON tp.id_tarjeta = v.id_tarjeta_puntos
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
        p.puntos_por_unidad,
        vd.cantidad,
        vd.precio_unitario,
        vd.descuento,
        vd.subtotal,
        (vd.cantidad * COALESCE(p.puntos_por_unidad, 0)) AS puntos_ganados
      FROM venta_detalle vd
      INNER JOIN productos p ON p.id_producto = vd.id_producto
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