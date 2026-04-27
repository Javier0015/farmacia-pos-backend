import { pool } from '../config/db.js';

const normalizarLote = (lote) => {
  if (!lote || !lote.trim()) {
    return 'SIN-LOTE';
  }

  return lote.trim().toUpperCase();
};

const movimientosEntrada = [
  'ENTRADA',
  'AJUSTE_POSITIVO',
  'DEVOLUCION_CLIENTE',
];

const movimientosSalida = [
  'SALIDA',
  'AJUSTE_NEGATIVO',
  'MERMA',
  'CADUCIDAD',
  'DEVOLUCION_PROVEEDOR',
];

const tiposPermitidos = [
  'ENTRADA',
  'SALIDA',
  'AJUSTE_POSITIVO',
  'AJUSTE_NEGATIVO',
  'MERMA',
  'CADUCIDAD',
  'DEVOLUCION_CLIENTE',
  'DEVOLUCION_PROVEEDOR',
];

export const listarInventarioPorSucursal = async (req, res) => {
  try {
    const { sucursal, buscar } = req.query;

    if (!sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro sucursal es obligatorio',
      });
    }

    let query = `
  SELECT
    i.id_inventario,
    i.id_sucursal,
    s.nombre AS sucursal,
    i.id_producto,
    p.codigo_barras,
    p.nombre AS producto,
    p.descripcion,
    c.nombre AS categoria,
    p.laboratorio,
    p.presentacion,
    p.precio_compra,
    p.precio_venta,
    p.puntos_por_unidad,
    i.stock_actual,
    i.stock_minimo,
    i.ubicacion,
    CASE 
      WHEN i.stock_actual <= i.stock_minimo THEN true
      ELSE false
    END AS bajo_stock,
    i.fecha_actualizacion,
    COALESCE(lotes.total_lotes, 0) AS total_lotes,
    lotes.proxima_caducidad,
    CASE
      WHEN lotes.proxima_caducidad IS NULL THEN false
      WHEN lotes.proxima_caducidad <= CURRENT_DATE + INTERVAL '90 days' THEN true
      ELSE false
    END AS caducidad_proxima
  FROM inventario_sucursal i
  INNER JOIN sucursales s ON s.id_sucursal = i.id_sucursal
  INNER JOIN productos p ON p.id_producto = i.id_producto
  LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
  LEFT JOIN (
    SELECT 
      id_sucursal,
      id_producto,
      COUNT(*) AS total_lotes,
      MIN(fecha_caducidad) FILTER (
        WHERE stock_actual > 0 
        AND activo = true 
        AND fecha_caducidad IS NOT NULL
      ) AS proxima_caducidad
    FROM inventario_lotes
    GROUP BY id_sucursal, id_producto
  ) lotes ON lotes.id_sucursal = i.id_sucursal
         AND lotes.id_producto = i.id_producto
  WHERE i.id_sucursal = $1
`;

    const params = [sucursal];

    if (buscar) {
      params.push(`%${buscar.trim()}%`);
      query += `
        AND (
          p.nombre ILIKE $${params.length}
          OR p.codigo_barras ILIKE $${params.length}
          OR p.laboratorio ILIKE $${params.length}
          OR p.presentacion ILIKE $${params.length}
        )
      `;
    }

    query += ` ORDER BY p.nombre ASC `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      inventario: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar inventario:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar inventario',
    });
  }
};

