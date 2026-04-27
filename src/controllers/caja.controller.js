import { pool } from '../config/db.js';

export const listarCajas = async (req, res) => {
  try {
    const { sucursal } = req.query;

    if (!sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro sucursal es obligatorio',
      });
    }

    const resultado = await pool.query(
      `
      SELECT 
        id_caja,
        id_sucursal,
        nombre,
        activo,
        fecha_creacion
      FROM cajas
      WHERE id_sucursal = $1
      ORDER BY id_caja ASC
      `,
      [sucursal]
    );

    return res.json({
      ok: true,
      cajas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar cajas:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar cajas',
    });
  }
};

export const obtenerSesionAbierta = async (req, res) => {
  try {
    const { id_caja } = req.query;

    if (!id_caja) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro id_caja es obligatorio',
      });
    }

    const resultado = await pool.query(
      `
      SELECT 
        cs.id_sesion,
        cs.id_caja,
        c.nombre AS caja,
        cs.id_sucursal,
        s.nombre AS sucursal,
        cs.id_usuario_apertura,
        u.nombre AS usuario_apertura,
        cs.monto_inicial,
        cs.monto_final_sistema,
        cs.monto_final_real,
        cs.diferencia,
        cs.estado,
        cs.fecha_apertura,
        cs.fecha_cierre
      FROM caja_sesiones cs
      INNER JOIN cajas c ON c.id_caja = cs.id_caja
      INNER JOIN sucursales s ON s.id_sucursal = cs.id_sucursal
      INNER JOIN usuarios u ON u.id_usuario = cs.id_usuario_apertura
      WHERE cs.id_caja = $1
      AND cs.estado = 'ABIERTA'
      ORDER BY cs.fecha_apertura DESC
      LIMIT 1
      `,
      [id_caja]
    );

    if (resultado.rows.length === 0) {
      return res.json({
        ok: true,
        sesion_abierta: null,
      });
    }

    return res.json({
      ok: true,
      sesion_abierta: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener sesión abierta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener sesión abierta',
    });
  }
};

export const abrirCaja = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_caja, id_sucursal, monto_inicial } = req.body;

    if (!id_caja || !id_sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Caja y sucursal son obligatorias',
      });
    }

    if (Number(monto_inicial) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El monto inicial no puede ser negativo',
      });
    }

    await client.query('BEGIN');

    const cajaExiste = await client.query(
      `
      SELECT id_caja
      FROM cajas
      WHERE id_caja = $1
      AND id_sucursal = $2
      AND activo = true
      `,
      [id_caja, id_sucursal]
    );

    if (cajaExiste.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'La caja no existe o no pertenece a la sucursal indicada',
      });
    }

    const sesionAbierta = await client.query(
      `
      SELECT id_sesion
      FROM caja_sesiones
      WHERE id_caja = $1
      AND estado = 'ABIERTA'
      LIMIT 1
      `,
      [id_caja]
    );

    if (sesionAbierta.rows.length > 0) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        ok: false,
        mensaje: 'Esta caja ya tiene una sesión abierta',
        id_sesion: sesionAbierta.rows[0].id_sesion,
      });
    }

    const sesion = await client.query(
      `
      INSERT INTO caja_sesiones (
        id_caja,
        id_sucursal,
        id_usuario_apertura,
        monto_inicial,
        estado
      )
      VALUES ($1, $2, $3, $4, 'ABIERTA')
      RETURNING *
      `,
      [
        id_caja,
        id_sucursal,
        req.usuario.id_usuario,
        monto_inicial || 0,
      ]
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        sesion.rows[0].id_sesion,
        id_sucursal,
        'APERTURA',
        'Apertura de caja',
        monto_inicial || 0,
        'EFECTIVO',
        'APERTURA_CAJA',
        'Monto inicial de caja',
        req.usuario.id_usuario,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Caja abierta correctamente',
      sesion: sesion.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al abrir caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al abrir caja',
    });
  } finally {
    client.release();
  }
};

