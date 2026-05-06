import { pool } from '../config/db.js';

export const obtenerResumenDashboard = async (req, res) => {
  try {
    const { sucursal, fecha_inicio, fecha_fin } = req.query;

    if (!sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro sucursal es obligatorio',
      });
    }

    const fechaActual = new Date();

    const fechaInicioDefault = new Date(
      fechaActual.getFullYear(),
      fechaActual.getMonth(),
      1
    );

    const fechaFinDefault = new Date();
    fechaFinDefault.setHours(23, 59, 59, 999);

    const fechaInicio = fecha_inicio
      ? new Date(`${fecha_inicio}T00:00:00`)
      : fechaInicioDefault;

    const fechaFin = fecha_fin
      ? new Date(`${fecha_fin}T23:59:59`)
      : fechaFinDefault;

    if (Number.isNaN(fechaInicio.getTime()) || Number.isNaN(fechaFin.getTime())) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Las fechas enviadas no son válidas',
      });
    }

    if (fechaInicio > fechaFin) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La fecha de inicio no puede ser mayor que la fecha final',
      });
    }

    const hoyInicio = new Date();
    hoyInicio.setHours(0, 0, 0, 0);

    const hoyFin = new Date();
    hoyFin.setHours(23, 59, 59, 999);

    const ventasHoy = await pool.query(
      `
      SELECT
        COUNT(*)::INT AS total_ventas,
        COALESCE(SUM(total), 0)::NUMERIC AS total_vendido
      FROM ventas
      WHERE id_sucursal = $1
        AND estado = 'COMPLETADA'
        AND fecha_venta BETWEEN $2 AND $3
      `,
      [sucursal, hoyInicio, hoyFin]
    );

    const resumenPeriodo = await pool.query(
      `
      SELECT
        COUNT(*)::INT AS total_ventas,
        COALESCE(SUM(total), 0)::NUMERIC AS total_vendido,
        COALESCE(AVG(total), 0)::NUMERIC AS ticket_promedio
      FROM ventas
      WHERE id_sucursal = $1
        AND estado = 'COMPLETADA'
        AND fecha_venta BETWEEN $2 AND $3
      `,
      [sucursal, fechaInicio, fechaFin]
    );

    const gananciaPeriodo = await pool.query(
      `
      SELECT
        COALESCE(
          SUM(
            (COALESCE(vd.precio_unitario, 0) - COALESCE(p.precio_compra, 0))
            * COALESCE(vd.cantidad, 0)
          ),
          0
        )::NUMERIC AS ganancia_total
      FROM ventas v
      INNER JOIN venta_detalle vd ON vd.id_venta = v.id_venta
      INNER JOIN productos p ON p.id_producto = vd.id_producto
      WHERE v.id_sucursal = $1
        AND v.estado = 'COMPLETADA'
        AND v.fecha_venta BETWEEN $2 AND $3
      `,
      [sucursal, fechaInicio, fechaFin]
    );

    const productos = await pool.query(
      `
      SELECT COUNT(*)::INT AS total_productos
      FROM productos
      WHERE activo = true
      `
    );

    const bajoStock = await pool.query(
      `
      SELECT COUNT(*)::INT AS total_bajo_stock
      FROM inventario_sucursal
      WHERE id_sucursal = $1
        AND stock_actual <= stock_minimo
      `,
      [sucursal]
    );

    const caducidad = await pool.query(
      `
      SELECT COUNT(*)::INT AS total_caducidad
      FROM inventario_lotes
      WHERE id_sucursal = $1
        AND stock_actual > 0
        AND fecha_caducidad IS NOT NULL
        AND fecha_caducidad <= CURRENT_DATE + INTERVAL '90 days'
      `,
      [sucursal]
    );

    const cajaAbierta = await pool.query(
      `
      SELECT
        cs.id_sesion,
        cs.id_caja,
        c.nombre AS caja,
        cs.monto_inicial,
        cs.fecha_apertura
      FROM caja_sesiones cs
      INNER JOIN cajas c ON c.id_caja = cs.id_caja
      WHERE cs.id_sucursal = $1
        AND cs.estado = 'ABIERTA'
      ORDER BY cs.fecha_apertura DESC
      LIMIT 1
      `,
      [sucursal]
    );

    let montoCaja = 0;

    if (cajaAbierta.rows.length > 0) {
      const idSesion = cajaAbierta.rows[0].id_sesion;

      const resumenCaja = await pool.query(
        `
        SELECT
          COALESCE(
            SUM(
              CASE 
                WHEN tipo_movimiento IN ('APERTURA', 'ENTRADA', 'VENTA') 
                  THEN monto
                WHEN tipo_movimiento IN ('SALIDA', 'GASTO', 'RETIRO', 'PAGO_PROVEEDOR', 'DEVOLUCION')
                  THEN -monto
                ELSE 0
              END
            ),
            0
          )::NUMERIC AS monto_esperado
        FROM caja_movimientos
        WHERE id_sesion = $1
        `,
        [idSesion]
      );

      montoCaja = Number(resumenCaja.rows[0]?.monto_esperado || 0);
    }

    const ultimasVentas = await pool.query(
      `
      SELECT
        v.id_venta,
        v.folio,
        v.total,
        v.metodo_pago,
        v.fecha_venta,
        u.nombre AS usuario
      FROM ventas v
      INNER JOIN usuarios u ON u.id_usuario = v.id_usuario
      WHERE v.id_sucursal = $1
      ORDER BY v.fecha_venta DESC
      LIMIT 5
      `,
      [sucursal]
    );

    const productosBajoStock = await pool.query(
      `
      SELECT
        i.id_inventario,
        p.nombre AS producto,
        i.stock_actual,
        i.stock_minimo
      FROM inventario_sucursal i
      INNER JOIN productos p ON p.id_producto = i.id_producto
      WHERE i.id_sucursal = $1
        AND i.stock_actual <= i.stock_minimo
      ORDER BY i.stock_actual ASC
      LIMIT 20
      `,
      [sucursal]
    );

    const productosCaducidadDetalle = await pool.query(
      `
      SELECT
        l.id_lote,
        p.nombre AS producto,
        l.lote,
        l.stock_actual,
        l.fecha_caducidad,
        (l.fecha_caducidad - CURRENT_DATE)::INT AS dias_restantes
      FROM inventario_lotes l
      INNER JOIN productos p ON p.id_producto = l.id_producto
      WHERE l.id_sucursal = $1
        AND l.stock_actual > 0
        AND l.fecha_caducidad IS NOT NULL
        AND l.fecha_caducidad <= CURRENT_DATE + INTERVAL '90 days'
      ORDER BY l.fecha_caducidad ASC
      LIMIT 20
      `,
      [sucursal]
    );

    const ventasPorDia = await pool.query(
      `
      SELECT
        TO_CHAR(DATE(v.fecha_venta), 'YYYY-MM-DD') AS fecha,
        COALESCE(SUM(v.total), 0)::NUMERIC AS total,
        COALESCE(
          SUM(
            (COALESCE(vd.precio_unitario, 0) - COALESCE(p.precio_compra, 0))
            * COALESCE(vd.cantidad, 0)
          ),
          0
        )::NUMERIC AS ganancia,
        COUNT(DISTINCT v.id_venta)::INT AS ventas
      FROM ventas v
      INNER JOIN venta_detalle vd ON vd.id_venta = v.id_venta
      INNER JOIN productos p ON p.id_producto = vd.id_producto
      WHERE v.id_sucursal = $1
        AND v.estado = 'COMPLETADA'
        AND v.fecha_venta BETWEEN $2 AND $3
      GROUP BY DATE(v.fecha_venta)
      ORDER BY DATE(v.fecha_venta) ASC
      `,
      [sucursal, fechaInicio, fechaFin]
    );

    const ventasPorMetodoPago = await pool.query(
      `
      SELECT
        COALESCE(v.metodo_pago, 'NO ESPECIFICADO') AS metodo,
        COUNT(*)::INT AS ventas,
        COALESCE(SUM(v.total), 0)::NUMERIC AS total
      FROM ventas v
      WHERE v.id_sucursal = $1
        AND v.estado = 'COMPLETADA'
        AND v.fecha_venta BETWEEN $2 AND $3
      GROUP BY COALESCE(v.metodo_pago, 'NO ESPECIFICADO')
      ORDER BY total DESC
      `,
      [sucursal, fechaInicio, fechaFin]
    );

    const productosMasVendidos = await pool.query(
      `
      SELECT
        p.id_producto,
        p.nombre AS producto,
        SUM(COALESCE(vd.cantidad, 0))::NUMERIC AS cantidad,
        COALESCE(SUM(vd.subtotal), 0)::NUMERIC AS total,
        COALESCE(
          SUM(
            (COALESCE(vd.precio_unitario, 0) - COALESCE(p.precio_compra, 0))
            * COALESCE(vd.cantidad, 0)
          ),
          0
        )::NUMERIC AS ganancia
      FROM venta_detalle vd
      INNER JOIN ventas v ON v.id_venta = vd.id_venta
      INNER JOIN productos p ON p.id_producto = vd.id_producto
      WHERE v.id_sucursal = $1
        AND v.estado = 'COMPLETADA'
        AND v.fecha_venta BETWEEN $2 AND $3
      GROUP BY p.id_producto, p.nombre
      ORDER BY cantidad DESC
      LIMIT 10
      `,
      [sucursal, fechaInicio, fechaFin]
    );

    const categoriasMasVendidas = await pool.query(
      `
      SELECT
        COALESCE(c.nombre, 'Sin categoría') AS categoria,
        SUM(COALESCE(vd.cantidad, 0))::NUMERIC AS cantidad,
        COALESCE(SUM(vd.subtotal), 0)::NUMERIC AS total,
        COALESCE(
          SUM(
            (COALESCE(vd.precio_unitario, 0) - COALESCE(p.precio_compra, 0))
            * COALESCE(vd.cantidad, 0)
          ),
          0
        )::NUMERIC AS ganancia
      FROM venta_detalle vd
      INNER JOIN ventas v ON v.id_venta = vd.id_venta
      INNER JOIN productos p ON p.id_producto = vd.id_producto
      LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
      WHERE v.id_sucursal = $1
        AND v.estado = 'COMPLETADA'
        AND v.fecha_venta BETWEEN $2 AND $3
      GROUP BY COALESCE(c.nombre, 'Sin categoría')
      ORDER BY total DESC
      LIMIT 8
      `,
      [sucursal, fechaInicio, fechaFin]
    );

    const totalVentasPeriodo = Number(
      resumenPeriodo.rows[0]?.total_ventas || 0
    );

    const totalVendidoPeriodo = Number(
      resumenPeriodo.rows[0]?.total_vendido || 0
    );

    const ticketPromedio = Number(
      resumenPeriodo.rows[0]?.ticket_promedio || 0
    );

    const gananciaTotal = Number(
      gananciaPeriodo.rows[0]?.ganancia_total || 0
    );

    return res.json({
      ok: true,

      filtros: {
        sucursal: Number(sucursal),
        fecha_inicio: fecha_inicio || fechaInicio.toLocaleDateString('en-CA'),
        fecha_fin: fecha_fin || fechaFin.toLocaleDateString('en-CA'),
      },

      resumen: {
        ventas_hoy: Number(ventasHoy.rows[0]?.total_ventas || 0),
        total_vendido_hoy: Number(ventasHoy.rows[0]?.total_vendido || 0),

        total_ventas: totalVentasPeriodo,
        total_vendido: totalVendidoPeriodo,
        ganancia_total: gananciaTotal,
        ticket_promedio: ticketPromedio,

        total_productos: Number(productos.rows[0]?.total_productos || 0),
        productos_bajo_stock: Number(bajoStock.rows[0]?.total_bajo_stock || 0),
        productos_caducidad: Number(caducidad.rows[0]?.total_caducidad || 0),

        caja_abierta: cajaAbierta.rows.length > 0,
        caja_actual: cajaAbierta.rows[0] || null,
        monto_esperado_caja: montoCaja,
      },

      ventas_por_dia: ventasPorDia.rows.map((item) => ({
        fecha: item.fecha,
        total: Number(item.total || 0),
        ganancia: Number(item.ganancia || 0),
        ventas: Number(item.ventas || 0),
      })),

      ventas_por_metodo_pago: ventasPorMetodoPago.rows.map((item) => ({
        metodo: item.metodo,
        ventas: Number(item.ventas || 0),
        total: Number(item.total || 0),
      })),

      productos_mas_vendidos: productosMasVendidos.rows.map((item) => ({
        id_producto: item.id_producto,
        producto: item.producto,
        cantidad: Number(item.cantidad || 0),
        total: Number(item.total || 0),
        ganancia: Number(item.ganancia || 0),
      })),

      categorias_mas_vendidas: categoriasMasVendidas.rows.map((item) => ({
        categoria: item.categoria,
        cantidad: Number(item.cantidad || 0),
        total: Number(item.total || 0),
        ganancia: Number(item.ganancia || 0),
      })),

      ultimas_ventas: ultimasVentas.rows,

      productos_bajo_stock: productosBajoStock.rows.map((item) => ({
        id_inventario: item.id_inventario,
        producto: item.producto,
        stock_actual: Number(item.stock_actual || 0),
        stock_minimo: Number(item.stock_minimo || 0),
      })),

      productos_caducidad_detalle: productosCaducidadDetalle.rows.map((item) => ({
        id_lote: item.id_lote,
        producto: item.producto,
        lote: item.lote,
        stock_actual: Number(item.stock_actual || 0),
        fecha_caducidad: item.fecha_caducidad,
        dias_restantes: Number(item.dias_restantes || 0),
      })),
    });
  } catch (error) {
    console.error('Error al obtener dashboard:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener dashboard',
      detalle: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};