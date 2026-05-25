import { pool } from '../config/db.js';

const TIPOS_ATENCION_VALIDOS = [
  'CONSULTA_MEDICA',
  'SERVICIO_RAPIDO',
  'SOLO_RECETA',
  'LABORATORIO',
];

const LABEL_TIPO_ATENCION = {
  CONSULTA_MEDICA: 'Consulta médica',
  SERVICIO_RAPIDO: 'Servicio clínico rápido',
  SOLO_RECETA: 'Solo receta',
  LABORATORIO: 'Laboratorio',
};

const normalizarTexto = (valor) => {
  if (valor === undefined || valor === null) return null;

  const limpio = String(valor).trim();

  return limpio || null;
};

const normalizarTipoAtencion = (tipoAtencion) => {
  const tipo = String(tipoAtencion || 'CONSULTA_MEDICA')
    .trim()
    .toUpperCase();

  if (!TIPOS_ATENCION_VALIDOS.includes(tipo)) {
    return null;
  }

  return tipo;
};

export const crearPacienteFila = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      nombre_paciente,
      telefono,
      tipo_atencion,
      motivo,
      observaciones,
      id_sucursal,
    } = req.body;

    const id_usuario_registro = req.usuario?.id_usuario;
    const idSucursalFinal = id_sucursal || req.usuario?.id_sucursal || null;
    const tipoAtencionFinal = normalizarTipoAtencion(tipo_atencion);

    if (!id_usuario_registro) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario no autenticado.',
      });
    }

    if (!idSucursalFinal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sucursal es obligatoria para enviar al paciente a la fila.',
      });
    }

    if (!normalizarTexto(nombre_paciente)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del paciente es obligatorio.',
      });
    }

    if (!tipoAtencionFinal) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'El tipo de atención no es válido. Usa CONSULTA_MEDICA, SERVICIO_RAPIDO, SOLO_RECETA o LABORATORIO.',
      });
    }

    if (!normalizarTexto(motivo)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El motivo de la atención es obligatorio.',
      });
    }

    await client.query('BEGIN');

    const queryFila = `
      INSERT INTO doctor_fila_espera (
        nombre_paciente,
        telefono,
        tipo_atencion,
        motivo,
        observaciones,
        id_sucursal,
        id_usuario_registro
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;

    const valuesFila = [
      normalizarTexto(nombre_paciente),
      normalizarTexto(telefono),
      tipoAtencionFinal,
      normalizarTexto(motivo),
      normalizarTexto(observaciones),
      Number(idSucursalFinal),
      id_usuario_registro,
    ];

    const { rows } = await client.query(queryFila, valuesFila);
    const filaCreada = rows[0];

    const querySucursal = `
      SELECT nombre
      FROM sucursales
      WHERE id_sucursal = $1
      LIMIT 1;
    `;

    const { rows: sucursalRows } = await client.query(querySucursal, [
      Number(idSucursalFinal),
    ]);

    const nombreSucursal =
      sucursalRows[0]?.nombre || `Sucursal ${idSucursalFinal}`;

    const tipoAtencionLabel =
      LABEL_TIPO_ATENCION[tipoAtencionFinal] || tipoAtencionFinal;

    const queryAlerta = `
      INSERT INTO alertas (
        titulo,
        mensaje,
        prioridad,
        tipo_destino,
        destino_rol,
        id_sucursal,
        id_usuario_creador,
        fecha_creacion,
        activa
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true)
      RETURNING *;
    `;

    const valuesAlerta = [
      'Nuevo paciente en fila',
      `Se agregó a ${normalizarTexto(
        nombre_paciente
      )} a la fila de espera de ${nombreSucursal}. Tipo: ${tipoAtencionLabel}. Motivo: ${normalizarTexto(
        motivo
      )}`,
      'IMPORTANTE',
      'ROL_SUCURSAL',
      'DOCTOR_SHADDAI',
      Number(idSucursalFinal),
      id_usuario_registro,
    ];

    let alertaCreada = null;

    try {
      const alertaResult = await client.query(queryAlerta, valuesAlerta);
      alertaCreada = alertaResult.rows[0];
    } catch (errorAlerta) {
      console.error('Error al crear alerta para doctor:', errorAlerta);

      throw new Error(
        `El paciente se intentó registrar, pero no se pudo crear la alerta: ${errorAlerta.message}`
      );
    }

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Paciente agregado a la fila de espera.',
      fila: filaCreada,
      alerta: alertaCreada,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error al hacer ROLLBACK:', rollbackError);
    }

    console.error('Error al crear paciente en fila:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al agregar paciente a la fila de espera.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const listarFilaEspera = async (req, res) => {
  try {
    const id_sucursal_usuario = req.usuario?.id_sucursal;
    const rol = req.usuario?.rol || req.usuario?.nombre_rol;
    const esSuperAdmin = rol === 'SUPER_ADMIN';

    let query = `
      SELECT 
        f.*,
        COALESCE(f.tipo_atencion, 'CONSULTA_MEDICA') AS tipo_atencion,
        u.nombre AS registrado_por,
        d.nombre AS doctor_nombre,
        s.nombre AS sucursal_nombre,
        ec.nombre_paciente AS expediente_nombre,
        ec.primer_apellido AS expediente_primer_apellido,
        ec.segundo_apellido AS expediente_segundo_apellido,
        ec.curp AS expediente_curp
      FROM doctor_fila_espera f
      LEFT JOIN usuarios u ON u.id_usuario = f.id_usuario_registro
      LEFT JOIN usuarios d ON d.id_usuario = f.id_doctor
      LEFT JOIN sucursales s ON s.id_sucursal = f.id_sucursal
      LEFT JOIN expedientes_clinicos ec ON ec.id_expediente = f.id_expediente
      WHERE f.estatus IN ('EN_ESPERA', 'EN_ATENCION')
    `;

    const values = [];

    if (!esSuperAdmin && id_sucursal_usuario) {
      values.push(id_sucursal_usuario);
      query += ` AND f.id_sucursal = $${values.length}`;
    }

    query += `
      ORDER BY 
        CASE 
          WHEN f.estatus = 'EN_ATENCION' THEN 1
          WHEN f.estatus = 'EN_ESPERA' THEN 2
          ELSE 3
        END,
        f.fecha_registro ASC;
    `;

    const { rows } = await pool.query(query, values);

    return res.json({
      ok: true,
      fila: rows,
    });
  } catch (error) {
    console.error('Error al listar fila de espera:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al obtener la fila de espera.',
      error: error.message,
    });
  }
};

export const listarHistoricoFila = async (req, res) => {
  try {
    const id_sucursal_usuario = req.usuario?.id_sucursal;
    const rol = req.usuario?.rol || req.usuario?.nombre_rol;
    const esSuperAdmin = rol === 'SUPER_ADMIN';

    let query = `
      SELECT 
        f.*,
        COALESCE(f.tipo_atencion, 'CONSULTA_MEDICA') AS tipo_atencion,
        u.nombre AS registrado_por,
        d.nombre AS doctor_nombre,
        s.nombre AS sucursal_nombre,
        ec.nombre_paciente AS expediente_nombre,
        ec.primer_apellido AS expediente_primer_apellido,
        ec.segundo_apellido AS expediente_segundo_apellido,
        ec.curp AS expediente_curp
      FROM doctor_fila_espera f
      LEFT JOIN usuarios u ON u.id_usuario = f.id_usuario_registro
      LEFT JOIN usuarios d ON d.id_usuario = f.id_doctor
      LEFT JOIN sucursales s ON s.id_sucursal = f.id_sucursal
      LEFT JOIN expedientes_clinicos ec ON ec.id_expediente = f.id_expediente
      WHERE f.estatus IN ('ATENDIDO', 'CANCELADO', 'NO_ASISTIO')
    `;

    const values = [];

    if (!esSuperAdmin && id_sucursal_usuario) {
      values.push(id_sucursal_usuario);
      query += ` AND f.id_sucursal = $${values.length}`;
    }

    query += `
      ORDER BY f.fecha_actualizacion DESC
      LIMIT 200;
    `;

    const { rows } = await pool.query(query, values);

    return res.json({
      ok: true,
      historico: rows,
    });
  } catch (error) {
    console.error('Error al listar histórico de fila:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al obtener el histórico de atenciones.',
      error: error.message,
    });
  }
};

export const atenderPaciente = async (req, res) => {
  try {
    const { id } = req.params;
    const id_doctor = req.usuario?.id_usuario;

    if (!id_doctor) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario no autenticado.',
      });
    }

    const query = `
      UPDATE doctor_fila_espera
      SET 
        estatus = 'EN_ATENCION',
        id_doctor = $1,
        fecha_inicio_atencion = COALESCE(fecha_inicio_atencion, NOW()),
        fecha_actualizacion = NOW()
      WHERE id_fila = $2
        AND estatus = 'EN_ESPERA'
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [id_doctor, id]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'El paciente no existe o ya fue tomado por otro doctor.',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Paciente marcado en atención.',
      fila: rows[0],
    });
  } catch (error) {
    console.error('Error al atender paciente:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al iniciar atención del paciente.',
      error: error.message,
    });
  }
};