export const listarBajoStock = async (req, res) => {
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
        i.id_inventario,
        i.id_sucursal,
        s.nombre AS sucursal,
        i.id_producto,
        p.codigo_barras,
        p.nombre AS producto,
        c.nombre AS categoria,
        p.laboratorio,
        p.presentacion,
        i.stock_actual,
        i.stock_minimo,
        i.ubicacion,
        i.fecha_actualizacion
      FROM inventario_sucursal i
      INNER JOIN sucursales s ON s.id_sucursal = i.id_sucursal
      INNER JOIN productos p ON p.id_producto = i.id_producto
      LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
      WHERE i.id_sucursal = $1
      AND i.stock_actual <= i.stock_minimo
      ORDER BY i.stock_actual ASC, p.nombre ASC
      `,
      [sucursal]
    );

    return res.json({
      ok: true,
      productos_bajo_stock: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar bajo stock:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar productos con bajo stock',
    });
  }
};

export const asignarInventario = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      id_sucursal,
      id_producto,
      stock_inicial,
      stock_minimo,
      ubicacion,
      lote,
      fecha_caducidad,
      precio_compra,
      observaciones,
    } = req.body;

    if (!id_sucursal || !id_producto) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sucursal y el producto son obligatorios',
      });
    }

    if (Number(stock_inicial) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El stock inicial no puede ser negativo',
      });
    }

    const stockInicial = Number(stock_inicial || 0);
    const loteNormalizado = normalizarLote(lote);

    await client.query('BEGIN');

    const existe = await client.query(
      `
      SELECT id_inventario
      FROM inventario_sucursal
      WHERE id_sucursal = $1
      AND id_producto = $2
      `,
      [id_sucursal, id_producto]
    );

    if (existe.rows.length > 0) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        ok: false,
        mensaje: 'Ese producto ya tiene inventario asignado en esta sucursal',
      });
    }

    const inventario = await client.query(
      `
      INSERT INTO inventario_sucursal (
        id_sucursal,
        id_producto,
        stock_actual,
        stock_minimo,
        ubicacion
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [
        id_sucursal,
        id_producto,
        stockInicial,
        stock_minimo || 0,
        ubicacion || null,
      ]
    );

    let loteCreado = null;

    if (stockInicial > 0) {
      const loteResultado = await client.query(
        `
        INSERT INTO inventario_lotes (
          id_sucursal,
          id_producto,
          lote,
          fecha_caducidad,
          stock_actual,
          precio_compra,
          activo
        )
        VALUES ($1,$2,$3,$4,$5,$6,true)
        RETURNING *
        `,
        [
          id_sucursal,
          id_producto,
          loteNormalizado,
          fecha_caducidad || null,
          stockInicial,
          precio_compra || 0,
        ]
      );

      loteCreado = loteResultado.rows[0];
    }

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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        id_sucursal,
        id_producto,
        loteCreado?.id_lote || null,
        'STOCK_INICIAL',
        stockInicial,
        0,
        stockInicial,
        'ASIGNACION_INICIAL',
        observaciones || 'Asignación inicial de inventario',
        req.usuario?.id_usuario || null,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Inventario asignado correctamente',
      inventario: inventario.rows[0],
      lote: loteCreado,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al asignar inventario:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al asignar inventario',
    });
  } finally {
    client.release();
  }
};

