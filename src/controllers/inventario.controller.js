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
        p.es_controlado AS controlado,
        p.requiere_receta,
        p.precio_compra,
        p.precio_venta,
        p.puntos_por_unidad,
        p.activo,
        i.stock_actual,
        i.stock_minimo,
        i.ubicacion,

        CASE 
          WHEN i.stock_actual <= i.stock_minimo THEN true
          ELSE false
        END AS bajo_stock,

        oc.id_oferta,
        oc.nombre AS oferta_nombre,
        oc.porcentaje_descuento,

        CASE
          WHEN oc.id_oferta IS NOT NULL THEN true
          ELSE false
        END AS tiene_oferta,

        CASE
          WHEN oc.id_oferta IS NOT NULL THEN
            ROUND(
              p.precio_venta - (p.precio_venta * oc.porcentaje_descuento / 100),
              2
            )
          ELSE
            p.precio_venta
        END AS precio_con_descuento,

        CASE
          WHEN oc.id_oferta IS NOT NULL THEN
            ROUND(
              p.precio_venta * oc.porcentaje_descuento / 100,
              2
            )
          ELSE
            0
        END AS descuento_unitario,

        i.fecha_actualizacion,
        COALESCE(lotes.total_lotes, 0) AS total_lotes,
        lotes.proxima_caducidad,

        CASE
          WHEN lotes.proxima_caducidad IS NULL THEN false
          WHEN lotes.proxima_caducidad <= CURRENT_DATE + INTERVAL '90 days' THEN true
          ELSE false
        END AS caducidad_proxima

      FROM inventario_sucursal i
      INNER JOIN sucursales s 
        ON s.id_sucursal = i.id_sucursal
      INNER JOIN productos p 
        ON p.id_producto = i.id_producto
      LEFT JOIN categorias c 
        ON c.id_categoria = p.id_categoria

      LEFT JOIN ofertas_categorias oc
        ON oc.id_categoria = p.id_categoria
       AND oc.activo = true
       AND CURRENT_DATE BETWEEN oc.fecha_inicio AND oc.fecha_fin

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
      ) lotes 
        ON lotes.id_sucursal = i.id_sucursal
       AND lotes.id_producto = i.id_producto

      WHERE i.id_sucursal = $1
        AND p.activo = true
    `;

    const params = [sucursal];

    if (buscar && buscar.trim()) {
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

    query += `
      ORDER BY p.nombre ASC
    `;

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
      id_proveedor,
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
  id_proveedor,
  lote,
  fecha_caducidad,
  stock_actual,
  precio_compra,
  activo
)
VALUES ($1,$2,$3,$4,$5,$6,$7,true)
RETURNING *
        `,
        [
          id_sucursal,
          id_producto,
          id_proveedor || null,
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
  id_proveedor,
  tipo_movimiento,
  cantidad,
  stock_anterior,
  stock_nuevo,
  referencia,
  observaciones,
  id_usuario
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        id_sucursal,
        id_producto,
        loteCreado?.id_lote || null,
        id_proveedor || null,
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
      id_proveedor,
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
  id_proveedor = COALESCE($3, id_proveedor),
  activo = true,
  fecha_actualizacion = CURRENT_TIMESTAMP
WHERE id_lote = $4
RETURNING *
          `,
          [
            nuevoStockLote,
            precio_compra || null,
            id_proveedor || null,
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
  id_proveedor,
  lote,
  fecha_caducidad,
  stock_actual,
  precio_compra,
  activo
)
VALUES ($1,$2,$3,$4,$5,$6,$7,true)
RETURNING *
          `,
          [
            id_sucursal,
            id_producto,
            id_proveedor || null,
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
  id_proveedor,
  tipo_movimiento,
  cantidad,
  stock_anterior,
  stock_nuevo,
  referencia,
  observaciones,
  id_usuario
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
RETURNING *
      `,
      [
        id_sucursal,
        id_producto,
        loteMovimientoId,
        id_proveedor || null,
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
    const { sucursal, producto, tipo, fecha_inicio, fecha_fin } = req.query;

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

        m.id_proveedor,
        prv.nombre AS proveedor,

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
      INNER JOIN sucursales s 
        ON s.id_sucursal = m.id_sucursal
      INNER JOIN productos p 
        ON p.id_producto = m.id_producto
      LEFT JOIN usuarios u 
        ON u.id_usuario = m.id_usuario
      LEFT JOIN inventario_lotes il 
        ON il.id_lote = m.id_lote
      LEFT JOIN proveedores prv 
        ON prv.id_proveedor = m.id_proveedor
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

    if (fecha_inicio) {
      params.push(fecha_inicio);
      query += ` AND m.fecha_movimiento >= $${params.length}::date `;
    }

    if (fecha_fin) {
      params.push(fecha_fin);
      query += ` AND m.fecha_movimiento < ($${params.length}::date + INTERVAL '1 day') `;
    }

    query += `
      ORDER BY m.fecha_movimiento DESC
    `;

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

        il.id_proveedor,
        prv.nombre AS proveedor,

        il.id_compra,
        co.folio AS folio_compra,
        il.id_compra_detalle,

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
      INNER JOIN sucursales s 
        ON s.id_sucursal = il.id_sucursal
      INNER JOIN productos p 
        ON p.id_producto = il.id_producto
      LEFT JOIN proveedores prv 
        ON prv.id_proveedor = il.id_proveedor
      LEFT JOIN compras co 
        ON co.id_compra = il.id_compra
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

export const actualizarLote = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_lote } = req.params;

    const {
      id_proveedor,
      lote,
      fecha_caducidad,
      precio_compra,
    } = req.body;

    if (!id_lote) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El ID del lote es obligatorio',
      });
    }

    if (!lote || !String(lote).trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El lote es obligatorio',
      });
    }

    if (precio_compra !== undefined && precio_compra !== null && Number(precio_compra) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El precio de compra no puede ser negativo',
      });
    }

    await client.query('BEGIN');

    const loteActualResultado = await client.query(
      `
      SELECT
        id_lote,
        id_sucursal,
        id_producto,
        id_proveedor,
        lote,
        fecha_caducidad,
        stock_actual,
        precio_compra,
        activo
      FROM inventario_lotes
      WHERE id_lote = $1
      FOR UPDATE
      `,
      [id_lote]
    );

    if (loteActualResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'El lote no existe',
      });
    }

    const loteActual = loteActualResultado.rows[0];
    const loteNormalizado = normalizarLote(lote);

    const loteDuplicado = await client.query(
      `
      SELECT id_lote
      FROM inventario_lotes
      WHERE id_sucursal = $1
        AND id_producto = $2
        AND lote = $3
        AND (
          (fecha_caducidad = $4::date)
          OR (fecha_caducidad IS NULL AND $4::date IS NULL)
        )
        AND id_lote <> $5
      LIMIT 1
      `,
      [
        loteActual.id_sucursal,
        loteActual.id_producto,
        loteNormalizado,
        fecha_caducidad || null,
        id_lote,
      ]
    );

    if (loteDuplicado.rows.length > 0) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe otro lote con el mismo número y fecha de caducidad para este producto',
      });
    }

    const loteActualizadoResultado = await client.query(
      `
      UPDATE inventario_lotes
      SET
        id_proveedor = $1,
        lote = $2,
        fecha_caducidad = $3,
        precio_compra = $4,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_lote = $5
      RETURNING *
      `,
      [
        id_proveedor ? Number(id_proveedor) : null,
        loteNormalizado,
        fecha_caducidad || null,
        precio_compra !== '' && precio_compra !== null && precio_compra !== undefined
          ? Number(precio_compra)
          : 0,
        id_lote,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Lote actualizado correctamente',
      lote: loteActualizadoResultado.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al actualizar lote:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar el lote',
      error: error.message,
    });
  } finally {
    client.release();
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

export const consultarStockSucursales = async (req, res) => {
  try {
    const {
      buscar = '',
      busqueda = '',
      nombre = '',
      codigo_barras = '',
      codigo = '',
      presentacion = '',
    } = req.query;

    const textoBusqueda = String(
      buscar ||
      busqueda ||
      nombre ||
      codigo_barras ||
      codigo ||
      presentacion ||
      ''
    ).trim();

    if (!textoBusqueda) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'Debes escribir el nombre, código de barras o presentación del producto',
      });
    }

    const texto = `%${textoBusqueda}%`;

    const productoResultado = await pool.query(
      `
      SELECT
        p.id_producto,
        p.codigo_barras,
        p.nombre,
        p.descripcion,
        p.laboratorio,
        p.presentacion,
        c.nombre AS categoria,
        p.precio_venta
      FROM productos p
      LEFT JOIN categorias c 
        ON c.id_categoria = p.id_categoria
      WHERE 
        p.activo = true
        AND (
          p.nombre ILIKE $1
          OR p.codigo_barras ILIKE $1
          OR p.laboratorio ILIKE $1
          OR p.presentacion ILIKE $1
        )
      ORDER BY 
        CASE 
          WHEN p.codigo_barras = $2 THEN 1
          WHEN p.nombre ILIKE $1 THEN 2
          WHEN p.presentacion ILIKE $1 THEN 3
          WHEN p.laboratorio ILIKE $1 THEN 4
          ELSE 5
        END,
        p.nombre ASC
      LIMIT 1
      `,
      [texto, textoBusqueda]
    );

    if (productoResultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró ningún producto con esa búsqueda',
      });
    }

    const producto = productoResultado.rows[0];

    const sucursalesResultado = await pool.query(
      `
      SELECT
        s.id_sucursal,
        s.nombre AS sucursal,
        s.direccion,
        COALESCE(i.stock_actual, 0) AS stock,
        COALESCE(i.stock_minimo, 0) AS stock_minimo,
        i.ubicacion,
        i.fecha_actualizacion,
        CASE
          WHEN COALESCE(i.stock_actual, 0) <= 0 THEN 'SIN_STOCK'
          WHEN COALESCE(i.stock_actual, 0) <= COALESCE(i.stock_minimo, 0) THEN 'STOCK_BAJO'
          ELSE 'DISPONIBLE'
        END AS estado
      FROM sucursales s
      LEFT JOIN inventario_sucursal i 
        ON i.id_sucursal = s.id_sucursal
       AND i.id_producto = $1
      WHERE s.activo = true
      ORDER BY 
        COALESCE(i.stock_actual, 0) DESC,
        s.nombre ASC
      `,
      [producto.id_producto]
    );

    const sucursales = sucursalesResultado.rows;

    const productos = sucursales.map((sucursal) => ({
      id_producto: producto.id_producto,
      codigo_barras: producto.codigo_barras,
      nombre_producto: producto.nombre,
      nombre: producto.nombre,
      descripcion: producto.descripcion,
      laboratorio: producto.laboratorio,
      presentacion: producto.presentacion,
      categoria: producto.categoria,
      precio_venta: producto.precio_venta,

      id_sucursal: sucursal.id_sucursal,
      nombre_sucursal: sucursal.sucursal,
      sucursal: sucursal.sucursal,
      direccion_sucursal: sucursal.direccion,

      stock_disponible: Number(sucursal.stock || 0),
      stock: Number(sucursal.stock || 0),
      stock_minimo: Number(sucursal.stock_minimo || 0),
      ubicacion: sucursal.ubicacion,
      estado: sucursal.estado,
      fecha_actualizacion: sucursal.fecha_actualizacion,

      lote: null,
      fecha_caducidad: null,
    }));

    return res.json({
      ok: true,
      producto: {
        id_producto: producto.id_producto,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        codigo_barras: producto.codigo_barras,
        laboratorio: producto.laboratorio,
        presentacion: producto.presentacion,
        categoria: producto.categoria,
        precio_venta: producto.precio_venta,
      },
      sucursales,
      productos,
    });
  } catch (error) {
    console.error('Error al consultar stock en sucursales:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al consultar stock en sucursales',
      error: error.message,
    });
  }
};