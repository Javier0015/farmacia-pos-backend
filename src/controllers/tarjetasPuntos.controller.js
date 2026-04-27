import { pool } from '../config/db.js';

const generarCodigoTarjeta = () => {
  const fecha = new Date();

  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');

  const random = Math.floor(100000 + Math.random() * 900000);

  return `TP${yyyy}${mm}${dd}${random}`;
};

export const listarTarjetas = async (req, res) => {
  try {
    const { buscar, activos } = req.query;

    let query = `
      SELECT
        id_tarjeta,
        codigo_barras,
        nombre_cliente,
        telefono,
        correo,
        puntos_actuales,
        puntos_acumulados,
        puntos_canjeados,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM tarjetas_puntos
      WHERE 1 = 1
    `;

    const params = [];

    if (buscar) {
      params.push(`%${buscar.trim()}%`);

      query += `
        AND (
          codigo_barras ILIKE $${params.length}
          OR nombre_cliente ILIKE $${params.length}
          OR telefono ILIKE $${params.length}
          OR correo ILIKE $${params.length}
        )
      `;
    }

    if (activos === 'true') {
      query += ` AND activo = true `;
    }

    query += `
      ORDER BY fecha_creacion DESC
    `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      tarjetas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar tarjetas:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar tarjetas',
    });
  }
};

export const obtenerTarjetaPorCodigo = async (req, res) => {
  try {
    const { codigo } = req.params;

    const valorBusqueda = codigo?.trim();

    if (!valorBusqueda) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Debes ingresar un código de tarjeta o teléfono',
      });
    }

    const telefonoLimpio = valorBusqueda.replace(/\D/g, '');

    const resultado = await pool.query(
      `
      SELECT
        id_tarjeta,
        codigo_barras,
        nombre_cliente,
        telefono,
        correo,
        puntos_actuales,
        puntos_acumulados,
        puntos_canjeados,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM tarjetas_puntos
      WHERE codigo_barras = $1
      OR telefono = $1
      OR regexp_replace(COALESCE(telefono, ''), '[^0-9]', '', 'g') = $2
      LIMIT 1
      `,
      [valorBusqueda, telefonoLimpio]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Tarjeta no encontrada por código o teléfono',
      });
    }

    return res.json({
      ok: true,
      tarjeta: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener tarjeta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener tarjeta',
    });
  }
};

export const crearTarjeta = async (req, res) => {
  try {
    const {
      codigo_barras,
      nombre_cliente,
      telefono,
      correo,
      puntos_iniciales,
    } = req.body;

    if (!nombre_cliente || !nombre_cliente.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del cliente es obligatorio',
      });
    }

    if (correo && correo.trim()) {
      const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);

      if (!correoValido) {
        return res.status(400).json({
          ok: false,
          mensaje: 'El correo electrónico no es válido',
        });
      }
    }

    const codigoFinal = codigo_barras?.trim() || generarCodigoTarjeta();

    const existeCodigo = await pool.query(
      `
      SELECT id_tarjeta
      FROM tarjetas_puntos
      WHERE codigo_barras = $1
      `,
      [codigoFinal]
    );

    if (existeCodigo.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe una tarjeta con ese código de barras',
      });
    }

    const puntosIniciales = Number(puntos_iniciales || 0);

    if (puntosIniciales < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Los puntos iniciales no pueden ser negativos',
      });
    }

    const resultado = await pool.query(
      `
      INSERT INTO tarjetas_puntos (
        codigo_barras,
        nombre_cliente,
        telefono,
        correo,
        puntos_actuales,
        puntos_acumulados,
        puntos_canjeados,
        activo,
        fecha_creacion,
        fecha_actualizacion
      )
      VALUES ($1,$2,$3,$4,$5,$5,0,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      RETURNING
        id_tarjeta,
        codigo_barras,
        nombre_cliente,
        telefono,
        correo,
        puntos_actuales,
        puntos_acumulados,
        puntos_canjeados,
        activo,
        fecha_creacion
      `,
      [
        codigoFinal,
        nombre_cliente.trim(),
        telefono?.trim() || null,
        correo?.trim() || null,
        puntosIniciales,
      ]
    );

    const tarjeta = resultado.rows[0];

    if (puntosIniciales > 0) {
      await pool.query(
        `
        INSERT INTO tarjetas_puntos_movimientos (
          id_tarjeta,
          id_usuario,
          tipo_movimiento,
          puntos,
          puntos_anteriores,
          puntos_nuevos,
          descripcion
        )
        VALUES ($1,$2,'ALTA_INICIAL',$3,0,$3,'Puntos iniciales al crear tarjeta')
        `,
        [
          tarjeta.id_tarjeta,
          req.usuario?.id_usuario || null,
          puntosIniciales,
        ]
      );
    }

    return res.status(201).json({
      ok: true,
      mensaje: 'Tarjeta creada correctamente',
      tarjeta,
    });
  } catch (error) {
    console.error('Error al crear tarjeta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear tarjeta',
    });
  }
};

export const actualizarTarjeta = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      codigo_barras,
      nombre_cliente,
      telefono,
      correo,
      activo,
    } = req.body;

    if (!codigo_barras || !codigo_barras.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El código de barras es obligatorio',
      });
    }

    if (!nombre_cliente || !nombre_cliente.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del cliente es obligatorio',
      });
    }

    const duplicado = await pool.query(
      `
      SELECT id_tarjeta
      FROM tarjetas_puntos
      WHERE codigo_barras = $1
      AND id_tarjeta <> $2
      `,
      [codigo_barras.trim(), id]
    );

    if (duplicado.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe otra tarjeta con ese código de barras',
      });
    }

    const resultado = await pool.query(
      `
      UPDATE tarjetas_puntos
      SET
        codigo_barras = $1,
        nombre_cliente = $2,
        telefono = $3,
        correo = $4,
        activo = $5,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_tarjeta = $6
      RETURNING
        id_tarjeta,
        codigo_barras,
        nombre_cliente,
        telefono,
        correo,
        puntos_actuales,
        puntos_acumulados,
        puntos_canjeados,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        codigo_barras.trim(),
        nombre_cliente.trim(),
        telefono?.trim() || null,
        correo?.trim() || null,
        activo !== undefined ? Boolean(activo) : true,
        id,
      ]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Tarjeta no encontrada',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Tarjeta actualizada correctamente',
      tarjeta: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar tarjeta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar tarjeta',
    });
  }
};

export const desactivarTarjeta = async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      UPDATE tarjetas_puntos
      SET
        activo = false,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_tarjeta = $1
      RETURNING
        id_tarjeta,
        codigo_barras,
        nombre_cliente,
        activo
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Tarjeta no encontrada',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Tarjeta desactivada correctamente',
      tarjeta: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al desactivar tarjeta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al desactivar tarjeta',
    });
  }
};

export const listarMovimientosTarjeta = async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      SELECT
        m.id_movimiento,
        m.id_tarjeta,
        m.id_venta,
        v.folio AS folio_venta,
        m.tipo_movimiento,
        m.puntos,
        m.puntos_anteriores,
        m.puntos_nuevos,
        m.descripcion,
        m.fecha_movimiento,
        u.nombre AS usuario
      FROM tarjetas_puntos_movimientos m
      LEFT JOIN ventas v ON v.id_venta = m.id_venta
      LEFT JOIN usuarios u ON u.id_usuario = m.id_usuario
      WHERE m.id_tarjeta = $1
      ORDER BY m.fecha_movimiento DESC
      `,
      [id]
    );

    return res.json({
      ok: true,
      movimientos: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar movimientos tarjeta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar movimientos',
    });
  }
};