export const ajustarInventario = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      id_sucursal,
      id_producto,
      id_lote,
      tipo_movimiento,
      cantidad,
      stock_minimo,
      ubicacion,
      lote,
      fecha_caducidad,
      precio_compra,
      referencia,
      observaciones,
    } = req.body;

    if (!id_sucursal || !id_producto || !tipo_movimiento || cantidad === undefined) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Sucursal, producto, tipo de movimiento y cantidad son obligatorios',
      });
    }

    if (Number(cantidad) <= 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La cantidad debe ser mayor a cero',
      });
    }

    if (!tiposPermitidos.includes(tipo_movimiento)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Tipo de movimiento no válido',
        tipos_permitidos: tiposPermitidos,
      });
    }

    await client.query('BEGIN');

    const inventarioActual = await client.query(
      `
      SELECT 
        id_inventario,
        stock_actual,
        stock_minimo,
        ubicacion
      FROM inventario_sucursal
      WHERE id_sucursal = $1
      AND id_producto = $2
      FOR UPDATE
      `,
      [id_sucursal, id_producto]
    );

    if (inventarioActual.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'El producto no tiene inventario asignado en esta sucursal',
      });
    }

    const stockAnterior = Number(inventarioActual.rows[0].stock_actual);
    const cantidadMovimiento = Number(cantidad);

    let stockNuevo = stockAnterior;
    let loteMovimientoId = id_lote || null;

    if (movimientosEntrada.includes(tipo_movimiento)) {
      stockNuevo = stockAnterior + cantidadMovimiento;

      const loteNormalizado = normalizarLote(lote);

      const loteExistente = await client.query(
        `
        SELECT id_lote, stock_actual
        FROM inventario_lotes
        WHERE id_sucursal = $1
        AND id_producto = $2
        AND lote = $3
        AND (
          (fecha_caducidad = $4::date)
          OR (fecha_caducidad IS NULL AND $4::date IS NULL)
        )
        FOR UPDATE
        `,
        [
          id_sucursal,
          id_producto,
          loteNormalizado,
          fecha_caducidad || null,
        ]
      );

      if (loteExistente.rows.length > 0) {
        const loteActual = loteExistente.rows[0];
        const nuevoStockLote = Number(loteActual.stock_actual) + cantidadMovimiento;

        const loteActualizado = await client.query(
          `
          UPDATE inventario_lotes
          SET
            stock_actual = $1,
            precio_compra = COALESCE($2, precio_compra),
            activo = true,
            fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_lote = $3
          RETURNING *
          `,
          [
            nuevoStockLote,
            precio_compra || null,
            loteActual.id_lote,
          ]
        );

        loteMovimientoId = loteActualizado.rows[0].id_lote;
      } else {
        const loteNuevo = await client.query(
          `
          INSERT INTO inventario_lotes (
            id_sucursal,
            id_producto,
            lote,
            fecha_caducidad,
            stock_actual,
            precio_compra,
            activo
          )
          VALUES ($1,$2,$3,$4,$5,$6,true)
          RETURNING *
          `,
          [
            id_sucursal,
            id_producto,
            loteNormalizado,
            fecha_caducidad || null,
            cantidadMovimiento,
            precio_compra || 0,
          ]
        );

        loteMovimientoId = loteNuevo.rows[0].id_lote;
      }
    }

    if (movimientosSalida.includes(tipo_movimiento)) {
      stockNuevo = stockAnterior - cantidadMovimiento;

      if (stockNuevo < 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'No hay stock suficiente para realizar este movimiento',
          stock_actual: stockAnterior,
          cantidad_solicitada: cantidadMovimiento,
        });
      }

      let cantidadPendiente = cantidadMovimiento;

      if (id_lote) {
        const loteActual = await client.query(
          `
          SELECT id_lote, stock_actual
          FROM inventario_lotes
          WHERE id_lote = $1
          AND id_sucursal = $2
          AND id_producto = $3
          FOR UPDATE
          `,
          [id_lote, id_sucursal, id_producto]
        );

        if (loteActual.rows.length === 0) {
          await client.query('ROLLBACK');

          return res.status(404).json({
            ok: false,
            mensaje: 'El lote indicado no existe para este producto y sucursal',
          });
        }

        const stockLote = Number(loteActual.rows[0].stock_actual);

        if (stockLote < cantidadMovimiento) {
          await client.query('ROLLBACK');

          return res.status(400).json({
            ok: false,
            mensaje: 'El lote no tiene stock suficiente',
            stock_lote: stockLote,
            cantidad_solicitada: cantidadMovimiento,
          });
        }

        const nuevoStockLote = stockLote - cantidadMovimiento;

        await client.query(
          `
          UPDATE inventario_lotes
          SET
            stock_actual = $1,
            activo = CASE WHEN $1::numeric <= 0::numeric THEN false ELSE true END,
            fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_lote = $2
          `,
          [nuevoStockLote, id_lote]
        );

        loteMovimientoId = id_lote;
      } else {
        const lotesDisponibles = await client.query(
          `
          SELECT id_lote, stock_actual
          FROM inventario_lotes
          WHERE id_sucursal = $1
          AND id_producto = $2
          AND activo = true
          AND stock_actual > 0
          ORDER BY 
            fecha_caducidad ASC NULLS LAST,
            fecha_entrada ASC
          FOR UPDATE
          `,
          [id_sucursal, id_producto]
        );

        for (const loteItem of lotesDisponibles.rows) {
          if (cantidadPendiente <= 0) break;

          const stockLote = Number(loteItem.stock_actual);
          const cantidadADescontar = Math.min(stockLote, cantidadPendiente);
          const nuevoStockLote = stockLote - cantidadADescontar;

          await client.query(
            `
            UPDATE inventario_lotes
            SET
              stock_actual = $1,
              activo = CASE WHEN $1::numeric <= 0::numeric THEN false ELSE true END,
              fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE id_lote = $2
            `,
            [nuevoStockLote, loteItem.id_lote]
          );

          cantidadPendiente -= cantidadADescontar;

          if (!loteMovimientoId) {
            loteMovimientoId = loteItem.id_lote;
          }
        }

        if (cantidadPendiente > 0) {
          await client.query('ROLLBACK');

          return res.status(400).json({
            ok: false,
            mensaje: 'No hay stock suficiente por lotes para realizar este movimiento',
          });
        }
      }
    }

    const inventarioActualizado = await client.query(
      `
      UPDATE inventario_sucursal
      SET 
        stock_actual = $1,
        stock_minimo = COALESCE($2, stock_minimo),
        ubicacion = COALESCE($3, ubicacion),
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_sucursal = $4
      AND id_producto = $5
      RETURNING *
      `,
      [
        stockNuevo,
        stock_minimo,
        ubicacion || null,
        id_sucursal,
        id_producto,
      ]
    );

    const movimiento = await client.query(
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [
        id_sucursal,
        id_producto,
        loteMovimientoId,
        tipo_movimiento,
        cantidadMovimiento,
        stockAnterior,
        stockNuevo,
        referencia || null,
        observaciones || null,
        req.usuario?.id_usuario || null,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Inventario actualizado correctamente',
      inventario: inventarioActualizado.rows[0],
      movimiento: movimiento.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al ajustar inventario:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al ajustar inventario',
    });
  } finally {
    client.release();
  }
};

