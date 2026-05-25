import { pool } from '../config/db.js';

const MAX_POSTGRES_INTEGER = 2147483647;

const generarFolioLaboratorio = (idSolicitud) => {
  const year = new Date().getFullYear();
  return `LAB-${year}-${String(idSolicitud).padStart(6, '0')}`;
};

const normalizarTexto = (valor) => {
  if (valor === undefined || valor === null) return null;

  const texto = String(valor).trim();

  return texto.length > 0 ? texto : null;
};

const normalizarHora = (valor) => {
  const texto = normalizarTexto(valor);

  if (!texto) return null;

  const regex = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

  if (!regex.test(texto)) {
    return null;
  }

  return texto.length === 5 ? `${texto}:00` : texto;
};

const normalizarIdEntero = (valor) => {
  if (valor === undefined || valor === null || valor === '') return null;

  if (typeof valor === 'string' && valor.startsWith('tmp-')) {
    return null;
  }

  const numero = Number(valor);

  if (!Number.isInteger(numero)) return null;
  if (numero <= 0) return null;
  if (numero > MAX_POSTGRES_INTEGER) return null;

  return numero;
};

const obtenerIdUsuario = (req) => {
  return (
    req.usuario?.id_usuario ||
    req.user?.id_usuario ||
    req.usuario?.id ||
    req.user?.id ||
    null
  );
};

const obtenerIdDoctorDesdePerfil = async (client, idUsuario) => {
  const { rows } = await client.query(
    `
    SELECT id_perfil
    FROM doctores_shaddai_perfiles
    WHERE id_usuario = $1
      AND activo = TRUE
    LIMIT 1;
    `,
    [idUsuario]
  );

  return rows[0]?.id_perfil || null;
};

const obtenerIdSucursalDesdeUsuario = (req) => {
  return (
    req.usuario?.id_sucursal ||
    req.usuario?.sucursal_id ||
    req.usuario?.idSucursal ||
    req.user?.id_sucursal ||
    req.user?.sucursal_id ||
    req.user?.idSucursal ||
    null
  );
};

const obtenerIdSucursalDoctor = async (client, req, idUsuario) => {
  const idSucursalToken = obtenerIdSucursalDesdeUsuario(req);

  if (idSucursalToken) {
    return Number(idSucursalToken);
  }

  const idSucursalBody =
    req.body?.id_sucursal ||
    req.body?.idSucursal ||
    null;

  if (idSucursalBody) {
    return Number(idSucursalBody);
  }

  const resultado = await client.query(
    `
    SELECT id_sucursal
    FROM usuario_sucursales
    WHERE id_usuario = $1
      AND activo = true
    ORDER BY id_usuario_sucursal ASC
    LIMIT 1;
    `,
    [idUsuario]
  );

  return resultado.rows[0]?.id_sucursal || null;
};

const registrarDocumentoClinico = async (
  client,
  {
    id_expediente,
    id_fila = null,
    id_doctor,
    id_sucursal = null,
    tipo_documento,
    id_origen,
    folio = null,
    titulo = null,
    descripcion = null,
    estatus = 'GENERADO',
    tabla_origen,
    ruta_frontend = null,
    metadata = {},
  }
) => {
  if (!id_expediente || !id_doctor || !tipo_documento || !id_origen) {
    return null;
  }

  const resultado = await client.query(
    `
    INSERT INTO documentos_clinicos (
      id_expediente,
      id_fila,
      id_doctor,
      id_sucursal,
      tipo_documento,
      id_origen,
      folio,
      titulo,
      descripcion,
      estatus,
      tabla_origen,
      ruta_frontend,
      metadata,
      fecha_documento
    )
    VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8, $9,
      $10, $11, $12, $13::jsonb,
      CURRENT_TIMESTAMP
    )
    RETURNING *;
    `,
    [
      id_expediente,
      id_fila,
      id_doctor,
      id_sucursal,
      tipo_documento,
      id_origen,
      folio,
      titulo,
      descripcion,
      estatus,
      tabla_origen,
      ruta_frontend,
      JSON.stringify(metadata || {}),
    ]
  );

  return resultado.rows[0];
};

