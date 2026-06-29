import { pool } from '../config/db.js';

const normalizarTexto = (valor) => {
  if (valor === undefined || valor === null) return null;

  const limpio = String(valor).trim();

  return limpio || null;
};

const MAX_POSTGRES_INTEGER = 2147483647;

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

const normalizarNumero = (valor) => {
  if (valor === undefined || valor === null || valor === '') return null;

  const numero = Number(valor);

  return Number.isNaN(numero) ? null : numero;
};

const calcularIMC = (pesoKg, tallaCm) => {
  const peso = normalizarNumero(pesoKg);
  const talla = normalizarNumero(tallaCm);

  if (!peso || !talla) return null;

  const tallaMetros = talla / 100;

  if (tallaMetros <= 0) return null;

  return Number((peso / (tallaMetros * tallaMetros)).toFixed(2));
};

const TIPOS_NOTA_VALIDOS = new Set([
  'NOTA_INICIAL',
  'NOTA_EVOLUCION',
]);

const normalizarTipoNota = (valor) => {
  const tipo = String(valor || '').trim().toUpperCase();

  return TIPOS_NOTA_VALIDOS.has(tipo)
    ? tipo
    : 'NOTA_INICIAL';
};

const normalizarTipoNotaOpcional = (valor) => {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return null;
  }

  const tipo = String(valor).trim().toUpperCase();

  return TIPOS_NOTA_VALIDOS.has(tipo) ? tipo : null;
};

const obtenerTituloTipoNota = (tipoNota) => {
  return normalizarTipoNota(tipoNota) === 'NOTA_EVOLUCION'
    ? 'Nota de evolución'
    : 'Nota médica inicial';
};


const esConsultaMedica = (tipoAtencion) => {
  return String(tipoAtencion || 'CONSULTA_MEDICA')
    .trim()
    .toUpperCase() === 'CONSULTA_MEDICA';
};