export const listarMovimientosInventario = async (req, res) => {
  try {
    const { sucursal, producto, tipo } = req.query;

    if (!sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro sucursal es obligatorio',
      });
    }

    let query = `
      SELECT
        m.id_movimiento,
        m.id_sucursal,
        s.nombre AS sucursal,
        m.id_producto,
        p.nombre AS producto,
        p.codigo_barras,
        m.id_lote,
        il.lote,
        il.fecha_caducidad,
        m.tipo_movimiento,
        m.cantidad,
        m.stock_anterior,
        m.stock_nuevo,
        m.referencia,
        m.observaciones,
        m.id_usuario,
        u.nombre AS usuario,
        m.fecha_movimiento
      FROM inventario_movimientos m
      INNER JOIN sucursales s ON s.id_sucursal = m.id_sucursal
      INNER JOIN productos p ON p.id_producto = m.id_producto
      LEFT JOIN usuarios u ON u.id_usuario = m.id_usuario
      LEFT JOIN inventario_lotes il ON il.id_lote = m.id_lote
      WHERE m.id_sucursal = $1
    `;

    const params = [sucursal];

    if (producto) {
      params.push(producto);
      query += ` AND m.id_producto = $${params.length} `;
    }

    if (tipo) {
      params.push(tipo);
      query += ` AND m.tipo_movimiento = $${params.length} `;
    }

    query += ` ORDER BY m.fecha_movimiento DESC `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      movimientos: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar movimientos:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar movimientos de inventario',
    });
  }
};

export const listarLotesProducto = async (req, res) => {
  try {
    const { sucursal, producto } = req.query;

    if (!sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro sucursal es obligatorio',
      });
    }

    let query = `
      SELECT
        il.id_lote,
        il.id_sucursal,
        s.nombre AS sucursal,
        il.id_producto,
        p.nombre AS producto,
        p.codigo_barras,
        il.lote,
        il.fecha_caducidad,
        il.stock_actual,
        il.precio_compra,
        il.activo,
        il.fecha_entrada,
        il.fecha_actualizacion,
        CASE
          WHEN il.fecha_caducidad IS NULL THEN false
          WHEN il.fecha_caducidad <= CURRENT_DATE + INTERVAL '90 days' THEN true
          ELSE false
        END AS caducidad_proxima,
        CASE
          WHEN il.fecha_caducidad IS NULL THEN false
          WHEN il.fecha_caducidad < CURRENT_DATE THEN true
          ELSE false
        END AS caducado
      FROM inventario_lotes il
      INNER JOIN sucursales s ON s.id_sucursal = il.id_sucursal
      INNER JOIN productos p ON p.id_producto = il.id_producto
      WHERE il.id_sucursal = $1
    `;

    const params = [sucursal];

    if (producto) {
      params.push(producto);
      query += ` AND il.id_producto = $${params.length} `;
    }

    query += `
      ORDER BY 
        il.fecha_caducidad ASC NULLS LAST,
        il.fecha_entrada ASC
    `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      lotes: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar lotes:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar lotes',
    });
  }
};

