// src/controllers/consentimientos.controller.js

import { pool } from '../config/db.js';

const nullIfEmpty = (value) => {
  if (value === undefined || value === null || value === '') return null;
  return value;
};

const obtenerIdSucursalDoctor = async (client, req, idUsuario) => {
  const idSucursalToken =
    req.usuario?.id_sucursal ||
    req.usuario?.sucursal_id ||
    req.usuario?.idSucursal ||
    null;

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

export const crearConsentimiento = async (req, res) => {
  const client = await pool.connect();

  try {
    const id_usuario = req.usuario?.id_usuario;
    let id_sucursal = null;

    if (!id_usuario) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario no autenticado.',
      });
    }

    id_sucursal = await obtenerIdSucursalDoctor(client, req, id_usuario);

    const {
      id_expediente,
      id_fila = null,

      fecha_consentimiento,
      hora_consentimiento,

      nombre_paciente,
      curp,
      edad,
      sexo,
      fecha_nacimiento,
      domicilio,
      telefono,
      municipio,

      nombre_responsable,
      parentesco_responsable,
      domicilio_responsable,
      telefono_responsable,

      diagnostico,
      procedimiento_tratamiento,
      riesgos_frecuentes,
      beneficios,
      alternativas,
      observaciones,

      autoriza_atencion = true,
      motivo_consentimiento,

      nombre_testigo,
      parentesco_testigo,

      medico_responsable,
      cedula_profesional,
    } = req.body;

    if (!id_expediente) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El expediente es obligatorio.',
      });
    }

    if (!fecha_consentimiento) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La fecha del consentimiento es obligatoria.',
      });
    }

    if (!nombre_paciente) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del paciente es obligatorio.',
      });
    }

    if (!diagnostico) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El diagnóstico es obligatorio.',
      });
    }

    if (!procedimiento_tratamiento) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El procedimiento o tratamiento es obligatorio.',
      });
    }

    const query = `
      INSERT INTO consentimientos_informados (
        id_expediente,
        id_fila,
        id_doctor,
        id_sucursal,
        estatus,

        fecha_consentimiento,
        hora_consentimiento,

        nombre_paciente,
        curp,
        edad,
        sexo,
        fecha_nacimiento,
        domicilio,
        telefono,

        nombre_responsable,
        parentesco_responsable,
        domicilio_responsable,
        telefono_responsable,

        diagnostico,
        procedimiento_tratamiento,
        riesgos_frecuentes,
        beneficios,
        alternativas,
        observaciones,

        autoriza_atencion,
        motivo_consentimiento,

        nombre_testigo,
        parentesco_testigo,

        medico_responsable,
        cedula_profesional
      )
      VALUES (
        $1, $2, $3, $4, 'GENERADO',
        $5, $6,
        $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23,
        $24, $25,
        $26, $27,
        $28, $29
      )
      RETURNING *;
    `;

    await client.query('BEGIN');

    const values = [
      id_expediente,
      id_fila,
      id_usuario,
      id_sucursal,

      fecha_consentimiento,
      nullIfEmpty(hora_consentimiento),

      nullIfEmpty(nombre_paciente),
      nullIfEmpty(curp),
      nullIfEmpty(edad),
      nullIfEmpty(sexo),
      nullIfEmpty(fecha_nacimiento),
      nullIfEmpty(domicilio),
      nullIfEmpty(telefono),

      nullIfEmpty(nombre_responsable),
      nullIfEmpty(parentesco_responsable),
      nullIfEmpty(domicilio_responsable),
      nullIfEmpty(telefono_responsable),

      nullIfEmpty(diagnostico),
      nullIfEmpty(procedimiento_tratamiento),
      nullIfEmpty(riesgos_frecuentes),
      nullIfEmpty(beneficios),
      nullIfEmpty(alternativas),
      nullIfEmpty(observaciones),

      autoriza_atencion === false ? false : true,
      nullIfEmpty(motivo_consentimiento),

      nullIfEmpty(nombre_testigo),
      nullIfEmpty(parentesco_testigo),

      nullIfEmpty(medico_responsable),
      nullIfEmpty(cedula_profesional),
    ];

    const { rows } = await client.query(query, values);

    const consentimiento = rows[0];

    const documentoClinico = await registrarDocumentoClinico(client, {
      id_expediente,
      id_fila,
      id_doctor: id_usuario,
      id_sucursal,

      tipo_documento: 'CONSENTIMIENTO',
      id_origen: consentimiento.id_consentimiento,
      folio: `CONS-${consentimiento.id_consentimiento}`,
      titulo: 'Consentimiento informado',
      descripcion:
        consentimiento.diagnostico ||
        consentimiento.motivo_consentimiento ||
        null,
      estatus: consentimiento.estatus || 'GENERADO',

      tabla_origen: 'consentimientos_informados',
      ruta_frontend: `/app/doctor-shaddai/consentimientos?id_consentimiento=${consentimiento.id_consentimiento}`,

      metadata: {
        id_consentimiento: consentimiento.id_consentimiento,

        fecha_consentimiento: consentimiento.fecha_consentimiento,
        hora_consentimiento: consentimiento.hora_consentimiento,

        nombre_paciente: consentimiento.nombre_paciente,
        curp: consentimiento.curp,
        edad: consentimiento.edad,
        sexo: consentimiento.sexo,
        fecha_nacimiento: consentimiento.fecha_nacimiento,

        domicilio: consentimiento.domicilio,
        telefono: consentimiento.telefono,
        municipio: nullIfEmpty(municipio),

        nombre_responsable: consentimiento.nombre_responsable,
        parentesco_responsable: consentimiento.parentesco_responsable,
        domicilio_responsable: consentimiento.domicilio_responsable,
        telefono_responsable: consentimiento.telefono_responsable,

        diagnostico: consentimiento.diagnostico,
        procedimiento_tratamiento: consentimiento.procedimiento_tratamiento,
        riesgos_frecuentes: consentimiento.riesgos_frecuentes,
        beneficios: consentimiento.beneficios,
        alternativas: consentimiento.alternativas,
        observaciones: consentimiento.observaciones,

        autoriza_atencion: consentimiento.autoriza_atencion,
        motivo_consentimiento: consentimiento.motivo_consentimiento,

        nombre_testigo: consentimiento.nombre_testigo,
        parentesco_testigo: consentimiento.parentesco_testigo,

        medico_responsable: consentimiento.medico_responsable,
        cedula_profesional: consentimiento.cedula_profesional,
      },
    });

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Consentimiento informado guardado correctamente.',
      consentimiento,
      documento_clinico: documentoClinico,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error al hacer rollback:', rollbackError);
    }

    console.error('Error al guardar consentimiento informado:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al guardar el consentimiento informado.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const listarConsentimientosPorExpediente = async (req, res) => {
  try {
    const { id_expediente } = req.params;

    const { rows } = await pool.query(
      `
      SELECT *
      FROM consentimientos_informados
      WHERE id_expediente = $1
      ORDER BY fecha_creacion DESC;
      `,
      [id_expediente]
    );

    return res.json({
      ok: true,
      consentimientos: rows,
    });
  } catch (error) {
    console.error('Error al listar consentimientos informados:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al consultar consentimientos informados.',
      error: error.message,
    });
  }
};

export const obtenerConsentimientoPorId = async (req, res) => {
  try {
    const { id_consentimiento } = req.params;

    const { rows } = await pool.query(
      `
      SELECT *
      FROM consentimientos_informados
      WHERE id_consentimiento = $1
      LIMIT 1;
      `,
      [id_consentimiento]
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Consentimiento informado no encontrado.',
      });
    }

    return res.json({
      ok: true,
      consentimiento: rows[0],
    });
  } catch (error) {
    console.error('Error al consultar consentimiento informado:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al consultar el consentimiento informado.',
      error: error.message,
    });
  }
};