export const registrarMovimientoCaja = async (req, res) => {
  try {
    const {
      id_sesion,
      id_sucursal,
      tipo_movimiento,
      concepto,
      monto,
      metodo_pago,
      referencia,
      observaciones,
    } = req.body;

    if (!id_sesion || !id_sucursal || !tipo_movimiento || !concepto || monto === undefined) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Sesión, sucursal, tipo, concepto y monto son obligatorios',
      });
    }

    if (Number(monto) <= 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El monto debe ser mayor a cero',
      });
    }

    const tiposPermitidos = [
      'ENTRADA',
      'SALIDA',
      'GASTO',
      'RETIRO',
      'PAGO_PROVEEDOR',
      'DEVOLUCION',
      'AJUSTE',
    ];

    if (!tiposPermitidos.includes(tipo_movimiento)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Tipo de movimiento no válido',
        tipos_permitidos: tiposPermitidos,
      });
    }

    const sesion = await pool.query(
      `
      SELECT id_sesion
      FROM caja_sesiones
      WHERE id_sesion = $1
      AND id_sucursal = $2
      AND estado = 'ABIERTA'
      `,
      [id_sesion, id_sucursal]
    );

    if (sesion.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'No existe una sesión de caja abierta con esos datos',
      });
    }

    const resultado = await pool.query(
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        id_sesion,
        id_sucursal,
        tipo_movimiento,
        concepto.trim(),
        monto,
        metodo_pago || 'EFECTIVO',
        referencia || null,
        observaciones || null,
        req.usuario.id_usuario,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Movimiento de caja registrado correctamente',
      movimiento: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al registrar movimiento de caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al registrar movimiento de caja',
    });
  }
};

export const listarMovimientosCaja = async (req, res) => {
  try {
    const { id_sesion } = req.query;

    if (!id_sesion) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro id_sesion es obligatorio',
      });
    }

    const resultado = await pool.query(
      `
      SELECT
        cm.id_movimiento,
        cm.id_sesion,
        cm.id_sucursal,
        s.nombre AS sucursal,
        cm.tipo_movimiento,
        cm.concepto,
        cm.monto,
        cm.metodo_pago,
        cm.referencia,
        cm.observaciones,
        cm.id_usuario,
        u.nombre AS usuario,
        cm.fecha_movimiento
      FROM caja_movimientos cm
      INNER JOIN sucursales s ON s.id_sucursal = cm.id_sucursal
      INNER JOIN usuarios u ON u.id_usuario = cm.id_usuario
      WHERE cm.id_sesion = $1
      ORDER BY cm.fecha_movimiento DESC
      `,
      [id_sesion]
    );

    return res.json({
      ok: true,
      movimientos: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar movimientos de caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar movimientos de caja',
    });
  }
};

export const obtenerResumenCaja = async (req, res) => {
  try {
    const { id_sesion } = req.query;

    if (!id_sesion) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro id_sesion es obligatorio',
      });
    }

    const sesionResultado = await pool.query(
      `
      SELECT 
        cs.id_sesion,
        cs.id_caja,
        c.nombre AS caja,
        cs.id_sucursal,
        s.nombre AS sucursal,
        cs.id_usuario_apertura,
        u.nombre AS usuario_apertura,
        cs.monto_inicial,
        cs.estado,
        cs.fecha_apertura,
        cs.fecha_cierre
      FROM caja_sesiones cs
      INNER JOIN cajas c ON c.id_caja = cs.id_caja
      INNER JOIN sucursales s ON s.id_sucursal = cs.id_sucursal
      INNER JOIN usuarios u ON u.id_usuario = cs.id_usuario_apertura
      WHERE cs.id_sesion = $1
      `,
      [id_sesion]
    );

    if (sesionResultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Sesión de caja no encontrada',
      });
    }

    const movimientosResultado = await pool.query(
      `
      SELECT
        tipo_movimiento,
        metodo_pago,
        COALESCE(SUM(monto), 0) AS total
      FROM caja_movimientos
      WHERE id_sesion = $1
      GROUP BY tipo_movimiento, metodo_pago
      ORDER BY tipo_movimiento ASC
      `,
      [id_sesion]
    );

    const sesion = sesionResultado.rows[0];
    const movimientos = movimientosResultado.rows;

    const montoInicial = Number(sesion.monto_inicial);

    const sumar = (tipo, metodo = null) => {
      return movimientos
        .filter((m) => {
          if (metodo) {
            return m.tipo_movimiento === tipo && m.metodo_pago === metodo;
          }

          return m.tipo_movimiento === tipo;
        })
        .reduce((acc, m) => acc + Number(m.total), 0);
    };

    const ventasEfectivo = sumar('VENTA', 'EFECTIVO');
    const entradasEfectivo = sumar('ENTRADA', 'EFECTIVO');
    const salidasEfectivo = sumar('SALIDA', 'EFECTIVO');
    const gastosEfectivo = sumar('GASTO', 'EFECTIVO');
    const retirosEfectivo = sumar('RETIRO', 'EFECTIVO');
    const pagosProveedorEfectivo = sumar('PAGO_PROVEEDOR', 'EFECTIVO');
    const devolucionesEfectivo = sumar('DEVOLUCION', 'EFECTIVO');

    const montoFinalSistema =
      montoInicial +
      ventasEfectivo +
      entradasEfectivo -
      salidasEfectivo -
      gastosEfectivo -
      retirosEfectivo -
      pagosProveedorEfectivo -
      devolucionesEfectivo;

    return res.json({
      ok: true,
      sesion,
      resumen: {
        monto_inicial: montoInicial,
        ventas_efectivo: ventasEfectivo,
        entradas_efectivo: entradasEfectivo,
        salidas_efectivo: salidasEfectivo,
        gastos_efectivo: gastosEfectivo,
        retiros_efectivo: retirosEfectivo,
        pagos_proveedor_efectivo: pagosProveedorEfectivo,
        devoluciones_efectivo: devolucionesEfectivo,
        monto_final_sistema: montoFinalSistema,
      },
      desglose: movimientos,
    });
  } catch (error) {
    console.error('Error al obtener resumen de caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener resumen de caja',
    });
  }
};