export const listarCaducidadProxima = async (req, res) => {
  try {
    const { sucursal, dias = 90 } = req.query;

    if (!sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro sucursal es obligatorio',
      });
    }

    const resultado = await pool.query(
      `
      SELECT
        il.id_lote,
        il.id_sucursal,
        s.nombre AS sucursal,
        il.id_producto,
        p.nombre AS producto,
        p.codigo_barras,
        il.lote,
        il.fecha_caducidad,
        il.stock_actual,
        il.precio_compra,
        il.activo,
        il.fecha_entrada,
        CASE
          WHEN il.fecha_caducidad < CURRENT_DATE THEN 'CADUCADO'
          ELSE 'POR_CADUCAR'
        END AS estado_caducidad
      FROM inventario_lotes il
      INNER JOIN sucursales s ON s.id_sucursal = il.id_sucursal
      INNER JOIN productos p ON p.id_producto = il.id_producto
      WHERE il.id_sucursal = $1
      AND il.stock_actual > 0
      AND il.fecha_caducidad IS NOT NULL
      AND il.fecha_caducidad <= CURRENT_DATE + ($2 || ' days')::INTERVAL
      ORDER BY il.fecha_caducidad ASC
      `,
      [sucursal, dias]
    );

    return res.json({
      ok: true,
      dias: Number(dias),
      productos_caducidad: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar caducidad próxima:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar productos por caducar',
    });
  }
};


export const bajaLotePorCaducidad = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_sucursal, id_producto, id_lote, observaciones } = req.body;

    if (!id_sucursal || !id_producto || !id_lote) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Sucursal, producto y lote son obligatorios',
      });
    }

    await client.query('BEGIN');

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
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'El lote no existe para esta sucursal y producto',
      });
    }

    const lote = loteResultado.rows[0];
    const stockLote = Number(lote.stock_actual || 0);

    if (stockLote <= 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El lote no tiene stock disponible para dar de baja',
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
        mensaje: 'No existe inventario general para este producto en la sucursal',
      });
    }

    const stockAnterior = Number(inventarioResultado.rows[0].stock_actual || 0);
    const stockNuevo = Math.max(stockAnterior - stockLote, 0);

    await client.query(
      `
      UPDATE inventario_lotes
      SET
        stock_actual = 0,
        activo = false,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_lote = $1
      `,
      [id_lote]
    );

    const inventarioActualizado = await client.query(
      `
      UPDATE inventario_sucursal
      SET
        stock_actual = $1,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_sucursal = $2
      AND id_producto = $3
      RETURNING *
      `,
      [stockNuevo, id_sucursal, id_producto]
    );

    const movimiento = await client.query(
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
      VALUES ($1,$2,$3,'CADUCIDAD',$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        id_sucursal,
        id_producto,
        id_lote,
        stockLote,
        stockAnterior,
        stockNuevo,
        `CADUCIDAD-${lote.lote}`,
        observaciones ||
        `Baja por caducidad del lote ${lote.lote}`,
        req.usuario?.id_usuario || null,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Lote dado de baja por caducidad correctamente',
      lote: {
        ...lote,
        stock_baja: stockLote,
      },
      inventario: inventarioActualizado.rows[0],
      movimiento: movimiento.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al dar de baja lote por caducidad:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al dar de baja lote por caducidad',
    });
  } finally {
    client.release();
  }
};