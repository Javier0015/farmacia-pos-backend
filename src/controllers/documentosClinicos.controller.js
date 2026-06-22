import { pool } from '../config/db.js';

const columnasDocumentoClinico = `
  dc.id_documento,
  dc.id_expediente,
  dc.id_fila,
  dc.id_doctor,
  dc.id_sucursal,
  dc.tipo_documento,
  dc.id_origen,
  dc.folio,
  dc.titulo,
  dc.descripcion,
  dc.estatus,
  dc.tabla_origen,
  dc.ruta_frontend,
  dc.metadata,
  dc.fecha_documento,
  dc.fecha_creacion,
  dc.fecha_actualizacion,

  COALESCE(
    nm.tipo_nota,
    NULLIF(dc.metadata->>'tipo_nota', ''),
    NULLIF(dc.metadata->>'tipoNota', ''),
    NULLIF(dc.metadata->'nota'->>'tipo_nota', ''),
    CASE
      WHEN dc.tipo_documento = 'NOTA_EVOLUCION' THEN 'NOTA_EVOLUCION'
      WHEN dc.titulo ILIKE '%evolución%' THEN 'NOTA_EVOLUCION'
      ELSE 'NOTA_INICIAL'
    END
  ) AS tipo_nota
`;

const joinNotasMedicas = `
  LEFT JOIN notas_medicas nm
    ON nm.id_nota = dc.id_origen
    AND (
      dc.tipo_documento IN ('NOTA_MEDICA', 'NOTA_EVOLUCION')
      OR dc.tabla_origen = 'notas_medicas'
    )
`;

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
        ${columnasDocumentoClinico}
      FROM documentos_clinicos dc
      ${joinNotasMedicas}
      WHERE dc.id_fila = $1
      ORDER BY dc.fecha_documento DESC, dc.fecha_creacion DESC
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
        ${columnasDocumentoClinico}
      FROM documentos_clinicos dc
      ${joinNotasMedicas}
      WHERE dc.id_expediente = $1
      ORDER BY dc.fecha_documento DESC, dc.fecha_creacion DESC
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
        ${columnasDocumentoClinico}
      FROM documentos_clinicos dc
      ${joinNotasMedicas}
      WHERE dc.id_documento = $1
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