export const cerrarCaja = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_sesion, monto_final_real, observaciones } = req.body;

    if (!id_sesion || monto_final_real === undefined) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sesión y el monto final real son obligatorios',
      });
    }

    if (Number(monto_final_real) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El monto final real no puede ser negativo',
      });
    }

    await client.query('BEGIN');

    const sesionResultado = await client.query(
      `
      SELECT 
        id_sesion,
        id_sucursal,
        monto_inicial,
        estado
      FROM caja_sesiones
      WHERE id_sesion = $1
      FOR UPDATE
      `,
      [id_sesion]
    );

    if (sesionResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Sesión de caja no encontrada',
      });
    }

    const sesion = sesionResultado.rows[0];

    if (sesion.estado !== 'ABIERTA') {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'La sesión de caja ya está cerrada o cancelada',
      });
    }

    const movimientosResultado = await client.query(
      `
      SELECT
        tipo_movimiento,
        metodo_pago,
        COALESCE(SUM(monto), 0) AS total
      FROM caja_movimientos
      WHERE id_sesion = $1
      GROUP BY tipo_movimiento, metodo_pago
      `,
      [id_sesion]
    );

    const movimientos = movimientosResultado.rows;
    const montoInicial = Number(sesion.monto_inicial);

    const sumar = (tipo, metodo = null) => {
      return movimientos
        .filter((m) => {
          if (metodo) {
            return m.tipo_movimiento === tipo && m.metodo_pago === metodo;
          }

          return m.tipo_movimiento === tipo;
        })
        .reduce((acc, m) => acc + Number(m.total), 0);
    };

    const montoFinalSistema =
      montoInicial +
      sumar('VENTA', 'EFECTIVO') +
      sumar('ENTRADA', 'EFECTIVO') -
      sumar('SALIDA', 'EFECTIVO') -
      sumar('GASTO', 'EFECTIVO') -
      sumar('RETIRO', 'EFECTIVO') -
      sumar('PAGO_PROVEEDOR', 'EFECTIVO') -
      sumar('DEVOLUCION', 'EFECTIVO');

    const diferencia = Number(monto_final_real) - montoFinalSistema;

    const cierre = await client.query(
      `
      UPDATE caja_sesiones
      SET
        id_usuario_cierre = $1,
        monto_final_sistema = $2,
        monto_final_real = $3,
        diferencia = $4,
        estado = 'CERRADA',
        fecha_cierre = CURRENT_TIMESTAMP
      WHERE id_sesion = $5
      RETURNING *
      `,
      [
        req.usuario.id_usuario,
        montoFinalSistema,
        monto_final_real,
        diferencia,
        id_sesion,
      ]
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        id_sesion,
        sesion.id_sucursal,
        'CIERRE',
        'Cierre de caja',
        monto_final_real,
        'EFECTIVO',
        'CIERRE_CAJA',
        observaciones || `Cierre con diferencia: ${diferencia}`,
        req.usuario.id_usuario,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Caja cerrada correctamente',
      cierre: cierre.rows[0],
      resumen: {
        monto_final_sistema: montoFinalSistema,
        monto_final_real: Number(monto_final_real),
        diferencia,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al cerrar caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al cerrar caja',
    });
  } finally {
    client.release();
  }
};