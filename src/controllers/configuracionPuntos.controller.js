import { pool } from '../config/db.js';

const normalizarBooleano = (valor, valorDefault = true) => {
  if (valor === undefined || valor === null) return valorDefault;

  if (typeof valor === 'boolean') return valor;

  if (typeof valor === 'string') {
    const texto = valor.trim().toLowerCase();

    if (['true', '1', 'si', 'sí', 's'].includes(texto)) return true;
    if (['false', '0', 'no', 'n'].includes(texto)) return false;
  }

  return Boolean(valor);
};

const normalizarPorcentaje = (valor, nombreCampo) => {
  const numero = Number(valor);

  if (Number.isNaN(numero)) {
    throw new Error(`${nombreCampo} debe ser un número válido`);
  }

  if (numero < 0) {
    throw new Error(`${nombreCampo} no puede ser negativo`);
  }

  if (numero > 100) {
    throw new Error(`${nombreCampo} no puede ser mayor a 100`);
  }

  return Number(numero.toFixed(2));
};

const normalizarPuntos = (valor, nombreCampo) => {
  const numero = Number(valor);

  if (Number.isNaN(numero)) {
    throw new Error(`${nombreCampo} debe ser un número válido`);
  }

  if (numero < 0) {
    throw new Error(`${nombreCampo} no puede ser negativo`);
  }

  return Number(numero.toFixed(2));
};

const obtenerConfiguracionActualInterna = async () => {
  const resultado = await pool.query(
    `
    SELECT
      id_configuracion,
      porcentaje_cliente,
      porcentaje_cajero,
      puntos_cliente_activo,
      puntos_cajero_activo,
      puntos_doctor_receta,
      puntos_doctor_activo,
      fecha_actualizacion,
      id_usuario_actualizacion
    FROM configuracion_puntos
    ORDER BY id_configuracion DESC
    LIMIT 1
    `
  );

  if (resultado.rows.length > 0) {
    return resultado.rows[0];
  }

  const creada = await pool.query(
    `
    INSERT INTO configuracion_puntos (
      porcentaje_cliente,
      porcentaje_cajero,
      puntos_cliente_activo,
      puntos_cajero_activo,
      puntos_doctor_receta,
      puntos_doctor_activo
    )
    VALUES (1.00, 0.50, true, true, 1.00, true)
    RETURNING *
    `
  );

  return creada.rows[0];
};

export const obtenerConfiguracionPuntos = async (req, res) => {
  try {
    const configuracion = await obtenerConfiguracionActualInterna();

    return res.json({
      ok: true,
      configuracion,
    });
  } catch (error) {
    console.error('Error al obtener configuración de puntos:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener configuración de puntos',
    });
  }
};