const sincronizarEstadoNotaMedicaFila = async (client, idFila) => {
  const idFilaFinal = normalizarIdEntero(idFila);

  if (!idFilaFinal) {
    return null;
  }

  const resultado = await client.query(
    `
    UPDATE doctor_fila_espera f
    SET
      estado_nota_medica = CASE
        WHEN COALESCE(f.tipo_atencion, 'CONSULTA_MEDICA') <> 'CONSULTA_MEDICA'
          THEN 'NO_APLICA'
        WHEN f.estatus IN ('CANCELADO', 'NO_ASISTIO')
          THEN 'NO_APLICA'
        WHEN EXISTS (
          SELECT 1
          FROM notas_medicas nm
          WHERE nm.id_fila = f.id_fila
            AND nm.activo = true
        )
          THEN 'COMPLETA'
        ELSE 'PENDIENTE'
      END,
      fecha_actualizacion = NOW()
    WHERE f.id_fila = $1
    RETURNING id_fila, estado_nota_medica;
    `,
    [idFilaFinal]
  );

  return resultado.rows[0] || null;
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

export const crearNotaMedica = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      id_expediente,
      id_fila,
      id_sucursal,
      tipo_nota,

      antecedentes_padecimiento_actual,
      exploracion_fisica,
      plan,
      pronostico,
      pasa_a,
      observaciones,

      motivo_consulta,
      diagnostico,

      peso_kg,
      talla_cm,
      imc,
      presion_arterial,
      frecuencia_cardiaca,
      temperatura,
      saturacion_oxigeno,
    } = req.body;

    const idDoctor = req.usuario?.id_usuario;

    if (!idDoctor) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario no autenticado.',
      });
    }

    const idExpedienteFinal = normalizarIdEntero(id_expediente);
    const idFilaFinal = normalizarIdEntero(id_fila);
    const idSucursalBodyFinal = normalizarIdEntero(id_sucursal);
    const tipoNotaFinal = normalizarTipoNota(tipo_nota);

    if (!idExpedienteFinal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El id_expediente es obligatorio.',
      });
    }

    if (!normalizarTexto(antecedentes_padecimiento_actual)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Los antecedentes y padecimiento actual son obligatorios.',
      });
    }

    if (!normalizarTexto(exploracion_fisica)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La exploración física es obligatoria.',
      });
    }

    if (!normalizarTexto(plan)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El plan es obligatorio.',
      });
    }

    await client.query('BEGIN');

    const expedienteResult = await client.query(
      `
      SELECT 
        id_expediente,
        nombre_paciente,
        primer_apellido,
        segundo_apellido,
        activo
      FROM expedientes_clinicos
      WHERE id_expediente = $1
      LIMIT 1;
      `,
      [idExpedienteFinal]
    );

    if (expedienteResult.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'El expediente clínico no existe.',
      });
    }

    if (expedienteResult.rows[0].activo === false) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El expediente clínico está inactivo.',
      });
    }

    let idSucursalFinal =
      idSucursalBodyFinal ||
      normalizarIdEntero(req.usuario?.id_sucursal) ||
      null;

    if (idFilaFinal) {
      const filaResult = await client.query(
        `
        SELECT 
          id_fila,
          id_expediente,
          id_sucursal,
          estatus,
          COALESCE(tipo_atencion, 'CONSULTA_MEDICA') AS tipo_atencion
        FROM doctor_fila_espera
        WHERE id_fila = $1
        LIMIT 1;
        `,
        [idFilaFinal]
      );

      if (filaResult.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: 'El registro de atención en fila no existe.',
        });
      }

      const fila = filaResult.rows[0];

      if (
        fila.id_expediente &&
        Number(fila.id_expediente) !== Number(idExpedienteFinal)
      ) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje:
            'El expediente enviado no coincide con el expediente vinculado a la atención.',
        });
      }

      idSucursalFinal = normalizarIdEntero(fila.id_sucursal) || idSucursalFinal;

      const puedeRegistrarNota =
        fila.estatus === 'EN_ATENCION' ||
        (fila.estatus === 'ATENDIDO' && esConsultaMedica(fila.tipo_atencion));

      if (!puedeRegistrarNota) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje:
            'La nota médica solo puede registrarse durante la atención o después de finalizar una consulta médica con nota pendiente.',
        });
      }

      const notaExistente = await client.query(
        `
        SELECT id_nota
        FROM notas_medicas
        WHERE id_fila = $1
          AND activo = true
        LIMIT 1;
        `,
        [idFilaFinal]
      );

      if (notaExistente.rows.length > 0) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          ok: false,
          mensaje: 'Esta atención ya tiene una nota médica registrada.',
          id_nota: notaExistente.rows[0].id_nota,
        });
      }
    }

    const imcFinal = normalizarNumero(imc) || calcularIMC(peso_kg, talla_cm);

    const queryInsert = `
      INSERT INTO notas_medicas (
        id_expediente,
        id_fila,
        id_doctor,
        id_sucursal,
        tipo_nota,

        antecedentes_padecimiento_actual,
        exploracion_fisica,
        plan,
        pronostico,
        pasa_a,
        observaciones,

        motivo_consulta,
        diagnostico,

        peso_kg,
        talla_cm,
        imc,
        presion_arterial,
        frecuencia_cardiaca,
        temperatura,
        saturacion_oxigeno
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13,
        $14, $15, $16, $17, $18, $19, $20
      )
      RETURNING *;
    `;

    const valuesInsert = [
      idExpedienteFinal,
      idFilaFinal,
      Number(idDoctor),
      idSucursalFinal,
      tipoNotaFinal,

      normalizarTexto(antecedentes_padecimiento_actual),
      normalizarTexto(exploracion_fisica),
      normalizarTexto(plan),
      normalizarTexto(pronostico),
      normalizarTexto(pasa_a),
      normalizarTexto(observaciones),

      normalizarTexto(motivo_consulta),
      normalizarTexto(diagnostico),

      normalizarNumero(peso_kg),
      normalizarNumero(talla_cm),
      imcFinal,
      normalizarTexto(presion_arterial),
      normalizarNumero(frecuencia_cardiaca),
      normalizarNumero(temperatura),
      normalizarNumero(saturacion_oxigeno),
    ];

    const notaResult = await client.query(queryInsert, valuesInsert);
    const nota = notaResult.rows[0];

    const documentoClinico = await registrarDocumentoClinico(client, {
      id_expediente: idExpedienteFinal,
      id_fila: idFilaFinal,
      id_doctor: Number(idDoctor),
      id_sucursal: idSucursalFinal,

      tipo_documento: 'NOTA_MEDICA',
      id_origen: nota.id_nota,
      folio: `NOTA-${nota.id_nota}`,
      titulo: obtenerTituloTipoNota(nota.tipo_nota),
      descripcion:
        normalizarTexto(diagnostico) ||
        normalizarTexto(motivo_consulta) ||
        normalizarTexto(antecedentes_padecimiento_actual),
      estatus: 'GENERADA',

      tabla_origen: 'notas_medicas',
      ruta_frontend: `/app/doctor-shaddai/recetas?id_expediente=${idExpedienteFinal}&id_fila=${idFilaFinal || ''
        }&tipo_atencion=CONSULTA_MEDICA`,

      metadata: {
        tipo_nota: nota.tipo_nota,
        motivo_consulta: nota.motivo_consulta,
        diagnostico: nota.diagnostico,
        pronostico: nota.pronostico,
        pasa_a: nota.pasa_a,
        peso_kg: nota.peso_kg,
        talla_cm: nota.talla_cm,
        imc: nota.imc,
        presion_arterial: nota.presion_arterial,
        frecuencia_cardiaca: nota.frecuencia_cardiaca,
        temperatura: nota.temperatura,
        saturacion_oxigeno: nota.saturacion_oxigeno,
      },
    });

    const filaActualizada = await sincronizarEstadoNotaMedicaFila(
      client,
      idFilaFinal
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Nota médica registrada correctamente.',
      nota,
      expediente: expedienteResult.rows[0],
      documento_clinico: documentoClinico,
      fila: filaActualizada,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error al hacer ROLLBACK:', rollbackError);
    }

    console.error('Error al crear nota médica:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al registrar la nota médica.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const obtenerNotaPorFila = async (req, res) => {
  try {
    const { idFila } = req.params;
    const idFilaFinal = normalizarIdEntero(idFila);

    if (!idFilaFinal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El idFila es obligatorio.',
      });
    }

    const query = `
      SELECT
        nm.*,
        ec.nombre_paciente,
        ec.primer_apellido,
        ec.segundo_apellido,
        ec.curp,
        ec.telefono,
        ec.sexo,
        ec.edad,
        ec.fecha_nacimiento,
        ec.direccion,
        ec.alergias,
        ec.enfermedades_condiciones,
        ec.medicamentos_actuales,
        u.nombre AS doctor_usuario,
        dsp.nombre_completo AS doctor_nombre_completo,
        dsp.cedula_profesional,
        dsp.especialidad,
        s.nombre AS sucursal_nombre
      FROM notas_medicas nm
      INNER JOIN expedientes_clinicos ec ON ec.id_expediente = nm.id_expediente
      LEFT JOIN usuarios u ON u.id_usuario = nm.id_doctor
      LEFT JOIN doctores_shaddai_perfiles dsp ON dsp.id_usuario = nm.id_doctor
      LEFT JOIN sucursales s ON s.id_sucursal = nm.id_sucursal
      WHERE nm.id_fila = $1
        AND nm.activo = true
      ORDER BY nm.fecha_nota DESC
      LIMIT 1;
    `;

    const { rows } = await pool.query(query, [idFilaFinal]);

    return res.json({
      ok: true,
      existe: rows.length > 0,
      nota: rows[0] || null,
    });
  } catch (error) {
    console.error('Error al obtener nota médica por fila:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al obtener la nota médica de la atención.',
      error: error.message,
    });
  }
};