export const vincularExpedienteAFila = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_expediente } = req.body;

    if (!id_expediente) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El id_expediente es obligatorio.',
      });
    }

    const expedienteResult = await pool.query(
      `
      SELECT id_expediente
      FROM expedientes_clinicos
      WHERE id_expediente = $1
        AND activo = true
      LIMIT 1;
      `,
      [id_expediente]
    );

    if (expedienteResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'El expediente seleccionado no existe o está inactivo.',
      });
    }

    const filaResult = await pool.query(
      `
      UPDATE doctor_fila_espera
      SET
        id_expediente = $1,
        fecha_actualizacion = NOW()
      WHERE id_fila = $2
        AND estatus = 'EN_ATENCION'
      RETURNING *;
      `,
      [id_expediente, id]
    );

    if (filaResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'El registro de la fila no existe o no está en atención.',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Expediente vinculado correctamente.',
      fila: filaResult.rows[0],
    });
  } catch (error) {
    console.error('Error al vincular expediente a fila:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al vincular el expediente.',
      error: error.message,
    });
  }
};

export const finalizarPaciente = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      UPDATE doctor_fila_espera
      SET 
        estatus = 'ATENDIDO',
        fecha_fin_atencion = NOW(),
        fecha_actualizacion = NOW()
      WHERE id_fila = $1
        AND estatus IN ('EN_ESPERA', 'EN_ATENCION')
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'El paciente no existe o ya fue finalizado.',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Atención finalizada correctamente.',
      fila: rows[0],
    });
  } catch (error) {
    console.error('Error al finalizar paciente:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al finalizar atención.',
      error: error.message,
    });
  }
};

