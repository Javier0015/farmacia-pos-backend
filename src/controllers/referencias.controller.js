// src/controllers/referencias.controller.js

import { pool } from '../config/db.js';

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
    LIMIT 1;
    `,
    [idUsuario]
  );

  return resultado.rows[0]?.id_sucursal || null;
};


export const crearReferencia = async (req, res) => {
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

      numero_control,
      folio_aceptacion,
      fecha_referencia,

      unidad_refiere,
      hospital_refiere,
      atencion,
      medica_urgente,

      nombre_paciente,
      primer_apellido,
      segundo_apellido,
      sexo,
      fecha_nacimiento,
      edad,
      urgencia,
      telefono,
      domicilio,
      colonia,
      municipio,
      estado,
      numero_exterior,

      unidad_destino,
      servicio_destino,
      especialidad_destino,

      ta,
      temperatura,
      frecuencia_cardiaca,
      frecuencia_respiratoria,
      peso,
      talla,
      imc,
      spo2,
      perimetro_cefalico,

      motivos_referencia = [],

      diagnostico_presuncional,
      resumen_clinico,
      tratamiento,

      medico_refiere,
      cedula_profesional,
    } = req.body;

    if (!id_expediente) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El expediente es obligatorio.',
      });
    }

    if (!fecha_referencia) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La fecha de referencia es obligatoria.',
      });
    }

    if (!unidad_destino || !servicio_destino) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La unidad destino y el servicio son obligatorios.',
      });
    }

    if (!diagnostico_presuncional || !resumen_clinico) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El diagnóstico presuncional y el resumen clínico son obligatorios.',
      });
    }

    await client.query('BEGIN');

    const query = `
      INSERT INTO referencias_contrareferencias (
        id_expediente,
        id_fila,
        id_doctor,
        id_sucursal,

        tipo_documento,
        estatus,

        numero_control,
        folio_aceptacion,
        fecha_referencia,

        unidad_refiere,
        hospital_refiere,
        atencion,
        medica_urgente,

        nombre_paciente,
        primer_apellido,
        segundo_apellido,
        sexo,
        fecha_nacimiento,
        edad,
        urgencia,
        telefono,
        domicilio,
        colonia,
        municipio,
        estado,
        numero_exterior,

        unidad_destino,
        servicio_destino,
        especialidad_destino,

        ta,
        temperatura,
        frecuencia_cardiaca,
        frecuencia_respiratoria,
        peso,
        talla,
        imc,
        spo2,
        perimetro_cefalico,

        motivos_referencia,

        diagnostico_presuncional,
        resumen_clinico,
        tratamiento,

        medico_refiere,
        cedula_profesional
      )
      VALUES (
        $1, $2, $3, $4,
        'REFERENCIA', 'GENERADA',
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
        $25, $26, $27,
        $28, $29, $30, $31, $32, $33, $34, $35, $36,
        $37::jsonb,
        $38, $39, $40,
        $41, $42
      )
      RETURNING *;
    `;

    const values = [
      id_expediente,
      id_fila,
      id_usuario,
      id_sucursal,

      numero_control || null,
      folio_aceptacion || null,
      fecha_referencia,

      unidad_refiere || null,
      hospital_refiere || null,
      atencion || null,
      medica_urgente || null,

      nombre_paciente || null,
      primer_apellido || null,
      segundo_apellido || null,
      sexo || null,
      fecha_nacimiento || null,
      edad || null,
      urgencia || null,
      telefono || null,
      domicilio || null,
      colonia || null,
      municipio || null,
      estado || null,
      numero_exterior || null,

      unidad_destino || null,
      servicio_destino || null,
      especialidad_destino || null,

      ta || null,
      temperatura || null,
      frecuencia_cardiaca || null,
      frecuencia_respiratoria || null,
      peso || null,
      talla || null,
      imc || null,
      spo2 || null,
      perimetro_cefalico || null,

      JSON.stringify(motivos_referencia || []),

      diagnostico_presuncional || null,
      resumen_clinico || null,
      tratamiento || null,

      medico_refiere || null,
      cedula_profesional || null,
    ];

    const { rows } = await client.query(query, values);

    const referencia = rows[0];

    const documentoClinico = await registrarDocumentoClinico(client, {
      id_expediente,
      id_fila,
      id_doctor: id_usuario,
      id_sucursal,

      tipo_documento: 'REFERENCIA',
      id_origen: referencia.id_referencia,
      folio: referencia.numero_control || `REF-${referencia.id_referencia}`,
      titulo: 'Referencia / contrarreferencia',
      descripcion: diagnostico_presuncional || resumen_clinico || null,
      estatus: referencia.estatus || 'GENERADA',

      tabla_origen: 'referencias_contrareferencias',
      ruta_frontend: `/app/doctor-shaddai/referencias?id_referencia=${referencia.id_referencia}`,

      metadata: {
        nombre_paciente,
        primer_apellido,
        segundo_apellido,
        sexo,
        fecha_nacimiento,
        edad,
        urgencia,
        telefono,
        domicilio,
        colonia,
        municipio,
        estado,
        numero_exterior,

        unidad_refiere,
        hospital_refiere,
        atencion,
        medica_urgente,

        unidad_destino,
        servicio_destino,
        especialidad_destino,

        ta,
        temperatura,
        frecuencia_cardiaca,
        frecuencia_respiratoria,
        peso,
        talla,
        imc,
        spo2,
        perimetro_cefalico,

        motivos_referencia,
        diagnostico_presuncional,
        resumen_clinico,
        tratamiento,

        medico_refiere,
        cedula_profesional,
      },
    });

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Referencia guardada correctamente.',
      referencia,
      documento_clinico: documentoClinico,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error al hacer rollback:', rollbackError);
    }

    console.error('Error al crear referencia:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al guardar la referencia.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const listarReferenciasPorExpediente = async (req, res) => {
  try {
    const { id_expediente } = req.params;

    const query = `
      SELECT *
      FROM referencias_contrareferencias
      WHERE id_expediente = $1
      ORDER BY fecha_creacion DESC;
    `;

    const { rows } = await pool.query(query, [id_expediente]);

    return res.json({
      ok: true,
      referencias: rows,
    });
  } catch (error) {
    console.error('Error al listar referencias:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al consultar referencias.',
      error: error.message,
    });
  }
};

export const obtenerReferenciaPorId = async (req, res) => {
  try {
    const { id_referencia } = req.params;

    const query = `
      SELECT *
      FROM referencias_contrareferencias
      WHERE id_referencia = $1
      LIMIT 1;
    `;

    const { rows } = await pool.query(query, [id_referencia]);

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Referencia no encontrada.',
      });
    }

    return res.json({
      ok: true,
      referencia: rows[0],
    });
  } catch (error) {
    console.error('Error al obtener referencia:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al consultar la referencia.',
      error: error.message,
    });
  }
};