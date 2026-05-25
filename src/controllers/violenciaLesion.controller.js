// src/controllers/violenciaLesion.controller.js

import { pool } from '../config/db.js';

const normalizarArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
};

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

export const crearHojaViolenciaLesion = async (req, res) => {
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

      folio,
      fecha_atencion,
      hora_atencion,

      nombre_paciente,
      primer_apellido,
      segundo_apellido,
      curp,
      fecha_nacimiento,
      entidad_pais_nacimiento,
      edad_anios,
      edad_meses,
      edad_dias,
      sexo,
      telefono,
      domicilio,
      entidad,
      municipio,
      localidad,
      ocupacion,

      afiliacion_salud,
      numero_afiliacion,
      gratuidad,
      escolaridad,
      escolaridad_estado,
      sabe_leer_escribir,
      se_considera_indigena,
      habla_lengua_indigena,
      lengua_indigena,
      se_considera_afromexicano,
      migrante_retornado,
      mujer_edad_fertil,
      semanas_gestacion,
      dificultad_discapacidad,
      referido_por,
      referido_por_nombre,

      fecha_ocurrencia,
      hora_ocurrencia,
      sitio_ocurrencia,
      sitio_ocurrencia_otro,
      entidad_ocurrencia,
      municipio_ocurrencia,
      localidad_ocurrencia,
      codigo_postal_ocurrencia,
      tipo_vialidad,
      nombre_vialidad,
      numero_exterior,
      numero_interior,
      tipo_asentamiento,
      nombre_asentamiento,
      intencionalidad,
      recibio_atencion_prehospitalaria,
      tiempo_traslado_horas,
      tiempo_traslado_minutos,
      sospecha_efectos,
      accidente_vehiculo_motor,
      lesionado_es,
      uso_equipo_seguridad,
      equipo_seguridad_utilizado,

      tipo_violencia,
      numero_agresores,
      agresor_nombre,
      agresor_sexo,
      agresor_edad,
      agresor_parentesco,
      agresor_sospecha_efectos,
      evento_autoinfligido_ocurrio,

      agentes_lesion = [],
      areas_anatomicas = [],
      areas_anatomicas_otro,
      consecuencias = [],
      consecuencias_otro,

      afeccion_principal,
      codigo_cie_afeccion_principal,
      causa_externa,

      servicio_otorgado,
      tipo_atencion,
      aviso_ministerio_publico,
      destino_despues_atencion,
      defuncion_folio_certificado,

      responsable_atencion,
      responsable_nombre,
      responsable_primer_apellido,
      responsable_segundo_apellido,
      responsable_curp,
      responsable_cedula,
    } = req.body;

    if (!id_expediente) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El expediente es obligatorio.',
      });
    }

    if (!fecha_atencion) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La fecha de atención es obligatoria.',
      });
    }

    if (!nombre_paciente) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del paciente es obligatorio.',
      });
    }

    if (!intencionalidad) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La intencionalidad del evento es obligatoria.',
      });
    }

    if (!afeccion_principal || !causa_externa) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La afección principal y la causa externa son obligatorias.',
      });
    }

    const query = `
      INSERT INTO violencia_lesion (
        id_expediente,
        id_fila,
        id_doctor,
        id_sucursal,
        estatus,

        folio,
        fecha_atencion,
        hora_atencion,

        nombre_paciente,
        primer_apellido,
        segundo_apellido,
        curp,
        fecha_nacimiento,
        entidad_pais_nacimiento,
        edad_anios,
        edad_meses,
        edad_dias,
        sexo,
        telefono,
        domicilio,
        entidad,
        municipio,
        localidad,
        ocupacion,

        afiliacion_salud,
        numero_afiliacion,
        gratuidad,
        escolaridad,
        escolaridad_estado,
        sabe_leer_escribir,
        se_considera_indigena,
        habla_lengua_indigena,
        lengua_indigena,
        se_considera_afromexicano,
        migrante_retornado,
        mujer_edad_fertil,
        semanas_gestacion,
        dificultad_discapacidad,
        referido_por,
        referido_por_nombre,

        fecha_ocurrencia,
        hora_ocurrencia,
        sitio_ocurrencia,
        sitio_ocurrencia_otro,
        entidad_ocurrencia,
        municipio_ocurrencia,
        localidad_ocurrencia,
        codigo_postal_ocurrencia,
        tipo_vialidad,
        nombre_vialidad,
        numero_exterior,
        numero_interior,
        tipo_asentamiento,
        nombre_asentamiento,
        intencionalidad,
        recibio_atencion_prehospitalaria,
        tiempo_traslado_horas,
        tiempo_traslado_minutos,
        sospecha_efectos,
        accidente_vehiculo_motor,
        lesionado_es,
        uso_equipo_seguridad,
        equipo_seguridad_utilizado,

        tipo_violencia,
        numero_agresores,
        agresor_nombre,
        agresor_sexo,
        agresor_edad,
        agresor_parentesco,
        agresor_sospecha_efectos,
        evento_autoinfligido_ocurrio,

        agentes_lesion,
        areas_anatomicas,
        areas_anatomicas_otro,
        consecuencias,
        consecuencias_otro,

        afeccion_principal,
        codigo_cie_afeccion_principal,
        causa_externa,

        servicio_otorgado,
        tipo_atencion,
        aviso_ministerio_publico,
        destino_despues_atencion,
        defuncion_folio_certificado,

        responsable_atencion,
        responsable_nombre,
        responsable_primer_apellido,
        responsable_segundo_apellido,
        responsable_curp,
        responsable_cedula
      )
      VALUES (
        $1, $2, $3, $4, 'GENERADA',
        $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
        $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39,
        $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58, $59, $60, $61, $62,
        $63, $64, $65, $66, $67, $68, $69, $70,
        $71::jsonb, $72::jsonb, $73, $74::jsonb, $75,
        $76, $77, $78,
        $79, $80, $81, $82, $83,
        $84, $85, $86, $87, $88, $89
      )
      RETURNING *;
    `;

    await client.query('BEGIN');

    const values = [
      id_expediente,
      id_fila,
      id_usuario,
      id_sucursal,

      nullIfEmpty(folio),
      fecha_atencion,
      nullIfEmpty(hora_atencion),

      nullIfEmpty(nombre_paciente),
      nullIfEmpty(primer_apellido),
      nullIfEmpty(segundo_apellido),
      nullIfEmpty(curp),
      nullIfEmpty(fecha_nacimiento),
      nullIfEmpty(entidad_pais_nacimiento),
      nullIfEmpty(edad_anios),
      nullIfEmpty(edad_meses),
      nullIfEmpty(edad_dias),
      nullIfEmpty(sexo),
      nullIfEmpty(telefono),
      nullIfEmpty(domicilio),
      nullIfEmpty(entidad),
      nullIfEmpty(municipio),
      nullIfEmpty(localidad),
      nullIfEmpty(ocupacion),

      nullIfEmpty(afiliacion_salud),
      nullIfEmpty(numero_afiliacion),
      nullIfEmpty(gratuidad),
      nullIfEmpty(escolaridad),
      nullIfEmpty(escolaridad_estado),
      nullIfEmpty(sabe_leer_escribir),
      nullIfEmpty(se_considera_indigena),
      nullIfEmpty(habla_lengua_indigena),
      nullIfEmpty(lengua_indigena),
      nullIfEmpty(se_considera_afromexicano),
      nullIfEmpty(migrante_retornado),
      nullIfEmpty(mujer_edad_fertil),
      nullIfEmpty(semanas_gestacion),
      nullIfEmpty(dificultad_discapacidad),
      nullIfEmpty(referido_por),
      nullIfEmpty(referido_por_nombre),

      nullIfEmpty(fecha_ocurrencia),
      nullIfEmpty(hora_ocurrencia),
      nullIfEmpty(sitio_ocurrencia),
      nullIfEmpty(sitio_ocurrencia_otro),
      nullIfEmpty(entidad_ocurrencia),
      nullIfEmpty(municipio_ocurrencia),
      nullIfEmpty(localidad_ocurrencia),
      nullIfEmpty(codigo_postal_ocurrencia),
      nullIfEmpty(tipo_vialidad),
      nullIfEmpty(nombre_vialidad),
      nullIfEmpty(numero_exterior),
      nullIfEmpty(numero_interior),
      nullIfEmpty(tipo_asentamiento),
      nullIfEmpty(nombre_asentamiento),
      nullIfEmpty(intencionalidad),
      nullIfEmpty(recibio_atencion_prehospitalaria),
      nullIfEmpty(tiempo_traslado_horas),
      nullIfEmpty(tiempo_traslado_minutos),
      nullIfEmpty(sospecha_efectos),
      nullIfEmpty(accidente_vehiculo_motor),
      nullIfEmpty(lesionado_es),
      nullIfEmpty(uso_equipo_seguridad),
      nullIfEmpty(equipo_seguridad_utilizado),

      nullIfEmpty(tipo_violencia),
      nullIfEmpty(numero_agresores),
      nullIfEmpty(agresor_nombre),
      nullIfEmpty(agresor_sexo),
      nullIfEmpty(agresor_edad),
      nullIfEmpty(agresor_parentesco),
      nullIfEmpty(agresor_sospecha_efectos),
      nullIfEmpty(evento_autoinfligido_ocurrio),

      JSON.stringify(normalizarArray(agentes_lesion)),
      JSON.stringify(normalizarArray(areas_anatomicas)),
      nullIfEmpty(areas_anatomicas_otro),
      JSON.stringify(normalizarArray(consecuencias)),
      nullIfEmpty(consecuencias_otro),

      nullIfEmpty(afeccion_principal),
      nullIfEmpty(codigo_cie_afeccion_principal),
      nullIfEmpty(causa_externa),

      nullIfEmpty(servicio_otorgado),
      nullIfEmpty(tipo_atencion),
      nullIfEmpty(aviso_ministerio_publico),
      nullIfEmpty(destino_despues_atencion),
      nullIfEmpty(defuncion_folio_certificado),

      nullIfEmpty(responsable_atencion),
      nullIfEmpty(responsable_nombre),
      nullIfEmpty(responsable_primer_apellido),
      nullIfEmpty(responsable_segundo_apellido),
      nullIfEmpty(responsable_curp),
      nullIfEmpty(responsable_cedula),
    ];

    const { rows } = await client.query(query, values);

    const hoja = rows[0];

    const folioFinal = hoja.folio || `VL-${hoja.id_violencia_lesion}`;

    if (!hoja.folio) {
      await client.query(
        `
    UPDATE violencia_lesion
    SET folio = $1,
        fecha_actualizacion = CURRENT_TIMESTAMP
    WHERE id_violencia_lesion = $2;
    `,
        [folioFinal, hoja.id_violencia_lesion]
      );
    }

    const hojaConFolio = {
      ...hoja,
      folio: folioFinal,
    };

    const documentoClinico = await registrarDocumentoClinico(client, {
      id_expediente,
      id_fila,
      id_doctor: id_usuario,
      id_sucursal,

      tipo_documento: 'VIOLENCIA_LESION',
      id_origen: hoja.id_violencia_lesion,
      folio: folioFinal,
      titulo: 'Hoja de violencia / lesión',
      descripcion: afeccion_principal || causa_externa || null,
      estatus: hoja.estatus || 'GENERADA',

      tabla_origen: 'violencia_lesion',
      ruta_frontend: `/app/doctor-shaddai/violencia-lesion?id_violencia_lesion=${hoja.id_violencia_lesion}`,

      metadata: {
        ...hojaConFolio,

        id_violencia_lesion: hoja.id_violencia_lesion,

        agentes_lesion: normalizarArray(hoja.agentes_lesion || agentes_lesion),
        areas_anatomicas: normalizarArray(hoja.areas_anatomicas || areas_anatomicas),
        consecuencias: normalizarArray(hoja.consecuencias || consecuencias),
      },
    });

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Hoja de violencia y/o lesión guardada correctamente.',
      hoja: hojaConFolio,
      documento_clinico: documentoClinico,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error al hacer rollback:', rollbackError);
    }

    console.error('Error al guardar hoja de violencia/lesión:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al guardar la hoja de violencia y/o lesión.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const listarHojasViolenciaLesionPorExpediente = async (req, res) => {
  try {
    const { id_expediente } = req.params;

    const { rows } = await pool.query(
      `
        SELECT *
        FROM violencia_lesion
        WHERE id_expediente = $1
        ORDER BY fecha_creacion DESC
      `,
      [id_expediente]
    );

    return res.json({
      ok: true,
      hojas: rows,
    });
  } catch (error) {
    console.error('Error al listar hojas de violencia/lesión:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al consultar hojas de violencia y/o lesión.',
      error: error.message,
    });
  }
};

export const obtenerHojaViolenciaLesionPorId = async (req, res) => {
  try {
    const { id_violencia_lesion } = req.params;

    const { rows } = await pool.query(
      `
        SELECT *
        FROM violencia_lesion
        WHERE id_violencia_lesion = $1
        LIMIT 1
      `,
      [id_violencia_lesion]
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Hoja de violencia y/o lesión no encontrada.',
      });
    }

    return res.json({
      ok: true,
      hoja: rows[0],
    });
  } catch (error) {
    console.error('Error al consultar hoja de violencia/lesión:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al consultar la hoja de violencia y/o lesión.',
      error: error.message,
    });
  }
};