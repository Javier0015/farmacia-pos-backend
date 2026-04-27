import { pool } from '../config/db.js';

export const obtenerResumenDashboard = async (req, res) => {
  try {
    const { sucursal } = req.query;

    if (!sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro sucursal es obligatorio',
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
        COALESCE(SUM(total), 0) AS total_vendido
      FROM ventas
      WHERE id_sucursal = $1
      AND estado = 'COMPLETADA'
      AND fecha_venta BETWEEN $2 AND $3
      `,
      [sucursal, hoyInicio, hoyFin]
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
          COALESCE(SUM(
            CASE 
              WHEN tipo_movimiento IN ('APERTURA', 'ENTRADA', 'VENTA') 
              THEN monto
              WHEN tipo_movimiento IN ('SALIDA', 'GASTO', 'RETIRO', 'PAGO_PROVEEDOR', 'DEVOLUCION')
              THEN -monto
              ELSE 0
            END
          ), 0) AS monto_esperado
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
      LIMIT 5
      `,
      [sucursal]
    );

    return res.json({
      ok: true,
      resumen: {
        ventas_hoy: ventasHoy.rows[0].total_ventas,
        total_vendido_hoy: Number(ventasHoy.rows[0].total_vendido || 0),
        total_productos: productos.rows[0].total_productos,
        productos_bajo_stock: bajoStock.rows[0].total_bajo_stock,
        productos_caducidad: caducidad.rows[0].total_caducidad,
        caja_abierta: cajaAbierta.rows.length > 0,
        caja_actual: cajaAbierta.rows[0] || null,
        monto_esperado_caja: montoCaja,
      },
      ultimas_ventas: ultimasVentas.rows,
      productos_bajo_stock: productosBajoStock.rows,
    });
  } catch (error) {
    console.error('Error al obtener dashboard:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener dashboard',
    });
  }
};