export const cancelarPaciente = async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo_cancelacion } = req.body;

    const query = `
      UPDATE doctor_fila_espera
      SET 
        estatus = 'CANCELADO',
        observaciones = COALESCE(observaciones, '') || 
          CASE 
            WHEN $2::text IS NOT NULL AND $2::text <> '' 
            THEN E'\\nCancelación: ' || $2::text 
            ELSE '' 
          END,
        fecha_actualizacion = NOW()
      WHERE id_fila = $1
        AND estatus IN ('EN_ESPERA', 'EN_ATENCION')
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [id, motivo_cancelacion || null]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'El paciente no existe o ya fue finalizado.',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Paciente cancelado correctamente.',
      fila: rows[0],
    });
  } catch (error) {
    console.error('Error al cancelar paciente:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al cancelar paciente.',
      error: error.message,
    });
  }
};

export const marcarNoAsistio = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      UPDATE doctor_fila_espera
      SET 
        estatus = 'NO_ASISTIO',
        fecha_actualizacion = NOW()
      WHERE id_fila = $1
        AND estatus IN ('EN_ESPERA', 'EN_ATENCION')
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'El paciente no existe o ya fue finalizado.',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Paciente marcado como no asistió.',
      fila: rows[0],
    });
  } catch (error) {
    console.error('Error al marcar no asistió:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al marcar paciente como no asistió.',
      error: error.message,
    });
  }
};