export const listarNotasPorExpediente = async (req, res) => {
  try {
    const { idExpediente } = req.params;
    const idExpedienteFinal = normalizarIdEntero(idExpediente);

    if (!idExpedienteFinal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El idExpediente es obligatorio.',
      });
    }

    const query = `
      SELECT
        nm.*,
        u.nombre AS doctor_usuario,
        dsp.nombre_completo AS doctor_nombre_completo,
        dsp.cedula_profesional,
        dsp.especialidad,
        s.nombre AS sucursal_nombre
      FROM notas_medicas nm
      LEFT JOIN usuarios u ON u.id_usuario = nm.id_doctor
      LEFT JOIN doctores_shaddai_perfiles dsp ON dsp.id_usuario = nm.id_doctor
      LEFT JOIN sucursales s ON s.id_sucursal = nm.id_sucursal
      WHERE nm.id_expediente = $1
        AND nm.activo = true
      ORDER BY nm.fecha_nota DESC;
    `;

    const { rows } = await pool.query(query, [idExpedienteFinal]);

    return res.json({
      ok: true,
      notas: rows,
    });
  } catch (error) {
    console.error('Error al listar notas médicas:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al listar las notas médicas del expediente.',
      error: error.message,
    });
  }
};

export const obtenerNotaMedicaPorId = async (req, res) => {
  try {
    const { idNota } = req.params;
    const idNotaFinal = normalizarIdEntero(idNota);

    if (!idNotaFinal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El idNota es obligatorio.',
      });
    }

    const query = `
      SELECT
        nm.*,
        ec.nombre_paciente,
        ec.primer_apellido,
        ec.segundo_apellido,
        ec.curp,
        ec.telefono,
        ec.sexo,
        ec.edad,
        ec.fecha_nacimiento,
        ec.direccion,
        ec.alergias,
        ec.enfermedades_condiciones,
        ec.medicamentos_actuales,
        u.nombre AS doctor_usuario,
        dsp.nombre_completo AS doctor_nombre_completo,
        dsp.cedula_profesional,
        dsp.especialidad,
        s.nombre AS sucursal_nombre
      FROM notas_medicas nm
      INNER JOIN expedientes_clinicos ec ON ec.id_expediente = nm.id_expediente
      LEFT JOIN usuarios u ON u.id_usuario = nm.id_doctor
      LEFT JOIN doctores_shaddai_perfiles dsp ON dsp.id_usuario = nm.id_doctor
      LEFT JOIN sucursales s ON s.id_sucursal = nm.id_sucursal
      WHERE nm.id_nota = $1
        AND nm.activo = true
      LIMIT 1;
    `;

    const { rows } = await pool.query(query, [idNotaFinal]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'La nota médica no existe o está inactiva.',
      });
    }

    return res.json({
      ok: true,
      nota: rows[0],
    });
  } catch (error) {
    console.error('Error al obtener nota médica:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al obtener la nota médica.',
      error: error.message,
    });
  }
};

