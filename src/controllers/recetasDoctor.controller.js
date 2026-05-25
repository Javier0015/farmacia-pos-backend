import { pool } from '../config/db.js';

const esDoctor = (usuario) => {
  return String(usuario?.rol || '').toUpperCase() === 'DOCTOR';
};

const esUsuarioValidadorRecetas = (usuario) => {
  const rol = String(usuario?.rol || '').toUpperCase();

  return [
    'SUPER_ADMIN',
    'ADMIN_GENERAL',
    'ADMIN_SUCURSAL',
    'CAJERO',
  ].includes(rol);
};

const esValorActivo = (valor) => {
  return valor === true || valor === 'true' || valor === 1 || valor === '1';
};

const obtenerPerfilDoctorPorUsuario = async (client, idUsuario) => {
  const resultado = await client.query(
    `
    SELECT
      id_doctor,
      id_usuario,
      nombre_completo,
      cedula_profesional,
      perfil_completo,
      activo,
      puntos_actuales,
      puntos_acumulados,
      puntos_canjeados
    FROM doctores_perfiles
    WHERE id_usuario = $1
    LIMIT 1
    `,
    [idUsuario]
  );

  return resultado.rows[0] || null;
};

const obtenerPuntosDoctor = async (client, idDoctor) => {
  const resultado = await client.query(
    `
    SELECT
      puntos_actuales,
      puntos_acumulados,
      puntos_canjeados
    FROM doctores_perfiles
    WHERE id_doctor = $1
    LIMIT 1
    `,
    [idDoctor]
  );

  return (
    resultado.rows[0] || {
      puntos_actuales: 0,
      puntos_acumulados: 0,
      puntos_canjeados: 0,
    }
  );
};

const obtenerConfiguracionPuntosDoctor = async (client) => {
  const resultado = await client.query(
    `
    SELECT
      puntos_doctor_receta,
      puntos_doctor_activo
    FROM configuracion_puntos
    ORDER BY id_configuracion DESC
    LIMIT 1
    `
  );

  if (resultado.rows.length === 0) {
    return {
      puntos_doctor_receta: 1,
      puntos_doctor_activo: true,
    };
  }

  return resultado.rows[0];
};

const redondearDos = (valor) => {
  return Number(Number(valor || 0).toFixed(2));
};

export const subirRecetaDoctor = async (req, res) => {
  const client = await pool.connect();

  try {
    if (!esDoctor(req.usuario)) {
      return res.status(403).json({
        ok: false,
        mensaje: 'Solo los doctores pueden subir recetas',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Debes subir una imagen o PDF de la receta',
      });
    }

    const { titulo, descripcion } = req.body;

    await client.query('BEGIN');

    const doctor = await obtenerPerfilDoctorPorUsuario(
      client,
      req.usuario.id_usuario
    );

    if (!doctor) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró el perfil del doctor',
      });
    }

    if (!doctor.activo) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El perfil del doctor está inactivo',
      });
    }

    if (!doctor.perfil_completo) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'Debes completar tu perfil médico antes de subir recetas',
      });
    }

    const archivoRuta = `/uploads/recetas_doctores/${req.file.filename}`;

    const recetaResultado = await client.query(
      `
      INSERT INTO doctores_recetas (
        id_doctor,
        id_usuario,
        titulo,
        descripcion,
        archivo_nombre,
        archivo_ruta,
        archivo_tipo,
        archivo_tamano,
        puntos_generados,
        estatus
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,'PENDIENTE')
      RETURNING *
      `,
      [
        doctor.id_doctor,
        req.usuario.id_usuario,
        titulo ? titulo.trim() : null,
        descripcion ? descripcion.trim() : null,
        req.file.originalname,
        archivoRuta,
        req.file.mimetype,
        req.file.size,
      ]
    );

    const receta = recetaResultado.rows[0];

    const puntos = await obtenerPuntosDoctor(client, doctor.id_doctor);

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Receta subida correctamente. Quedó pendiente de validación.',
      receta,
      puntos_generados: 0,
      puntos,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al subir receta del doctor:', error);

    return res.status(500).json({
      ok: false,
      mensaje: error.message || 'Error interno al subir receta',
    });
  } finally {
    client.release();
  }
};