export const actualizarConfiguracionPuntos = async (req, res) => {
  try {
    const {
      porcentaje_cliente,
      porcentaje_cajero,
      puntos_cliente_activo,
      puntos_cajero_activo,
      puntos_doctor_receta,
      puntos_doctor_activo,
    } = req.body;

    const configuracionActual = await obtenerConfiguracionActualInterna();

    const porcentajeCliente =
      porcentaje_cliente === undefined ||
      porcentaje_cliente === null ||
      porcentaje_cliente === ''
        ? Number(configuracionActual.porcentaje_cliente)
        : normalizarPorcentaje(
            porcentaje_cliente,
            'El porcentaje del cliente'
          );

    const porcentajeCajero =
      porcentaje_cajero === undefined ||
      porcentaje_cajero === null ||
      porcentaje_cajero === ''
        ? Number(configuracionActual.porcentaje_cajero)
        : normalizarPorcentaje(
            porcentaje_cajero,
            'El porcentaje del cajero'
          );

    const puntosDoctorReceta =
      puntos_doctor_receta === undefined ||
      puntos_doctor_receta === null ||
      puntos_doctor_receta === ''
        ? Number(configuracionActual.puntos_doctor_receta || 1)
        : normalizarPuntos(
            puntos_doctor_receta,
            'Los puntos del doctor por receta'
          );

    const puntosClienteActivo = normalizarBooleano(
      puntos_cliente_activo,
      configuracionActual.puntos_cliente_activo
    );

    const puntosCajeroActivo = normalizarBooleano(
      puntos_cajero_activo,
      configuracionActual.puntos_cajero_activo
    );

    const puntosDoctorActivo = normalizarBooleano(
      puntos_doctor_activo,
      configuracionActual.puntos_doctor_activo
    );

    const resultado = await pool.query(
      `
      UPDATE configuracion_puntos
      SET
        porcentaje_cliente = $1,
        porcentaje_cajero = $2,
        puntos_cliente_activo = $3,
        puntos_cajero_activo = $4,
        puntos_doctor_receta = $5,
        puntos_doctor_activo = $6,
        fecha_actualizacion = CURRENT_TIMESTAMP,
        id_usuario_actualizacion = $7
      WHERE id_configuracion = $8
      RETURNING *
      `,
      [
        porcentajeCliente,
        porcentajeCajero,
        puntosClienteActivo,
        puntosCajeroActivo,
        puntosDoctorReceta,
        puntosDoctorActivo,
        req.usuario?.id_usuario || null,
        configuracionActual.id_configuracion,
      ]
    );

    return res.json({
      ok: true,
      mensaje: 'Configuración de puntos actualizada correctamente',
      configuracion: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar configuración de puntos:', error);

    return res.status(400).json({
      ok: false,
      mensaje:
        error.message ||
        'No se pudo actualizar la configuración de puntos',
    });
  }
};

export const obtenerSaldoPuntosCajero = async (req, res) => {
  try {
    const { id_usuario } = req.params;

    if (!id_usuario) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El id del usuario es obligatorio',
      });
    }

    const usuarioResultado = await pool.query(
      `
      SELECT
        u.id_usuario,
        u.nombre,
        u.usuario,
        r.nombre AS rol,
        u.activo
      FROM usuarios u
      LEFT JOIN roles r ON r.id_rol = u.id_rol
      WHERE u.id_usuario = $1
      `,
      [id_usuario]
    );

    if (usuarioResultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'El usuario no existe',
      });
    }

    const saldoResultado = await pool.query(
      `
      SELECT
        COALESCE(SUM(puntos), 0)::numeric(12,2) AS saldo_puntos,
        COUNT(*)::int AS total_movimientos
      FROM cajeros_puntos_movimientos
      WHERE id_usuario = $1
      `,
      [id_usuario]
    );

    return res.json({
      ok: true,
      usuario: usuarioResultado.rows[0],
      saldo: saldoResultado.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener saldo de puntos del cajero:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener saldo de puntos del cajero',
    });
  }
};

export const listarMovimientosPuntosCajero = async (req, res) => {
  try {
    const {
      id_usuario,
      fecha_inicio,
      fecha_fin,
      limite = 100,
    } = req.query;

    let query = `
      SELECT
        m.id_movimiento,
        m.id_usuario,
        u.nombre AS cajero,
        u.usuario,
        r.nombre AS rol,
        m.id_venta,
        v.folio,
        m.tipo_movimiento,
        m.puntos,
        m.porcentaje_aplicado,
        m.monto_base,
        m.descripcion,
        m.fecha_movimiento
      FROM cajeros_puntos_movimientos m
      INNER JOIN usuarios u ON u.id_usuario = m.id_usuario
      LEFT JOIN roles r ON r.id_rol = u.id_rol
      LEFT JOIN ventas v ON v.id_venta = m.id_venta
      WHERE 1 = 1
    `;

    const params = [];

    if (id_usuario) {
      params.push(id_usuario);
      query += ` AND m.id_usuario = $${params.length} `;
    }

    if (fecha_inicio) {
      params.push(fecha_inicio);
      query += ` AND m.fecha_movimiento::date >= $${params.length}::date `;
    }

    if (fecha_fin) {
      params.push(fecha_fin);
      query += ` AND m.fecha_movimiento::date <= $${params.length}::date `;
    }

    const limiteNumerico = Math.min(Number(limite) || 100, 500);

    params.push(limiteNumerico);

    query += `
      ORDER BY m.fecha_movimiento DESC
      LIMIT $${params.length}
    `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      movimientos: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar movimientos de puntos de cajeros:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar movimientos de puntos de cajeros',
    });
  }
};