export const actualizarNotaMedica = async (req, res) => {
  const client = await pool.connect();

  try {
    const { idNota } = req.params;
    const idNotaFinal = normalizarIdEntero(idNota);

    const {
      tipo_nota,
      antecedentes_padecimiento_actual,
      exploracion_fisica,
      plan,
      pronostico,
      pasa_a,
      observaciones,

      motivo_consulta,
      diagnostico,

      peso_kg,
      talla_cm,
      imc,
      presion_arterial,
      frecuencia_cardiaca,
      temperatura,
      saturacion_oxigeno,
    } = req.body;

    if (!idNotaFinal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El idNota es obligatorio.',
      });
    }

    const tipoNotaOpcional = normalizarTipoNotaOpcional(tipo_nota);
    const imcFinal = normalizarNumero(imc) || calcularIMC(peso_kg, talla_cm);

    await client.query('BEGIN');

    const query = `
      UPDATE notas_medicas
      SET
        tipo_nota = COALESCE($1, tipo_nota),

        antecedentes_padecimiento_actual = $2,
        exploracion_fisica = $3,
        plan = $4,
        pronostico = $5,
        pasa_a = $6,
        observaciones = $7,

        motivo_consulta = $8,
        diagnostico = $9,

        peso_kg = $10,
        talla_cm = $11,
        imc = $12,
        presion_arterial = $13,
        frecuencia_cardiaca = $14,
        temperatura = $15,
        saturacion_oxigeno = $16,

        fecha_actualizacion = NOW()
      WHERE id_nota = $17
        AND activo = true
      RETURNING *;
    `;

    const values = [
      tipoNotaOpcional,

      normalizarTexto(antecedentes_padecimiento_actual),
      normalizarTexto(exploracion_fisica),
      normalizarTexto(plan),
      normalizarTexto(pronostico),
      normalizarTexto(pasa_a),
      normalizarTexto(observaciones),

      normalizarTexto(motivo_consulta),
      normalizarTexto(diagnostico),

      normalizarNumero(peso_kg),
      normalizarNumero(talla_cm),
      imcFinal,
      normalizarTexto(presion_arterial),
      normalizarNumero(frecuencia_cardiaca),
      normalizarNumero(temperatura),
      normalizarNumero(saturacion_oxigeno),

      idNotaFinal,
    ];

    const { rows } = await client.query(query, values);

    if (rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'La nota médica no existe o está inactiva.',
      });
    }

    const nota = rows[0];

    await client.query(
      `
      UPDATE documentos_clinicos
      SET
        titulo = $1,
        descripcion = COALESCE($2, descripcion),
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{tipo_nota}',
          to_jsonb($3::text),
          true
        ),
        fecha_actualizacion = NOW()
      WHERE tabla_origen = 'notas_medicas'
        AND id_origen = $4;
      `,
      [
        obtenerTituloTipoNota(nota.tipo_nota),
        nota.diagnostico || nota.motivo_consulta || null,
        nota.tipo_nota,
        nota.id_nota,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Nota médica actualizada correctamente.',
      nota,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error al hacer ROLLBACK:', rollbackError);
    }

    console.error('Error al actualizar nota médica:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al actualizar la nota médica.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const eliminarNotaMedica = async (req, res) => {
  const client = await pool.connect();

  try {
    const { idNota } = req.params;
    const idNotaFinal = normalizarIdEntero(idNota);

    if (!idNotaFinal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El idNota es obligatorio.',
      });
    }

    await client.query('BEGIN');

    const resultado = await client.query(
      `
      UPDATE notas_medicas
      SET
        activo = false,
        fecha_actualizacion = NOW()
      WHERE id_nota = $1
        AND activo = true
      RETURNING *;
      `,
      [idNotaFinal]
    );

    if (resultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'La nota médica no existe o ya estaba inactiva.',
      });
    }

    const nota = resultado.rows[0];

    const filaActualizada = await sincronizarEstadoNotaMedicaFila(
      client,
      nota.id_fila
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Nota médica eliminada correctamente.',
      nota,
      fila: filaActualizada,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error al hacer ROLLBACK al eliminar nota médica:', rollbackError);
    }

    console.error('Error al eliminar nota médica:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al eliminar la nota médica.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};