export const listarMisRecetasDoctor = async (req, res) => {
  try {
    if (!esDoctor(req.usuario)) {
      return res.status(403).json({
        ok: false,
        mensaje: 'Solo los doctores pueden consultar sus recetas',
      });
    }

    const doctorResultado = await pool.query(
      `
      SELECT
        id_doctor,
        puntos_actuales,
        puntos_acumulados,
        puntos_canjeados
      FROM doctores_perfiles
      WHERE id_usuario = $1
      LIMIT 1
      `,
      [req.usuario.id_usuario]
    );

    if (doctorResultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró el perfil del doctor',
      });
    }

    const doctor = doctorResultado.rows[0];

    const recetasResultado = await pool.query(
      `
      SELECT
        dr.id_receta,
        dr.id_doctor,
        dr.id_usuario,
        dr.titulo,
        dr.descripcion,
        dr.archivo_nombre,
        dr.archivo_ruta,
        dr.archivo_tipo,
        dr.archivo_tamano,
        dr.puntos_generados,
        dr.estatus,
        dr.id_usuario_validador,
        uv.nombre AS usuario_validador,
        dr.fecha_validacion,
        dr.observaciones_validacion,
        dr.activo,
        dr.fecha_creacion
      FROM doctores_recetas dr
      LEFT JOIN usuarios uv
        ON uv.id_usuario = dr.id_usuario_validador
      WHERE dr.id_doctor = $1
        AND dr.activo = true
      ORDER BY dr.fecha_creacion DESC
      `,
      [doctor.id_doctor]
    );

    return res.json({
      ok: true,
      puntos: {
        puntos_actuales: doctor.puntos_actuales,
        puntos_acumulados: doctor.puntos_acumulados,
        puntos_canjeados: doctor.puntos_canjeados,
      },
      recetas: recetasResultado.rows,
    });
  } catch (error) {
    console.error('Error al listar recetas del doctor:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar recetas',
    });
  }
};

export const obtenerResumenPuntosDoctor = async (req, res) => {
  try {
    if (!esDoctor(req.usuario)) {
      return res.status(403).json({
        ok: false,
        mensaje: 'Solo los doctores pueden consultar sus puntos',
      });
    }

    const resultado = await pool.query(
      `
      SELECT
        dp.id_doctor,
        dp.nombre_completo,
        dp.cedula_profesional,
        dp.puntos_actuales,
        dp.puntos_acumulados,
        dp.puntos_canjeados,
        COUNT(dr.id_receta)::int AS total_recetas,
        COUNT(dr.id_receta) FILTER (WHERE dr.estatus = 'PENDIENTE')::int AS recetas_pendientes,
        COUNT(dr.id_receta) FILTER (WHERE dr.estatus = 'ATENDIDA')::int AS recetas_atendidas,
        COUNT(dr.id_receta) FILTER (WHERE dr.estatus = 'RECHAZADA')::int AS recetas_rechazadas
      FROM doctores_perfiles dp
      LEFT JOIN doctores_recetas dr
        ON dr.id_doctor = dp.id_doctor
        AND dr.activo = true
      WHERE dp.id_usuario = $1
      GROUP BY
        dp.id_doctor,
        dp.nombre_completo,
        dp.cedula_profesional,
        dp.puntos_actuales,
        dp.puntos_acumulados,
        dp.puntos_canjeados
      LIMIT 1
      `,
      [req.usuario.id_usuario]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró el perfil del doctor',
      });
    }

    return res.json({
      ok: true,
      resumen: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener puntos del doctor:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener puntos del doctor',
    });
  }
};

export const listarTodasRecetasDoctor = async (req, res) => {
  try {
    if (!esUsuarioValidadorRecetas(req.usuario)) {
      return res.status(403).json({
        ok: false,
        mensaje: 'No tienes permiso para consultar recetas de doctores',
      });
    }

    const { buscar, estatus } = req.query;

    let query = `
      SELECT
        dr.id_receta,
        dr.id_doctor,
        dr.id_usuario,
        u.nombre AS usuario_doctor,
        u.usuario AS usuario_acceso_doctor,

        dp.nombre_completo AS doctor_nombre_completo,
        dp.cedula_profesional AS doctor_cedula_profesional,
        dp.especialidad AS doctor_especialidad,
        dp.telefono AS doctor_telefono,
        dp.correo AS doctor_correo,

        dr.titulo,
        dr.descripcion,
        dr.archivo_nombre,
        dr.archivo_ruta,
        dr.archivo_tipo,
        dr.archivo_tamano,
        dr.puntos_generados,
        dr.estatus,
        dr.id_usuario_validador,
        uv.nombre AS usuario_validador,
        dr.fecha_validacion,
        dr.observaciones_validacion,
        dr.activo,
        dr.fecha_creacion
      FROM doctores_recetas dr
      INNER JOIN doctores_perfiles dp
        ON dp.id_doctor = dr.id_doctor
      INNER JOIN usuarios u
        ON u.id_usuario = dr.id_usuario
      LEFT JOIN usuarios uv
        ON uv.id_usuario = dr.id_usuario_validador
      WHERE dr.activo = true
    `;

    const params = [];

    if (estatus && estatus !== 'TODOS') {
      params.push(String(estatus).toUpperCase());
      query += ` AND dr.estatus = $${params.length} `;
    }

    if (buscar && buscar.trim()) {
      params.push(`%${buscar.trim()}%`);
      query += `
        AND (
          dp.nombre_completo ILIKE $${params.length}
          OR dp.cedula_profesional ILIKE $${params.length}
          OR dp.especialidad ILIKE $${params.length}
          OR u.nombre ILIKE $${params.length}
          OR u.usuario ILIKE $${params.length}
          OR dr.titulo ILIKE $${params.length}
          OR dr.descripcion ILIKE $${params.length}
        )
      `;
    }

    query += `
      ORDER BY
        CASE dr.estatus
          WHEN 'PENDIENTE' THEN 1
          WHEN 'ATENDIDA' THEN 2
          WHEN 'RECHAZADA' THEN 3
          ELSE 4
        END ASC,
        dr.fecha_creacion DESC
    `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      recetas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar todas las recetas:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar recetas',
    });
  }
};

