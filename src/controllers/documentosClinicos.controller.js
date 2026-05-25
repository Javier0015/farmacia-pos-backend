import { pool } from '../config/db.js';

export const listarDocumentosClinicosPorAtencion = async (req, res) => {
  try {
    const { id_fila } = req.params;

    if (!id_fila) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El id_fila es obligatorio.',
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        id_documento,
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
        fecha_documento,
        fecha_creacion,
        fecha_actualizacion
      FROM documentos_clinicos
      WHERE id_fila = $1
      ORDER BY fecha_documento DESC, fecha_creacion DESC
      `,
      [id_fila]
    );

    return res.json({
      ok: true,
      documentos: rows,
    });
  } catch (error) {
    console.error('Error al listar documentos clínicos por atención:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al consultar documentos clínicos de la atención.',
      error: error.message,
    });
  }
};

export const listarDocumentosClinicosPorExpediente = async (req, res) => {
  try {
    const { id_expediente } = req.params;

    if (!id_expediente) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El id_expediente es obligatorio.',
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        id_documento,
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
        fecha_documento,
        fecha_creacion,
        fecha_actualizacion
      FROM documentos_clinicos
      WHERE id_expediente = $1
      ORDER BY fecha_documento DESC, fecha_creacion DESC
      `,
      [id_expediente]
    );

    return res.json({
      ok: true,
      documentos: rows,
    });
  } catch (error) {
    console.error('Error al listar documentos clínicos por expediente:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al consultar documentos clínicos del expediente.',
      error: error.message,
    });
  }
};

export const obtenerDocumentoClinicoPorId = async (req, res) => {
  try {
    const { id_documento } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
        id_documento,
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
        fecha_documento,
        fecha_creacion,
        fecha_actualizacion
      FROM documentos_clinicos
      WHERE id_documento = $1
      LIMIT 1
      `,
      [id_documento]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Documento clínico no encontrado.',
      });
    }

    return res.json({
      ok: true,
      documento: rows[0],
    });
  } catch (error) {
    console.error('Error al obtener documento clínico:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al consultar el documento clínico.',
      error: error.message,
    });
  }
};