export const listarCatalogoLaboratorio = async (req, res) => {
  try {
    const busqueda = normalizarTexto(req.query.busqueda);

    const params = [];
    let where = 'WHERE activo = TRUE';

    if (busqueda) {
      params.push(`%${busqueda}%`);
      where += ` AND nombre ILIKE $${params.length}`;
    }

    const { rows } = await pool.query(
      `
      SELECT
        id_estudio,
        nombre,
        descripcion,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM laboratorio_catalogo
      ${where}
      ORDER BY nombre ASC;
      `,
      params
    );

    return res.json({
      ok: true,
      estudios: rows,
    });
  } catch (error) {
    console.error('Error al listar catálogo de laboratorio:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudo cargar el catálogo de laboratorio.',
      error: error.message,
    });
  }
};

export const crearEstudioLaboratorio = async (req, res) => {
  const client = await pool.connect();

  try {
    const nombre = normalizarTexto(req.body.nombre);
    const descripcion = normalizarTexto(req.body.descripcion);

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del estudio es obligatorio.',
      });
    }

    await client.query('BEGIN');

    const existente = await client.query(
      `
      SELECT
        id_estudio,
        nombre,
        descripcion,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM laboratorio_catalogo
      WHERE LOWER(nombre) = LOWER($1)
      LIMIT 1;
      `,
      [nombre]
    );

    if (existente.rows.length > 0) {
      const estudioExistente = existente.rows[0];

      const actualizado = await client.query(
        `
        UPDATE laboratorio_catalogo
        SET
          activo = TRUE,
          descripcion = COALESCE($2, descripcion),
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_estudio = $1
        RETURNING
          id_estudio,
          nombre,
          descripcion,
          activo,
          fecha_creacion,
          fecha_actualizacion;
        `,
        [estudioExistente.id_estudio, descripcion]
      );

      await client.query('COMMIT');

      return res.status(200).json({
        ok: true,
        mensaje: 'El estudio ya existía y fue activado correctamente.',
        estudio: actualizado.rows[0],
      });
    }

    const { rows } = await client.query(
      `
      INSERT INTO laboratorio_catalogo (
        nombre,
        descripcion,
        activo
      )
      VALUES ($1, $2, TRUE)
      RETURNING
        id_estudio,
        nombre,
        descripcion,
        activo,
        fecha_creacion,
        fecha_actualizacion;
      `,
      [nombre, descripcion]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Estudio agregado correctamente.',
      estudio: rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al crear estudio de laboratorio:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudo crear el estudio de laboratorio.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const crearSolicitudLaboratorio = async (req, res) => {
  const client = await pool.connect();

  try {
    const idUsuario = obtenerIdUsuario(req);

    if (!idUsuario) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario no autenticado.',
      });
    }

    const {
      id_paciente_expediente = null,
      id_fila = null,
      id_sucursal = null,
      paciente = {},
      diagnostico,
      observaciones,
      hora_obtencion_muestra,
      hora_recepcion_muestra,
      estudios = [],
    } = req.body;

    const nombrePaciente = normalizarTexto(
      paciente.nombre_paciente || paciente.nombre
    );

    const telefono = normalizarTexto(paciente.telefono);
    const sexo = normalizarTexto(paciente.sexo);

    const diagnosticoFinal = normalizarTexto(
      diagnostico || paciente.diagnostico
    );

    const observacionesFinal = normalizarTexto(
      observaciones || paciente.observaciones
    );

    const edad =
      paciente.edad !== undefined &&
      paciente.edad !== null &&
      paciente.edad !== ''
        ? Number(paciente.edad)
        : null;

    const horaObtencion = normalizarHora(hora_obtencion_muestra);
    const horaRecepcion = normalizarHora(hora_recepcion_muestra);

    if (!nombrePaciente) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del paciente es obligatorio.',
      });
    }

    if (!diagnosticoFinal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El diagnóstico es obligatorio.',
      });
    }

    if (!Array.isArray(estudios) || estudios.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Debes seleccionar al menos un estudio de laboratorio.',
      });
    }

    const estudiosNormalizados = estudios
      .map((item) => ({
        id_estudio: normalizarIdEntero(item.id_estudio),
        nombre: normalizarTexto(item.nombre || item.nombre_estudio),
        observaciones_estudio: normalizarTexto(
          item.observaciones_estudio || item.observaciones || item.nota
        ),
      }))
      .filter((item) => item.nombre);

    if (estudiosNormalizados.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Los estudios seleccionados no son válidos.',
      });
    }

    await client.query('BEGIN');

    const idDoctor = await obtenerIdDoctorDesdePerfil(client, idUsuario);

    const idPacienteExpedienteFinal = normalizarIdEntero(id_paciente_expediente);
    const idFilaFinal = normalizarIdEntero(id_fila);

    const idSucursalFinal =
      normalizarIdEntero(id_sucursal) ||
      (await obtenerIdSucursalDoctor(client, req, idUsuario));

    const insertSolicitud = await client.query(
      `
      INSERT INTO laboratorio_solicitudes (
        folio,
        id_paciente_expediente,
        id_doctor,
        id_usuario_creador,
        nombre_paciente,
        edad,
        sexo,
        telefono,
        diagnostico,
        observaciones,
        hora_obtencion_muestra,
        hora_recepcion_muestra,
        estatus
      )
      VALUES (
        'TEMP',
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        'GENERADA'
      )
      RETURNING *;
      `,
      [
        idPacienteExpedienteFinal,
        idDoctor,
        idUsuario,
        nombrePaciente,
        Number.isNaN(edad) ? null : edad,
        sexo,
        telefono,
        diagnosticoFinal,
        observacionesFinal,
        horaObtencion,
        horaRecepcion,
      ]
    );

    const solicitudTemporal = insertSolicitud.rows[0];
    const folio = generarFolioLaboratorio(solicitudTemporal.id_solicitud);

    const updateFolio = await client.query(
      `
      UPDATE laboratorio_solicitudes
      SET
        folio = $1,
        fecha_actualizacion = NOW()
      WHERE id_solicitud = $2
      RETURNING *;
      `,
      [folio, solicitudTemporal.id_solicitud]
    );

    const solicitud = updateFolio.rows[0];

    const detalles = [];

    for (const estudio of estudiosNormalizados) {
      const insertDetalle = await client.query(
        `
        INSERT INTO laboratorio_solicitud_estudios (
          id_solicitud,
          id_estudio,
          nombre_estudio,
          observaciones_estudio
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *;
        `,
        [
          solicitud.id_solicitud,
          estudio.id_estudio,
          estudio.nombre,
          estudio.observaciones_estudio,
        ]
      );

      detalles.push(insertDetalle.rows[0]);
    }

    const documentoClinico = await registrarDocumentoClinico(client, {
      id_expediente: idPacienteExpedienteFinal || null,
      id_fila: idFilaFinal,
      id_doctor: idUsuario,
      id_sucursal: idSucursalFinal,

      tipo_documento: 'LABORATORIO',
      id_origen: solicitud.id_solicitud,
      folio: solicitud.folio,
      titulo: 'Solicitud de laboratorio',
      descripcion: diagnosticoFinal,
      estatus: solicitud.estatus || 'GENERADA',

      tabla_origen: 'laboratorio_solicitudes',
      ruta_frontend: `/app/doctor-shaddai/laboratorio?id_solicitud=${solicitud.id_solicitud}`,

      metadata: {
        nombre_paciente: solicitud.nombre_paciente,
        edad: solicitud.edad,
        sexo: solicitud.sexo,
        telefono: solicitud.telefono,
        diagnostico: solicitud.diagnostico,
        observaciones: solicitud.observaciones,
        hora_obtencion_muestra: solicitud.hora_obtencion_muestra,
        hora_recepcion_muestra: solicitud.hora_recepcion_muestra,
        total_estudios: detalles.length,
        estudios: detalles.map((item) => ({
          id_detalle: item.id_detalle,
          id_estudio: item.id_estudio,
          nombre_estudio: item.nombre_estudio,
          observaciones_estudio: item.observaciones_estudio,
        })),
      },
    });

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Solicitud de laboratorio creada correctamente.',
      solicitud,
      detalles,
      documento_clinico: documentoClinico,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al crear solicitud de laboratorio:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudo crear la solicitud de laboratorio.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const listarMisSolicitudesLaboratorio = async (req, res) => {
  try {
    const idUsuario = obtenerIdUsuario(req);

    if (!idUsuario) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario no autenticado.',
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        s.id_solicitud,
        s.folio,
        s.id_paciente_expediente,
        s.id_doctor,
        s.id_usuario_creador,
        s.nombre_paciente,
        s.edad,
        s.sexo,
        s.telefono,
        s.diagnostico,
        s.observaciones,
        s.hora_obtencion_muestra,
        s.hora_recepcion_muestra,
        s.estatus,
        s.activo,
        s.fecha_solicitud,
        s.fecha_creacion,
        s.fecha_actualizacion,
        p.nombre_completo AS medico_nombre,
        p.cedula_profesional AS medico_cedula,
        p.especialidad AS medico_especialidad,
        COALESCE(
          json_agg(
            json_build_object(
              'id_detalle', d.id_detalle,
              'id_estudio', d.id_estudio,
              'nombre_estudio', d.nombre_estudio,
              'nombre', d.nombre_estudio,
              'observaciones_estudio', d.observaciones_estudio
            )
            ORDER BY d.nombre_estudio
          ) FILTER (WHERE d.id_detalle IS NOT NULL),
          '[]'
        ) AS estudios
      FROM laboratorio_solicitudes s
      LEFT JOIN doctores_shaddai_perfiles p
        ON p.id_perfil = s.id_doctor
      LEFT JOIN laboratorio_solicitud_estudios d
        ON d.id_solicitud = s.id_solicitud
      WHERE s.id_usuario_creador = $1
        AND s.activo = TRUE
      GROUP BY
        s.id_solicitud,
        p.nombre_completo,
        p.cedula_profesional,
        p.especialidad
      ORDER BY s.fecha_creacion DESC;
      `,
      [idUsuario]
    );

    return res.json({
      ok: true,
      solicitudes: rows,
    });
  } catch (error) {
    console.error('Error al listar solicitudes de laboratorio:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudieron cargar las solicitudes de laboratorio.',
      error: error.message,
    });
  }
};

export const obtenerSolicitudLaboratorio = async (req, res) => {
  try {
    const idUsuario = obtenerIdUsuario(req);
    const { id } = req.params;

    if (!idUsuario) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario no autenticado.',
      });
    }

    const solicitudResult = await pool.query(
      `
      SELECT
        s.*,
        p.nombre_completo AS medico_nombre,
        p.cedula_profesional AS medico_cedula,
        p.especialidad AS medico_especialidad
      FROM laboratorio_solicitudes s
      LEFT JOIN doctores_shaddai_perfiles p
        ON p.id_perfil = s.id_doctor
      WHERE s.id_solicitud = $1
        AND s.id_usuario_creador = $2
        AND s.activo = TRUE
      LIMIT 1;
      `,
      [id, idUsuario]
    );

    if (solicitudResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Solicitud de laboratorio no encontrada.',
      });
    }

    const detallesResult = await pool.query(
      `
      SELECT
        id_detalle,
        id_solicitud,
        id_estudio,
        nombre_estudio,
        nombre_estudio AS nombre,
        observaciones_estudio,
        fecha_creacion
      FROM laboratorio_solicitud_estudios
      WHERE id_solicitud = $1
      ORDER BY nombre_estudio ASC;
      `,
      [id]
    );

    return res.json({
      ok: true,
      solicitud: solicitudResult.rows[0],
      detalles: detallesResult.rows,
    });
  } catch (error) {
    console.error('Error al obtener solicitud de laboratorio:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudo obtener la solicitud de laboratorio.',
      error: error.message,
    });
  }
};

export const cancelarSolicitudLaboratorio = async (req, res) => {
  try {
    const idUsuario = obtenerIdUsuario(req);
    const { id } = req.params;

    if (!idUsuario) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario no autenticado.',
      });
    }

    const { rows } = await pool.query(
      `
      UPDATE laboratorio_solicitudes
      SET
        estatus = 'CANCELADA',
        activo = FALSE,
        fecha_actualizacion = NOW()
      WHERE id_solicitud = $1
        AND id_usuario_creador = $2
        AND activo = TRUE
      RETURNING *;
      `,
      [id, idUsuario]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Solicitud de laboratorio no encontrada o ya cancelada.',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Solicitud de laboratorio cancelada correctamente.',
      solicitud: rows[0],
    });
  } catch (error) {
    console.error('Error al cancelar solicitud de laboratorio:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudo cancelar la solicitud de laboratorio.',
      error: error.message,
    });
  }
};