export const actualizarEstatusRecetaDoctor = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_receta } = req.params;
    const { estatus, observaciones } = req.body;

    const estatusFinal = String(estatus || '').trim().toUpperCase();

    const estatusPermitidos = [
      'ATENDIDA',
      'RECHAZADA',
      'CANCELADA',
      'PENDIENTE_CAJERO',
      'SURTIDA',
      'SURTIDA_PARCIAL',
    ];

    if (!estatusPermitidos.includes(estatusFinal)) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'Estatus no válido. Usa ATENDIDA, RECHAZADA, CANCELADA, PENDIENTE_CAJERO, SURTIDA o SURTIDA_PARCIAL',
      });
    }

    /**
     * Validación de permisos:
     *
     * - ATENDIDA / RECHAZADA / CANCELADA:
     *   Las puede usar el usuario validador de recetas.
     *
     * - PENDIENTE_CAJERO / SURTIDA / SURTIDA_PARCIAL:
     *   Las puede usar el cajero desde el POS.
     *
     * Ajusta los roles según como los tengas en tu sistema.
     */
    const esEstatusDeValidacion = ['ATENDIDA', 'RECHAZADA', 'CANCELADA'].includes(estatusFinal);

    const esEstatusDeCajero = ['PENDIENTE_CAJERO', 'SURTIDA', 'SURTIDA_PARCIAL'].includes(
      estatusFinal
    );

    const rolUsuario = String(req.usuario?.rol || '').toUpperCase();

    const esCajero =
      rolUsuario === 'CAJERO' ||
      rolUsuario === 'ADMIN_SUCURSAL' ||
      rolUsuario === 'SUPER_ADMIN';

    if (esEstatusDeValidacion && !esUsuarioValidadorRecetas(req.usuario)) {
      return res.status(403).json({
        ok: false,
        mensaje: 'No tienes permiso para validar recetas de doctores',
      });
    }

    if (esEstatusDeCajero && !esCajero) {
      return res.status(403).json({
        ok: false,
        mensaje: 'No tienes permiso para surtir recetas desde caja',
      });
    }

    await client.query('BEGIN');

    const recetaResultado = await client.query(
      `
      SELECT
        dr.id_receta,
        dr.id_doctor,
        dr.id_usuario,
        dr.titulo,
        dr.estatus,
        dr.puntos_generados,
        dr.activo,
        dp.nombre_completo AS doctor_nombre_completo,
        dp.puntos_actuales,
        dp.puntos_acumulados,
        dp.puntos_canjeados
      FROM doctores_recetas dr
      INNER JOIN doctores_perfiles dp
        ON dp.id_doctor = dr.id_doctor
      WHERE dr.id_receta = $1
      FOR UPDATE
      `,
      [id_receta]
    );

    if (recetaResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Receta no encontrada',
      });
    }

    const receta = recetaResultado.rows[0];

    if (!receta.activo) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'La receta está inactiva',
      });
    }

    /**
     * Reglas de transición:
     *
     * PENDIENTE:
     * - Puede pasar a ATENDIDA, RECHAZADA, CANCELADA o PENDIENTE_CAJERO.
     *
     * ATENDIDA:
     * - Puede pasar a PENDIENTE_CAJERO.
     *
     * PENDIENTE_CAJERO:
     * - Puede pasar a SURTIDA o SURTIDA_PARCIAL.
     *
     * SURTIDA_PARCIAL:
     * - Puede seguir como SURTIDA_PARCIAL o pasar a SURTIDA.
     *
     * SURTIDA:
     * - Ya no debería modificarse.
     */
    const transicionesPermitidas = {
      PENDIENTE: ['ATENDIDA', 'RECHAZADA', 'CANCELADA', 'PENDIENTE_CAJERO'],
      ATENDIDA: ['PENDIENTE_CAJERO'],
      PENDIENTE_CAJERO: ['SURTIDA', 'SURTIDA_PARCIAL', 'CANCELADA'],
      SURTIDA_PARCIAL: ['SURTIDA', 'SURTIDA_PARCIAL', 'CANCELADA'],
      SURTIDA: [],
      RECHAZADA: [],
      CANCELADA: [],
    };

    const estatusActual = String(receta.estatus || '').toUpperCase();

    const puedeCambiar =
      transicionesPermitidas[estatusActual] &&
      transicionesPermitidas[estatusActual].includes(estatusFinal);

    if (!puedeCambiar && estatusActual !== estatusFinal) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: `No se puede cambiar la receta de ${estatusActual} a ${estatusFinal}`,
      });
    }

    /**
     * Los puntos del doctor solo se generan cuando la receta pasa a ATENDIDA.
     * No se vuelven a generar cuando el cajero la marca como SURTIDA o SURTIDA_PARCIAL.
     */
    let configuracionDoctor = null;
    let puntosPorReceta = 0;

    if (estatusFinal === 'ATENDIDA') {
      configuracionDoctor = await obtenerConfiguracionPuntosDoctor(client);

      puntosPorReceta = esValorActivo(configuracionDoctor.puntos_doctor_activo)
        ? redondearDos(configuracionDoctor.puntos_doctor_receta)
        : 0;

      if (puntosPorReceta < 0) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'La configuración de puntos del doctor no puede ser negativa',
        });
      }
    }

    const recetaActualizadaResultado = await client.query(
      `
      UPDATE doctores_recetas
      SET
        estatus = $1,
        id_usuario_validador = CASE
          WHEN $2::boolean = true THEN $3
          ELSE id_usuario_validador
        END,
        fecha_validacion = CASE
          WHEN $2::boolean = true THEN CURRENT_TIMESTAMP
          ELSE fecha_validacion
        END,
        observaciones_validacion = CASE
          WHEN $2::boolean = true THEN $4
          ELSE observaciones_validacion
        END,
        puntos_generados = CASE
          WHEN $1 = 'ATENDIDA' THEN $5
          ELSE puntos_generados
        END,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_receta = $6
      RETURNING *
      `,
      [
        estatusFinal,
        esEstatusDeValidacion,
        req.usuario.id_usuario,
        observaciones ? observaciones.trim() : null,
        puntosPorReceta,
        id_receta,
      ]
    );

    let puntos = await obtenerPuntosDoctor(client, receta.id_doctor);
    let movimiento = null;

    if (estatusFinal === 'ATENDIDA' && puntosPorReceta > 0) {
      await client.query(
        `
        UPDATE doctores_perfiles
        SET
          puntos_actuales = COALESCE(puntos_actuales, 0) + $1,
          puntos_acumulados = COALESCE(puntos_acumulados, 0) + $1,
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_doctor = $2
        `,
        [puntosPorReceta, receta.id_doctor]
      );

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
        VALUES ($1, $2, $3, 'RECETA_ATENDIDA', $4, $5)
        RETURNING *
        `,
        [
          receta.id_doctor,
          receta.id_usuario,
          receta.id_receta,
          puntosPorReceta,
          `Puntos generados por receta atendida #${receta.id_receta} | Regla: ${puntosPorReceta} punto(s) por receta`,
        ]
      );

      movimiento = movimientoResultado.rows[0];
      puntos = await obtenerPuntosDoctor(client, receta.id_doctor);
    }

    await client.query('COMMIT');

    let mensaje = `Receta marcada como ${estatusFinal}`;

    if (estatusFinal === 'ATENDIDA') {
      mensaje =
        puntosPorReceta > 0
          ? 'Receta atendida correctamente. Se generaron puntos al doctor.'
          : 'Receta atendida correctamente. No se generaron puntos porque la regla está en 0 o inactiva.';
    }

    if (estatusFinal === 'PENDIENTE_CAJERO') {
      mensaje = 'Receta enviada correctamente al cajero.';
    }

    if (estatusFinal === 'SURTIDA') {
      mensaje = 'Receta surtida completamente.';
    }

    if (estatusFinal === 'SURTIDA_PARCIAL') {
      mensaje = 'Receta surtida parcialmente. Quedará pendiente para completarse después.';
    }

    return res.json({
      ok: true,
      mensaje,
      receta: recetaActualizadaResultado.rows[0],
      puntos_generados: puntosPorReceta,
      puntos,
      movimiento,
      configuracion_doctor: configuracionDoctor
        ? {
            puntos_doctor_receta: configuracionDoctor.puntos_doctor_receta,
            puntos_doctor_activo: configuracionDoctor.puntos_doctor_activo,
          }
        : null,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al actualizar estatus de receta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar estatus de receta',
    });
  } finally {
    client.release();
  }
};