export const listarResumenPuntosCajeros = async (req, res) => {
  try {
    const resultado = await pool.query(
      `
      SELECT
        u.id_usuario,
        u.nombre,
        u.usuario,
        r.nombre AS rol,
        u.activo,
        COALESCE(SUM(m.puntos), 0)::numeric(12,2) AS saldo_puntos,
        COUNT(m.id_movimiento)::int AS total_movimientos,
        MAX(m.fecha_movimiento) AS ultimo_movimiento
      FROM usuarios u
      LEFT JOIN roles r ON r.id_rol = u.id_rol
      LEFT JOIN cajeros_puntos_movimientos m
        ON m.id_usuario = u.id_usuario
      WHERE u.activo = true
      GROUP BY
        u.id_usuario,
        u.nombre,
        u.usuario,
        r.nombre,
        u.activo
      ORDER BY saldo_puntos DESC, u.nombre ASC
      `
    );

    return res.json({
      ok: true,
      cajeros: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar resumen de puntos de cajeros:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar resumen de puntos de cajeros',
    });
  }
};

export const canjearPuntosCajero = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_usuario } = req.params;
    const { descripcion } = req.body;

    if (!id_usuario) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El id del usuario es obligatorio',
      });
    }

    await client.query('BEGIN');

    const usuarioResultado = await client.query(
      `
      SELECT
        id_usuario,
        nombre,
        usuario,
        activo
      FROM usuarios
      WHERE id_usuario = $1
      FOR UPDATE
      `,
      [id_usuario]
    );

    if (usuarioResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'El usuario no existe',
      });
    }

    const saldoResultado = await client.query(
      `
      SELECT
        COALESCE(SUM(puntos), 0)::numeric(12,2) AS saldo_puntos
      FROM cajeros_puntos_movimientos
      WHERE id_usuario = $1
      `,
      [id_usuario]
    );

    const saldoActual = Number(saldoResultado.rows[0]?.saldo_puntos || 0);

    if (saldoActual <= 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El cajero no tiene puntos disponibles para canjear',
        saldo_puntos: saldoActual,
      });
    }

    const movimientoResultado = await client.query(
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
      VALUES ($1, NULL, 'CANJE', $2, NULL, NULL, $3)
      RETURNING *
      `,
      [
        id_usuario,
        saldoActual * -1,
        descripcion || `Canje/reinicio de ${saldoActual} puntos del cajero`,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Puntos del cajero canjeados correctamente',
      usuario: usuarioResultado.rows[0],
      puntos_canjeados: saldoActual,
      movimiento: movimientoResultado.rows[0],
      saldo_nuevo: 0,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al canjear puntos del cajero:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al canjear puntos del cajero',
    });
  } finally {
    client.release();
  }
};

export const listarResumenPuntosDoctores = async (req, res) => {
  try {
    const resultado = await pool.query(
      `
      SELECT
        dp.id_doctor,
        dp.id_usuario,
        u.nombre,
        u.usuario,
        r.nombre AS rol,
        u.activo,

        dp.nombre_completo,
        dp.cedula_profesional,
        dp.especialidad,
        dp.puntos_actuales,
        dp.puntos_acumulados,
        dp.puntos_canjeados,

        COUNT(dr.id_receta) FILTER (WHERE dr.activo = true)::int AS total_recetas,
        COUNT(dr.id_receta) FILTER (
          WHERE dr.activo = true AND dr.estatus = 'PENDIENTE'
        )::int AS recetas_pendientes,
        COUNT(dr.id_receta) FILTER (
          WHERE dr.activo = true AND dr.estatus = 'ATENDIDA'
        )::int AS recetas_atendidas,
        COUNT(dr.id_receta) FILTER (
          WHERE dr.activo = true AND dr.estatus = 'RECHAZADA'
        )::int AS recetas_rechazadas,

        MAX(dr.fecha_validacion) AS ultima_validacion
      FROM doctores_perfiles dp
      INNER JOIN usuarios u
        ON u.id_usuario = dp.id_usuario
      LEFT JOIN roles r
        ON r.id_rol = u.id_rol
      LEFT JOIN doctores_recetas dr
        ON dr.id_doctor = dp.id_doctor
      WHERE dp.activo = true
      GROUP BY
        dp.id_doctor,
        dp.id_usuario,
        u.nombre,
        u.usuario,
        r.nombre,
        u.activo,
        dp.nombre_completo,
        dp.cedula_profesional,
        dp.especialidad,
        dp.puntos_actuales,
        dp.puntos_acumulados,
        dp.puntos_canjeados
      ORDER BY dp.puntos_actuales DESC, dp.nombre_completo ASC
      `
    );

    return res.json({
      ok: true,
      doctores: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar resumen de puntos de doctores:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar resumen de puntos de doctores',
    });
  }
}; 

export const canjearPuntosDoctor = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_doctor } = req.params;
    const { descripcion } = req.body;

    if (!id_doctor) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El id del doctor es obligatorio',
      });
    }

    await client.query('BEGIN');

    const doctorResultado = await client.query(
      `
      SELECT
        dp.id_doctor,
        dp.id_usuario,
        dp.nombre_completo,
        dp.cedula_profesional,
        dp.puntos_actuales,
        dp.puntos_acumulados,
        dp.puntos_canjeados,
        dp.activo,
        u.usuario
      FROM doctores_perfiles dp
      INNER JOIN usuarios u
        ON u.id_usuario = dp.id_usuario
      WHERE dp.id_doctor = $1
      FOR UPDATE
      `,
      [id_doctor]
    );

    if (doctorResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'El doctor no existe',
      });
    }

    const doctor = doctorResultado.rows[0];
    const saldoActual = Number(doctor.puntos_actuales || 0);

    if (saldoActual <= 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El doctor no tiene puntos disponibles para canjear',
        saldo_puntos: saldoActual,
      });
    }

    const movimientoResultado = await client.query(
      `
      INSERT INTO doctores_puntos_movimientos (
        id_doctor,
        id_usuario,
        id_receta,
        tipo_movimiento,
        puntos,
        descripcion
      )
      VALUES ($1, $2, NULL, 'CANJE', $3, $4)
      RETURNING *
      `,
      [
        doctor.id_doctor,
        doctor.id_usuario,
        saldoActual * -1,
        descripcion ||
          `Canje/reinicio de ${saldoActual} puntos del doctor ${doctor.nombre_completo || doctor.usuario}`,
      ]
    );

    const doctorActualizadoResultado = await client.query(
      `
      UPDATE doctores_perfiles
      SET
        puntos_actuales = 0,
        puntos_canjeados = COALESCE(puntos_canjeados, 0) + $1,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_doctor = $2
      RETURNING
        id_doctor,
        id_usuario,
        nombre_completo,
        cedula_profesional,
        puntos_actuales,
        puntos_acumulados,
        puntos_canjeados
      `,
      [saldoActual, doctor.id_doctor]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Puntos del doctor canjeados correctamente',
      doctor: doctorActualizadoResultado.rows[0],
      puntos_canjeados: saldoActual,
      movimiento: movimientoResultado.rows[0],
      saldo_nuevo: 0,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al canjear puntos del doctor:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al canjear puntos del doctor',
    });
  } finally {
    client.release();
  }
};


// =====================================================
// DOCTORES SHADDAI - RESUMEN DE PUNTOS
// =====================================================
export const listarResumenDoctoresShaddai = async (req, res) => {
  try {
    const query = `
      SELECT
        d.id_perfil AS id_doctor,
        d.id_usuario,
        d.nombre_completo,
        d.cedula_profesional,
        d.especialidad,
        d.telefono,
        d.correo,
        d.direccion_consultorio,
        d.observaciones,
        d.perfil_completo,
        d.activo,
        COALESCE(d.porcentaje_puntos_venta, 0) AS porcentaje_puntos_venta,
        COALESCE(d.puntos_activo, true) AS puntos_activo,
        u.usuario,

        COALESCE(SUM(m.puntos), 0) AS puntos_actuales,

        COALESCE(SUM(
          CASE
            WHEN m.tipo_movimiento <> 'CANJE'
              THEN ABS(m.puntos)
            ELSE 0
          END
        ), 0) AS puntos_acumulados,

        COALESCE(SUM(
          CASE
            WHEN m.tipo_movimiento = 'CANJE'
              THEN ABS(m.puntos)
            ELSE 0
          END
        ), 0) AS puntos_canjeados,

        COUNT(DISTINCT m.id_venta) AS ventas_referidas,

        MAX(m.fecha_movimiento) AS ultimo_movimiento

      FROM doctores_shaddai_perfiles d

      LEFT JOIN usuarios u 
        ON u.id_usuario = d.id_usuario

      LEFT JOIN doctores_puntos_movimientos m 
        ON m.id_doctor = d.id_perfil
        AND COALESCE(m.origen_doctor, 'EXTERNO') = 'SHADDAI'

      GROUP BY
        d.id_perfil,
        d.id_usuario,
        d.nombre_completo,
        d.cedula_profesional,
        d.especialidad,
        d.telefono,
        d.correo,
        d.direccion_consultorio,
        d.observaciones,
        d.perfil_completo,
        d.activo,
        d.porcentaje_puntos_venta,
        d.puntos_activo,
        u.usuario

      ORDER BY d.nombre_completo ASC;
    `;

    const { rows } = await pool.query(query);

    return res.json({
      ok: true,
      doctores: rows,
    });
  } catch (error) {
    console.error('Error al listar resumen de doctores Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudo obtener el resumen de puntos de doctores Shaddai.',
      error: error.message,
    });
  }
};


// =====================================================
// DOCTORES SHADDAI - ACTUALIZAR PORCENTAJE INDIVIDUAL
// =====================================================
export const actualizarPorcentajeDoctorShaddai = async (req, res) => {
  try {
    const { id_doctor } = req.params;
    const { porcentaje_puntos_venta, puntos_activo } = req.body;

    const porcentaje = Number(porcentaje_puntos_venta || 0);

    if (!id_doctor) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El ID del doctor es obligatorio.',
      });
    }

    if (Number.isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El porcentaje debe estar entre 0 y 100.',
      });
    }

    const existeDoctor = await pool.query(
      `
      SELECT id_perfil
      FROM doctores_shaddai_perfiles
      WHERE id_perfil = $1
      LIMIT 1
      `,
      [id_doctor]
    );

    if (existeDoctor.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró el doctor Shaddai.',
      });
    }

    const activo =
      puntos_activo === true ||
      puntos_activo === 'true' ||
      puntos_activo === 1 ||
      puntos_activo === '1';

    const { rows } = await pool.query(
      `
      UPDATE doctores_shaddai_perfiles
      SET
        porcentaje_puntos_venta = $1,
        puntos_activo = $2,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_perfil = $3
      RETURNING
        id_perfil AS id_doctor,
        id_usuario,
        nombre_completo,
        cedula_profesional,
        especialidad,
        telefono,
        correo,
        direccion_consultorio,
        observaciones,
        perfil_completo,
        activo,
        porcentaje_puntos_venta,
        puntos_activo,
        fecha_actualizacion
      `,
      [porcentaje, activo, id_doctor]
    );

    return res.json({
      ok: true,
      mensaje: 'Porcentaje actualizado correctamente.',
      doctor: rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar porcentaje del doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudo actualizar el porcentaje del doctor Shaddai.',
      error: error.message,
    });
  }
};

// =====================================================
// DOCTORES SHADDAI - CANJEAR PUNTOS
// =====================================================
export const canjearPuntosDoctorShaddai = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_doctor } = req.params;
    const { descripcion } = req.body;

    if (!id_doctor) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El ID del doctor es obligatorio.',
      });
    }

    await client.query('BEGIN');

    const doctorResult = await client.query(
      `
      SELECT
        id_perfil AS id_doctor,
        id_usuario,
        nombre_completo
      FROM doctores_shaddai_perfiles
      WHERE id_perfil = $1
      LIMIT 1
      `,
      [id_doctor]
    );

    if (doctorResult.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró el doctor Shaddai.',
      });
    }

    const doctor = doctorResult.rows[0];

    const saldoResult = await client.query(
      `
      SELECT
        COALESCE(SUM(puntos), 0) AS saldo
      FROM doctores_puntos_movimientos
      WHERE id_doctor = $1
        AND COALESCE(origen_doctor, 'EXTERNO') = 'SHADDAI'
      `,
      [id_doctor]
    );

    const saldo = Number(saldoResult.rows[0]?.saldo || 0);

    if (saldo <= 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'Este doctor Shaddai no tiene puntos disponibles para canjear.',
      });
    }

    const idUsuarioMovimiento =
      req.usuario?.id_usuario ||
      req.user?.id_usuario ||
      doctor.id_usuario;

    await client.query(
      `
      INSERT INTO doctores_puntos_movimientos (
        id_doctor,
        id_usuario,
        id_receta,
        id_venta,
        origen_doctor,
        tipo_movimiento,
        puntos,
        descripcion,
        fecha_movimiento
      )
      VALUES (
        $1,
        $2,
        NULL,
        NULL,
        'SHADDAI',
        'CANJE',
        $3,
        $4,
        CURRENT_TIMESTAMP
      )
      `,
      [
        id_doctor,
        idUsuarioMovimiento,
        saldo * -1,
        descripcion ||
          `Canje de puntos del doctor Shaddai ${doctor.nombre_completo || id_doctor}`,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Puntos canjeados correctamente.',
      puntos_canjeados: saldo,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al canjear puntos del doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudieron canjear los puntos del doctor Shaddai.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};