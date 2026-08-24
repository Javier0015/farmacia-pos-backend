import { pool } from '../config/db.js';

const generarFolioCompra = () => {
  const fecha = new Date();

  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mi = String(fecha.getMinutes()).padStart(2, '0');
  const ss = String(fecha.getSeconds()).padStart(2, '0');
  const random = Math.floor(Math.random() * 9000) + 1000;

  return `C-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${random}`;
};

const normalizarLote = (lote) => {
  if (!lote || !lote.trim()) {
    return 'SIN-LOTE';
  }

  return lote.trim().toUpperCase();
};

const redondearMoneda = (valor) => {
  return Math.round((Number(valor || 0) + Number.EPSILON) * 100) / 100;
};

const aCentavos = (valor) => {
  return Math.round((Number(valor || 0) + Number.EPSILON) * 100);
};

export const crearCompra = async (req, res) => {
  const client = await pool.connect();

  try {
    let body = req.body;

    if (req.body.data) {
      try {
        body = JSON.parse(req.body.data);
      } catch (error) {
        return res.status(400).json({
          ok: false,
          mensaje: 'El formato de los datos de la compra no es válido',
        });
      }
    }

    const {
      id_sucursal,
      id_proveedor,
      productos = [],
      impuesto = 0,
      descuento = 0,
      total_manual = 0,
      metodo_pago = 'PENDIENTE',
      monto_pagado = 0,
      id_sesion = null,
      observaciones,
    } = body;

    const ticketProveedorUrl = req.file
      ? `/uploads/tickets_proveedor/${req.file.filename}`
      : null;

    if (!id_sucursal || !id_proveedor) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Sucursal y proveedor son obligatorios',
      });
    }

    if (!Array.isArray(productos)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El campo productos debe ser un arreglo',
      });
    }

    await client.query('BEGIN');

    const proveedorExiste = await client.query(
      `
      SELECT id_proveedor, nombre, activo
      FROM proveedores
      WHERE id_proveedor = $1
      `,
      [id_proveedor]
    );

    if (proveedorExiste.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Proveedor no encontrado',
      });
    }

    if (!proveedorExiste.rows[0].activo) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El proveedor está inactivo',
      });
    }

    const sucursalExiste = await client.query(
      `
      SELECT id_sucursal
      FROM sucursales
      WHERE id_sucursal = $1
      AND activo = true
      `,
      [id_sucursal]
    );

    if (sucursalExiste.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Sucursal no encontrada o inactiva',
      });
    }

    if (id_sesion) {
      const sesionExiste = await client.query(
        `
        SELECT id_sesion
        FROM caja_sesiones
        WHERE id_sesion = $1
        AND id_sucursal = $2
        AND estado = 'ABIERTA'
        `,
        [id_sesion, id_sucursal]
      );

      if (sesionExiste.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'La sesión de caja no existe, no pertenece a la sucursal o no está abierta',
        });
      }
    }

    let subtotalCompra = 0;
    const productosProcesados = [];

    for (const item of productos) {
      const {
        id_producto,
        cantidad,
        precio_compra,
        descuento: descuentoProducto = 0,
        lote,
        fecha_caducidad,
        ubicacion,
        observaciones: observacionesDetalle,
      } = item;

      if (!id_producto || !cantidad || Number(cantidad) <= 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'Cada producto debe tener id_producto y cantidad mayor a cero',
        });
      }

      if (precio_compra === undefined || Number(precio_compra) < 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'Cada producto debe tener precio de compra válido',
        });
      }

      const productoExiste = await client.query(
        `
        SELECT id_producto, nombre, activo
        FROM productos
        WHERE id_producto = $1
        `,
        [id_producto]
      );

      if (productoExiste.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: `Producto no encontrado: ${id_producto}`,
        });
      }

      if (!productoExiste.rows[0].activo) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `El producto ${productoExiste.rows[0].nombre} está inactivo`,
        });
      }

      const cantidadNum = Number(cantidad);
      const precioCompraNum = redondearMoneda(precio_compra);
      const descuentoProductoNum = redondearMoneda(descuentoProducto || 0);
      const subtotalProducto = redondearMoneda(
        cantidadNum * precioCompraNum - descuentoProductoNum
      );

      if (subtotalProducto < 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `El subtotal del producto ${productoExiste.rows[0].nombre} no puede ser negativo`,
        });
      }

      subtotalCompra = redondearMoneda(subtotalCompra + subtotalProducto);

      productosProcesados.push({
        id_producto,
        producto: productoExiste.rows[0].nombre,
        cantidad: cantidadNum,
        precio_compra: precioCompraNum,
        descuento: descuentoProductoNum,
        subtotal: subtotalProducto,
        lote: normalizarLote(lote),
        fecha_caducidad: fecha_caducidad || null,
        ubicacion: ubicacion?.trim() || null,
        observaciones: observacionesDetalle || null,
      });
    }

    const impuestoNum = redondearMoneda(impuesto || 0);
    const descuentoNum = redondearMoneda(descuento || 0);
    const totalManualNum = redondearMoneda(total_manual || 0);

    const totalCompra = redondearMoneda(
      productosProcesados.length === 0
        ? totalManualNum - descuentoNum + impuestoNum
        : subtotalCompra - descuentoNum + impuestoNum
    );

    if (totalCompra < 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El total de la compra no puede ser negativo',
      });
    }

    const montoPagadoNum = redondearMoneda(monto_pagado || 0);

    if (montoPagadoNum < 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El monto pagado no puede ser negativo',
      });
    }

    const totalCentavos = aCentavos(totalCompra);
    const pagadoCentavos = aCentavos(montoPagadoNum);

    if (pagadoCentavos > totalCentavos) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El monto pagado no puede ser mayor al total de la compra',
      });
    }

    const saldoCentavos = Math.max(totalCentavos - pagadoCentavos, 0);
    const saldo = saldoCentavos / 100;

    let estado = 'PENDIENTE';

    if (pagadoCentavos > 0 && saldoCentavos > 0) {
      estado = 'PARCIAL';
    }

    if (pagadoCentavos > 0 && saldoCentavos === 0) {
      estado = 'PAGADA';
    }

    const folio = generarFolioCompra();

    const compraResultado = await client.query(
      `
      INSERT INTO compras (
        folio,
        id_sucursal,
        id_proveedor,
        id_usuario,
        subtotal,
        impuesto,
        descuento,
        total,
        monto_pagado,
        saldo,
        metodo_pago,
        estado,
        id_sesion,
        observaciones,
        ticket_proveedor_url
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
      `,
      [
        folio,
        id_sucursal,
        id_proveedor,
        req.usuario.id_usuario,
        subtotalCompra,
        impuestoNum,
        descuentoNum,
        totalCompra,
        montoPagadoNum,
        saldo,
        metodo_pago,
        estado,
        id_sesion,
        observaciones || null,
        ticketProveedorUrl,
      ]
    );

    const compra = compraResultado.rows[0];

    for (const item of productosProcesados) {
      const detalleCompraResultado = await client.query(
        `
  INSERT INTO compra_detalle (
    id_compra,
    id_producto,
    cantidad,
    precio_compra,
    descuento,
    subtotal,
    lote,
    fecha_caducidad,
    observaciones,
    activo
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
  RETURNING *
  `,
        [
          compra.id_compra,
          item.id_producto,
          item.cantidad,
          item.precio_compra,
          item.descuento,
          item.subtotal,
          item.lote,
          item.fecha_caducidad,
          item.observaciones,
        ]
      );

      const detalleCompra = detalleCompraResultado.rows[0];

      const inventarioActual = await client.query(
        `
        SELECT id_inventario, stock_actual
        FROM inventario_sucursal
        WHERE id_sucursal = $1
        AND id_producto = $2
        FOR UPDATE
        `,
        [id_sucursal, item.id_producto]
      );

      let stockAnterior = 0;
      let stockNuevo = item.cantidad;

      if (inventarioActual.rows.length === 0) {
        await client.query(
          `
    INSERT INTO inventario_sucursal (
      id_sucursal,
      id_producto,
      stock_actual,
      stock_minimo,
      ubicacion
    )
    VALUES ($1,$2,$3,0,$4)
    `,
          [
            id_sucursal,
            item.id_producto,
            item.cantidad,
            item.ubicacion,
          ]
        );
      } else {
        stockAnterior = Number(inventarioActual.rows[0].stock_actual || 0);
        stockNuevo = stockAnterior + item.cantidad;

        await client.query(
          `
    UPDATE inventario_sucursal
    SET
      stock_actual = $1,
      ubicacion = COALESCE(NULLIF($2, ''), ubicacion),
      fecha_actualizacion = CURRENT_TIMESTAMP
    WHERE id_sucursal = $3
    AND id_producto = $4
    `,
          [
            stockNuevo,
            item.ubicacion,
            id_sucursal,
            item.id_producto,
          ]
        );
      }

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
          item.id_producto,
          item.lote,
          item.fecha_caducidad,
        ]
      );

      let idLoteMovimiento = null;

      if (loteExistente.rows.length > 0) {
        const loteActual = loteExistente.rows[0];
        const nuevoStockLote = Number(loteActual.stock_actual || 0) + item.cantidad;

        const loteActualizado = await client.query(
          `
          UPDATE inventario_lotes
          SET
            stock_actual = $1,
            precio_compra = $2,
            id_proveedor = $3,
            id_compra = $4,
            id_compra_detalle = $5,
            activo = true,
            fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_lote = $6
          RETURNING *
          `,
          [
            nuevoStockLote,
            item.precio_compra,
            id_proveedor,
            compra.id_compra,
            detalleCompra.id_detalle,
            loteActual.id_lote,
          ]
        );

        idLoteMovimiento = loteActualizado.rows[0].id_lote;
      } else {
        const loteNuevo = await client.query(
          `
         INSERT INTO inventario_lotes (
  id_sucursal,
  id_producto,
  id_proveedor,
  id_compra,
  id_compra_detalle,
  lote,
  fecha_caducidad,
  stock_actual,
  precio_compra,
  activo
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
RETURNING *
          `,
          [
            id_sucursal,
            item.id_producto,
            id_proveedor,
            compra.id_compra,
            detalleCompra.id_detalle,
            item.lote,
            item.fecha_caducidad,
            item.cantidad,
            item.precio_compra,
          ]
        );

        idLoteMovimiento = loteNuevo.rows[0].id_lote;
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
  VALUES ($1,$2,$3,$4,'ENTRADA',$5,$6,$7,$8,$9,$10)
  `,
        [
          id_sucursal,
          item.id_producto,
          idLoteMovimiento,
          id_proveedor,
          item.cantidad,
          stockAnterior,
          stockNuevo,
          folio,
          `Entrada por compra ${folio} | Lote ${item.lote} | Proveedor ${proveedorExiste.rows[0].nombre}`,
          req.usuario.id_usuario,
        ]
      );
    }

    if (montoPagadoNum > 0) {
      await client.query(
        `
        INSERT INTO pagos_proveedor (
          id_compra,
          id_proveedor,
          id_sucursal,
          id_sesion,
          id_usuario,
          monto,
          metodo_pago,
          referencia,
          observaciones
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
        [
          compra.id_compra,
          id_proveedor,
          id_sucursal,
          id_sesion,
          req.usuario.id_usuario,
          montoPagadoNum,
          metodo_pago,
          folio,
          `Pago registrado al crear compra ${folio}`,
        ]
      );

      if (metodo_pago === 'EFECTIVO') {
        if (!id_sesion) {
          await client.query('ROLLBACK');

          return res.status(400).json({
            ok: false,
            mensaje: 'Para pagar en efectivo se requiere una sesión de caja abierta',
          });
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
          VALUES ($1,$2,'PAGO_PROVEEDOR',$3,$4,'EFECTIVO',$5,$6,$7)
          `,
          [
            id_sesion,
            id_sucursal,
            `Pago proveedor compra ${folio}`,
            montoPagadoNum,
            folio,
            `Salida por pago a proveedor ${proveedorExiste.rows[0].nombre}`,
            req.usuario.id_usuario,
          ]
        );
      }
    }

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Compra registrada correctamente',
      compra: {
        ...compra,
        productos: productosProcesados,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al crear compra:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear compra',
    });
  } finally {
    client.release();
  }
};

export const listarCompras = async (req, res) => {
  try {
    const { sucursal, proveedor, estado, fecha_inicio, fecha_fin } = req.query;

    let query = `
      SELECT
        c.id_compra,
        c.folio,
        c.id_sucursal,
        s.nombre AS sucursal,
        c.id_proveedor,
        p.nombre AS proveedor,
        c.id_usuario,
        u.nombre AS usuario,
        c.subtotal,
        c.impuesto,
        c.descuento,
        c.total,
        c.monto_pagado,
        c.saldo,
        c.metodo_pago,
        c.estado,
        c.id_sesion,
        c.observaciones,
        c.ticket_proveedor_url,
        c.fecha_compra
      FROM compras c
      INNER JOIN sucursales s ON s.id_sucursal = c.id_sucursal
      INNER JOIN proveedores p ON p.id_proveedor = c.id_proveedor
      INNER JOIN usuarios u ON u.id_usuario = c.id_usuario
      WHERE 1 = 1
    `;

    const params = [];

    if (sucursal) {
      params.push(sucursal);
      query += ` AND c.id_sucursal = $${params.length} `;
    }

    if (proveedor) {
      params.push(proveedor);
      query += ` AND c.id_proveedor = $${params.length} `;
    }

    if (estado) {
      params.push(estado);
      query += ` AND c.estado = $${params.length} `;
    }

    if (fecha_inicio) {
      params.push(fecha_inicio);
      query += ` AND c.fecha_compra >= $${params.length} `;
    }

    if (fecha_fin) {
      params.push(fecha_fin);
      query += ` AND c.fecha_compra <= $${params.length} `;
    }

    query += ` ORDER BY c.fecha_compra DESC `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      compras: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar compras:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar compras',
    });
  }
};

export const obtenerCompra = async (req, res) => {
  try {
    const { id } = req.params;

    const compraResultado = await pool.query(
      `
      SELECT
        c.id_compra,
        c.folio,
        c.id_sucursal,
        s.nombre AS sucursal,
        c.id_proveedor,
        p.nombre AS proveedor,
        p.rfc AS proveedor_rfc,
        c.id_usuario,
        u.nombre AS usuario,
        c.subtotal,
        c.impuesto,
        c.descuento,
        c.total,
        c.monto_pagado,
        c.saldo,
        c.metodo_pago,
        c.estado,
        c.id_sesion,
        c.observaciones,
        c.ticket_proveedor_url,
        c.fecha_compra
      FROM compras c
      INNER JOIN sucursales s ON s.id_sucursal = c.id_sucursal
      INNER JOIN proveedores p ON p.id_proveedor = c.id_proveedor
      INNER JOIN usuarios u ON u.id_usuario = c.id_usuario
      WHERE c.id_compra = $1
      `,
      [id]
    );

    if (compraResultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Compra no encontrada',
      });
    }

    const detalleResultado = await pool.query(
      `
  SELECT
    cd.id_detalle,
    cd.id_producto,
    pr.codigo_barras,
    pr.nombre AS producto,
    cd.cantidad,
    cd.precio_compra,
    cd.descuento,
    cd.subtotal,
    cd.lote,
    cd.fecha_caducidad,
    inv.ubicacion,
    cd.observaciones
  FROM compra_detalle cd
  INNER JOIN productos pr ON pr.id_producto = cd.id_producto
  LEFT JOIN inventario_sucursal inv 
    ON inv.id_sucursal = (
      SELECT id_sucursal 
      FROM compras 
      WHERE id_compra = cd.id_compra
    )
    AND inv.id_producto = cd.id_producto
  WHERE cd.id_compra = $1
    AND cd.activo = true
  ORDER BY cd.id_detalle ASC
  `,
      [id]
    );

    const pagosResultado = await pool.query(
      `
  SELECT
    pp.id_pago,
    pp.id_compra,
    pp.id_proveedor,
    pp.id_sucursal,
    pp.id_sesion,
    pp.monto,
    pp.metodo_pago,
    pp.referencia,
    pp.observaciones,
    pp.fecha_pago,
    cs.id_caja,
    cj.nombre AS caja,
    u.nombre AS usuario
  FROM pagos_proveedor pp
  INNER JOIN usuarios u ON u.id_usuario = pp.id_usuario
  LEFT JOIN caja_sesiones cs ON cs.id_sesion = pp.id_sesion
  LEFT JOIN cajas cj ON cj.id_caja = cs.id_caja
  WHERE pp.id_compra = $1
  ORDER BY pp.fecha_pago DESC
  `,
      [id]
    );

    return res.json({
      ok: true,
      compra: compraResultado.rows[0],
      detalle: detalleResultado.rows,
      pagos: pagosResultado.rows,
    });
  } catch (error) {
    console.error('Error al obtener compra:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener compra',
    });
  }
};

export const actualizarCompra = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    let body = req.body;

    if (req.body.data) {
      try {
        body = JSON.parse(req.body.data);
      } catch (error) {
        return res.status(400).json({
          ok: false,
          mensaje: 'El formato de los datos de la compra no es válido',
        });
      }
    }

    const {
      id_sucursal,
      id_proveedor,
      productos = [],
      impuesto = 0,
      descuento = 0,
      total_manual = 0,
      metodo_pago = 'PENDIENTE',
      monto_pagado = 0,
      id_sesion = null,
      observaciones,
    } = body;

    const ticketProveedorUrl = req.file
      ? `/uploads/tickets_proveedor/${req.file.filename}`
      : null;

    if (!id_sucursal || !id_proveedor) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Sucursal y proveedor son obligatorios',
      });
    }

    if (!Array.isArray(productos)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El campo productos debe ser un arreglo',
      });
    }

    await client.query('BEGIN');

    const compraActualResultado = await client.query(
      `
      SELECT *
      FROM compras
      WHERE id_compra = $1
      FOR UPDATE
      `,
      [id]
    );

    if (compraActualResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Compra no encontrada',
      });
    }

    const compraActual = compraActualResultado.rows[0];

    if (compraActual.estado !== 'PENDIENTE') {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'Solo se pueden editar compras pendientes',
      });
    }

    const proveedorExiste = await client.query(
      `
      SELECT id_proveedor, nombre, activo
      FROM proveedores
      WHERE id_proveedor = $1
      `,
      [id_proveedor]
    );

    if (proveedorExiste.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Proveedor no encontrado',
      });
    }

    if (!proveedorExiste.rows[0].activo) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El proveedor está inactivo',
      });
    }

    const sucursalExiste = await client.query(
      `
      SELECT id_sucursal
      FROM sucursales
      WHERE id_sucursal = $1
        AND activo = true
      `,
      [id_sucursal]
    );

    if (sucursalExiste.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Sucursal no encontrada o inactiva',
      });
    }

    if (id_sesion) {
      const sesionExiste = await client.query(
        `
        SELECT id_sesion
        FROM caja_sesiones
        WHERE id_sesion = $1
          AND id_sucursal = $2
          AND estado = 'ABIERTA'
        `,
        [id_sesion, id_sucursal]
      );

      if (sesionExiste.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje:
            'La sesión de caja no existe, no pertenece a la sucursal o no está abierta',
        });
      }
    }

    /*
      1. Revertir detalle anterior.
      Solo permitimos editar compras PENDIENTES, pero aun así validamos que el stock
      y los lotes todavía tengan existencia suficiente para deshacer la entrada anterior.
    */
    const detalleAnterior = await client.query(
      `
      SELECT
        id_producto,
        cantidad,
        lote,
        fecha_caducidad
      FROM compra_detalle
      WHERE id_compra = $1
        AND activo = true
      `,
      [id]
    );

    for (const item of detalleAnterior.rows) {
      const cantidadAnterior = Number(item.cantidad || 0);
      const loteNormalizado = normalizarLote(item.lote);

      const inventarioActual = await client.query(
        `
        SELECT id_inventario, stock_actual
        FROM inventario_sucursal
        WHERE id_sucursal = $1
          AND id_producto = $2
        FOR UPDATE
        `,
        [compraActual.id_sucursal, item.id_producto]
      );

      if (inventarioActual.rows.length > 0) {
        const stockAnterior = Number(inventarioActual.rows[0].stock_actual || 0);
        const stockNuevo = stockAnterior - cantidadAnterior;

        if (stockNuevo < 0) {
          await client.query('ROLLBACK');

          return res.status(400).json({
            ok: false,
            mensaje:
              'No se puede editar la compra porque el inventario ya fue consumido o vendido',
          });
        }

        await client.query(
          `
          UPDATE inventario_sucursal
          SET
            stock_actual = $1,
            fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_sucursal = $2
            AND id_producto = $3
          `,
          [stockNuevo, compraActual.id_sucursal, item.id_producto]
        );
      }

      const loteActual = await client.query(
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
          compraActual.id_sucursal,
          item.id_producto,
          loteNormalizado,
          item.fecha_caducidad,
        ]
      );

      let idLoteMovimientoReverso = null;

      if (loteActual.rows.length > 0) {
        const stockLoteAnterior = Number(loteActual.rows[0].stock_actual || 0);
        const stockLoteNuevo = stockLoteAnterior - cantidadAnterior;

        if (stockLoteNuevo < 0) {
          await client.query('ROLLBACK');

          return res.status(400).json({
            ok: false,
            mensaje:
              'No se puede editar la compra porque el lote ya fue consumido o vendido',
          });
        }

        idLoteMovimientoReverso = loteActual.rows[0].id_lote;

        await client.query(
          `
          UPDATE inventario_lotes
          SET
            stock_actual = $1,
            activo = CASE WHEN $1::numeric <= 0::numeric THEN false ELSE true END,
            fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_lote = $2
          `,
          [stockLoteNuevo, idLoteMovimientoReverso]
        );
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
        VALUES ($1,$2,$3,$4,'AJUSTE_NEGATIVO',$5,NULL,NULL,$6,$7,$8)
        `,
        [
          compraActual.id_sucursal,
          item.id_producto,
          idLoteMovimientoReverso,
          compraActual.id_proveedor || null,
          cantidadAnterior,
          compraActual.folio,
          `Reverso por edición de compra ${compraActual.folio} | Lote ${loteNormalizado}`,
          req.usuario.id_usuario,
        ]
      );
    }

    await client.query(
      `
      UPDATE compra_detalle
      SET activo = false
      WHERE id_compra = $1
        AND activo = true
      `,
      [id]
    );

    /*
      2. Validar y preparar nuevo detalle.
    */
    let subtotalCompra = 0;
    const productosProcesados = [];

    for (const item of productos) {
      const {
        id_producto,
        cantidad,
        precio_compra,
        descuento: descuentoProducto = 0,
        lote,
        fecha_caducidad,
        ubicacion,
        observaciones: observacionesDetalle,
      } = item;

      if (!id_producto || !cantidad || Number(cantidad) <= 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'Cada producto debe tener id_producto y cantidad mayor a cero',
        });
      }

      if (precio_compra === undefined || Number(precio_compra) < 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'Cada producto debe tener precio de compra válido',
        });
      }

      const productoExiste = await client.query(
        `
        SELECT id_producto, nombre, activo
        FROM productos
        WHERE id_producto = $1
        `,
        [id_producto]
      );

      if (productoExiste.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: `Producto no encontrado: ${id_producto}`,
        });
      }

      if (!productoExiste.rows[0].activo) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `El producto ${productoExiste.rows[0].nombre} está inactivo`,
        });
      }

      const cantidadNum = Number(cantidad);
      const precioCompraNum = redondearMoneda(precio_compra);
      const descuentoProductoNum = redondearMoneda(descuentoProducto || 0);
      const subtotalProducto = redondearMoneda(
        cantidadNum * precioCompraNum - descuentoProductoNum
      );

      if (subtotalProducto < 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `El subtotal del producto ${productoExiste.rows[0].nombre} no puede ser negativo`,
        });
      }

      subtotalCompra = redondearMoneda(subtotalCompra + subtotalProducto);

      productosProcesados.push({
        id_producto,
        producto: productoExiste.rows[0].nombre,
        cantidad: cantidadNum,
        precio_compra: precioCompraNum,
        descuento: descuentoProductoNum,
        subtotal: subtotalProducto,
        lote: normalizarLote(lote),
        fecha_caducidad: fecha_caducidad || null,
        ubicacion: ubicacion?.trim() || null,
        observaciones: observacionesDetalle || null,
      });
    }

    const impuestoNum = redondearMoneda(impuesto || 0);
    const descuentoNum = redondearMoneda(descuento || 0);
    const totalManualNum = redondearMoneda(total_manual || 0);

    const totalCompra = redondearMoneda(
      productosProcesados.length === 0
        ? totalManualNum - descuentoNum + impuestoNum
        : subtotalCompra - descuentoNum + impuestoNum
    );

    if (totalCompra < 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El total de la compra no puede ser negativo',
      });
    }

    const montoPagadoNum = redondearMoneda(monto_pagado || 0);

    if (montoPagadoNum < 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El monto pagado no puede ser negativo',
      });
    }

    const totalCentavos = aCentavos(totalCompra);
    const pagadoCentavos = aCentavos(montoPagadoNum);

    if (pagadoCentavos > totalCentavos) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El monto pagado no puede ser mayor al total de la compra',
      });
    }

    const saldoCentavos = Math.max(totalCentavos - pagadoCentavos, 0);
    const saldo = saldoCentavos / 100;

    let estado = 'PENDIENTE';

    if (pagadoCentavos > 0 && saldoCentavos > 0) {
      estado = 'PARCIAL';
    }

    if (pagadoCentavos > 0 && saldoCentavos === 0) {
      estado = 'PAGADA';
    }

    /*
      3. Actualizar encabezado de compra.
    */
    let updateQuery = `
      UPDATE compras
      SET
        id_sucursal = $1,
        id_proveedor = $2,
        subtotal = $3,
        impuesto = $4,
        descuento = $5,
        total = $6,
        monto_pagado = $7,
        saldo = $8,
        metodo_pago = $9,
        estado = $10,
        id_sesion = $11,
        observaciones = $12
    `;

    const updateParams = [
      id_sucursal,
      id_proveedor,
      subtotalCompra,
      impuestoNum,
      descuentoNum,
      totalCompra,
      montoPagadoNum,
      saldo,
      metodo_pago,
      estado,
      id_sesion,
      observaciones || null,
    ];

    if (ticketProveedorUrl) {
      updateParams.push(ticketProveedorUrl);
      updateQuery += `, ticket_proveedor_url = $${updateParams.length}`;
    }

    updateParams.push(id);

    updateQuery += `
      WHERE id_compra = $${updateParams.length}
      RETURNING *
    `;

    const compraActualizadaResultado = await client.query(
      updateQuery,
      updateParams
    );

    const compraActualizada = compraActualizadaResultado.rows[0];

    /*
      4. Insertar nuevo detalle y aplicar nuevas entradas a inventario/lotes.
    */
    for (const item of productosProcesados) {
      const detalleCompraResultado = await client.query(
        `
        INSERT INTO compra_detalle (
          id_compra,
          id_producto,
          cantidad,
          precio_compra,
          descuento,
          subtotal,
          lote,
          fecha_caducidad,
          observaciones,
          activo
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
        RETURNING *
        `,
        [
          compraActualizada.id_compra,
          item.id_producto,
          item.cantidad,
          item.precio_compra,
          item.descuento,
          item.subtotal,
          item.lote,
          item.fecha_caducidad,
          item.observaciones,
        ]
      );

      const detalleCompra = detalleCompraResultado.rows[0];

      const inventarioActual = await client.query(
        `
        SELECT id_inventario, stock_actual
        FROM inventario_sucursal
        WHERE id_sucursal = $1
          AND id_producto = $2
        FOR UPDATE
        `,
        [id_sucursal, item.id_producto]
      );

      let stockAnterior = 0;
      let stockNuevo = item.cantidad;

      if (inventarioActual.rows.length === 0) {
        await client.query(
          `
    INSERT INTO inventario_sucursal (
      id_sucursal,
      id_producto,
      stock_actual,
      stock_minimo,
      ubicacion
    )
    VALUES ($1,$2,$3,0,$4)
    `,
          [
            id_sucursal,
            item.id_producto,
            item.cantidad,
            item.ubicacion,
          ]
        );
      } else {
        stockAnterior = Number(inventarioActual.rows[0].stock_actual || 0);
        stockNuevo = stockAnterior + item.cantidad;

        await client.query(
          `
    UPDATE inventario_sucursal
    SET
      stock_actual = $1,
      ubicacion = COALESCE(NULLIF($2, ''), ubicacion),
      fecha_actualizacion = CURRENT_TIMESTAMP
    WHERE id_sucursal = $3
      AND id_producto = $4
    `,
          [
            stockNuevo,
            item.ubicacion,
            id_sucursal,
            item.id_producto,
          ]
        );
      }

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
          item.id_producto,
          item.lote,
          item.fecha_caducidad,
        ]
      );

      let idLoteMovimiento = null;

      if (loteExistente.rows.length > 0) {
        const loteActual = loteExistente.rows[0];
        const nuevoStockLote =
          Number(loteActual.stock_actual || 0) + item.cantidad;

        const loteActualizado = await client.query(
          `
          UPDATE inventario_lotes
          SET
            stock_actual = $1,
            precio_compra = $2,
            id_proveedor = $3,
            id_compra = $4,
            id_compra_detalle = $5,
            activo = true,
            fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_lote = $6
          RETURNING *
          `,
          [
            nuevoStockLote,
            item.precio_compra,
            id_proveedor,
            compraActualizada.id_compra,
            detalleCompra.id_detalle,
            loteActual.id_lote,
          ]
        );

        idLoteMovimiento = loteActualizado.rows[0].id_lote;
      } else {
        const loteNuevo = await client.query(
          `
          INSERT INTO inventario_lotes (
            id_sucursal,
            id_producto,
            id_proveedor,
            id_compra,
            id_compra_detalle,
            lote,
            fecha_caducidad,
            stock_actual,
            precio_compra,
            activo
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
          RETURNING *
          `,
          [
            id_sucursal,
            item.id_producto,
            id_proveedor,
            compraActualizada.id_compra,
            detalleCompra.id_detalle,
            item.lote,
            item.fecha_caducidad,
            item.cantidad,
            item.precio_compra,
          ]
        );

        idLoteMovimiento = loteNuevo.rows[0].id_lote;
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
        VALUES ($1,$2,$3,$4,'ENTRADA',$5,$6,$7,$8,$9,$10)
        `,
        [
          id_sucursal,
          item.id_producto,
          idLoteMovimiento,
          id_proveedor,
          item.cantidad,
          stockAnterior,
          stockNuevo,
          compraActualizada.folio,
          `Entrada por edición de compra ${compraActualizada.folio} | Lote ${item.lote} | Proveedor ${proveedorExiste.rows[0].nombre}`,
          req.usuario.id_usuario,
        ]
      );
    }

    /*
      5. Manejar pago si se capturó monto pagado.
      Como solo se editan compras pendientes, normalmente no hay pagos previos.
      Si permites editar monto_pagado aquí, registramos el pago nuevo.
    */
    if (montoPagadoNum > 0) {
      const pagosPrevios = await client.query(
        `
        SELECT COALESCE(SUM(monto), 0)::numeric(12,2) AS total_pagado
        FROM pagos_proveedor
        WHERE id_compra = $1
        `,
        [compraActualizada.id_compra]
      );

      const totalPagadoPrevio = redondearMoneda(
        pagosPrevios.rows[0]?.total_pagado || 0
      );
      const montoNuevoPago = redondearMoneda(
        montoPagadoNum - totalPagadoPrevio
      );

      if (aCentavos(montoNuevoPago) > 0) {
        await client.query(
          `
          INSERT INTO pagos_proveedor (
            id_compra,
            id_proveedor,
            id_sucursal,
            id_sesion,
            id_usuario,
            monto,
            metodo_pago,
            referencia,
            observaciones
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
          [
            compraActualizada.id_compra,
            id_proveedor,
            id_sucursal,
            id_sesion,
            req.usuario.id_usuario,
            montoNuevoPago,
            metodo_pago,
            compraActualizada.folio,
            `Pago registrado al editar compra ${compraActualizada.folio}`,
          ]
        );

        if (metodo_pago === 'EFECTIVO') {
          if (!id_sesion) {
            await client.query('ROLLBACK');

            return res.status(400).json({
              ok: false,
              mensaje:
                'Para pagar en efectivo se requiere una sesión de caja abierta',
            });
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
            VALUES ($1,$2,'PAGO_PROVEEDOR',$3,$4,'EFECTIVO',$5,$6,$7)
            `,
            [
              id_sesion,
              id_sucursal,
              `Pago proveedor compra ${compraActualizada.folio}`,
              montoNuevoPago,
              compraActualizada.folio,
              `Salida por pago a proveedor ${proveedorExiste.rows[0].nombre}`,
              req.usuario.id_usuario,
            ]
          );
        }
      }
    }

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Compra actualizada correctamente',
      compra: {
        ...compraActualizada,
        productos: productosProcesados,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al actualizar compra:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar compra',
    });
  } finally {
    client.release();
  }
};

export const cancelarCompra = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const compraResultado = await client.query(
      `
      SELECT *
      FROM compras
      WHERE id_compra = $1
      FOR UPDATE
      `,
      [id]
    );

    if (compraResultado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        ok: false,
        mensaje: 'Compra no encontrada',
      });
    }

    const compra = compraResultado.rows[0];

    if (compra.estado === 'CANCELADA') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        ok: false,
        mensaje: 'La compra ya está cancelada',
      });
    }

    if (compra.estado === 'PAGADA') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        ok: false,
        mensaje:
          'No puedes cancelar una compra pagada. Primero registra una devolución o ajuste.',
      });
    }

    const detalleResultado = await client.query(
      `
      SELECT
        id_producto,
        cantidad,
        lote,
        fecha_caducidad
      FROM compra_detalle
      WHERE id_compra = $1
        AND activo = true
      `,
      [id]
    );

    for (const item of detalleResultado.rows) {
      const cantidad = Number(item.cantidad || 0);
      const loteNormalizado = normalizarLote(item.lote);

      const inventarioActual = await client.query(
        `
        SELECT id_inventario, stock_actual
        FROM inventario_sucursal
        WHERE id_sucursal = $1
        AND id_producto = $2
        FOR UPDATE
        `,
        [compra.id_sucursal, item.id_producto]
      );

      if (inventarioActual.rows.length > 0) {
        const stockAnterior = Number(inventarioActual.rows[0].stock_actual || 0);
        const stockNuevo = stockAnterior - cantidad;

        if (stockNuevo < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            ok: false,
            mensaje:
              'No se puede cancelar la compra porque parte del inventario ya fue vendido o consumido',
          });
        }

        await client.query(
          `
          UPDATE inventario_sucursal
          SET
            stock_actual = $1,
            fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_sucursal = $2
          AND id_producto = $3
          `,
          [stockNuevo, compra.id_sucursal, item.id_producto]
        );
      }

      const loteActual = await client.query(
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
          compra.id_sucursal,
          item.id_producto,
          loteNormalizado,
          item.fecha_caducidad,
        ]
      );

      let idLoteMovimiento = null;

      if (loteActual.rows.length > 0) {
        const stockLoteAnterior = Number(loteActual.rows[0].stock_actual || 0);
        const stockLoteNuevo = stockLoteAnterior - cantidad;

        if (stockLoteNuevo < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            ok: false,
            mensaje:
              'No se puede cancelar la compra porque parte del lote ya fue vendido o consumido',
          });
        }

        idLoteMovimiento = loteActual.rows[0].id_lote;

        await client.query(
          `
          UPDATE inventario_lotes
          SET
            stock_actual = $1,
            fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_lote = $2
          `,
          [stockLoteNuevo, idLoteMovimiento]
        );
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
        VALUES ($1,$2,$3,'AJUSTE',$4,NULL,NULL,$5,$6,$7)
        `,
        [
          compra.id_sucursal,
          item.id_producto,
          idLoteMovimiento,
          cantidad,
          compra.folio,
          `Reverso por cancelación de compra ${compra.folio} | Lote ${loteNormalizado}`,
          req.usuario.id_usuario,
        ]
      );
    }

    await client.query(
      `
      UPDATE compras
      SET
        estado = 'CANCELADA',
        saldo = 0
      WHERE id_compra = $1
      `,
      [id]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Compra cancelada correctamente',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al cancelar compra:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al cancelar compra',
    });
  } finally {
    client.release();
  }
};