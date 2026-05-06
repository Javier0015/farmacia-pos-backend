import { pool } from '../config/db.js';

const esDoctor = (usuario) => {
  return String(usuario?.rol || '').toUpperCase() === 'DOCTOR';
};

export const obtenerMiPerfilDoctor = async (req, res) => {
  try {
    if (!esDoctor(req.usuario)) {
      return res.status(403).json({
        ok: false,
        mensaje: 'Solo los doctores pueden consultar este perfil',
      });
    }

    const resultado = await pool.query(
      `
      SELECT
        dp.id_doctor,
        dp.id_usuario,
        u.nombre AS nombre_usuario,
        u.usuario,
        u.correo AS correo_usuario,
        dp.nombre_completo,
        dp.cedula_profesional,
        dp.especialidad,
        dp.telefono,
        dp.correo,
        dp.direccion_consultorio,
        dp.perfil_completo,
        dp.activo,
        dp.fecha_creacion,
        dp.fecha_actualizacion
      FROM doctores_perfiles dp
      INNER JOIN usuarios u ON u.id_usuario = dp.id_usuario
      WHERE dp.id_usuario = $1
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
      perfil: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener perfil de doctor:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener perfil de doctor',
    });
  }
};

export const actualizarMiPerfilDoctor = async (req, res) => {
  try {
    if (!esDoctor(req.usuario)) {
      return res.status(403).json({
        ok: false,
        mensaje: 'Solo los doctores pueden actualizar este perfil',
      });
    }

    const {
      nombre_completo,
      cedula_profesional,
      especialidad,
      telefono,
      correo,
      direccion_consultorio,
    } = req.body;

    if (!nombre_completo || !nombre_completo.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre completo es obligatorio',
      });
    }

    if (!cedula_profesional || !cedula_profesional.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La cédula profesional es obligatoria',
      });
    }

    const resultado = await pool.query(
      `
      UPDATE doctores_perfiles
      SET
        nombre_completo = $1,
        cedula_profesional = $2,
        especialidad = $3,
        telefono = $4,
        correo = $5,
        direccion_consultorio = $6,
        perfil_completo = true,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_usuario = $7
        AND activo = true
      RETURNING
        id_doctor,
        id_usuario,
        nombre_completo,
        cedula_profesional,
        especialidad,
        telefono,
        correo,
        direccion_consultorio,
        perfil_completo,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        nombre_completo.trim(),
        cedula_profesional.trim(),
        especialidad ? especialidad.trim() : null,
        telefono ? telefono.trim() : null,
        correo ? correo.trim() : null,
        direccion_consultorio ? direccion_consultorio.trim() : null,
        req.usuario.id_usuario,
      ]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró el perfil activo del doctor',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Perfil de doctor actualizado correctamente',
      perfil: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar perfil de doctor:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar perfil de doctor',
    });
  }
};

export const listarDoctores = async (req, res) => {
  try {
    const { buscar, completos } = req.query;

    let query = `
      SELECT
        dp.id_doctor,
        dp.id_usuario,
        u.nombre AS nombre_usuario,
        u.usuario,
        u.correo AS correo_usuario,
        dp.nombre_completo,
        dp.cedula_profesional,
        dp.especialidad,
        dp.telefono,
        dp.correo,
        dp.direccion_consultorio,
        dp.perfil_completo,
        dp.activo,
        dp.fecha_creacion,
        dp.fecha_actualizacion
      FROM doctores_perfiles dp
      INNER JOIN usuarios u ON u.id_usuario = dp.id_usuario
      INNER JOIN roles r ON r.id_rol = u.id_rol
      WHERE r.nombre = 'DOCTOR'
    `;

    const params = [];

    if (buscar) {
      params.push(`%${buscar.trim()}%`);
      query += `
        AND (
          u.nombre ILIKE $${params.length}
          OR u.usuario ILIKE $${params.length}
          OR u.correo ILIKE $${params.length}
          OR dp.nombre_completo ILIKE $${params.length}
          OR dp.cedula_profesional ILIKE $${params.length}
          OR dp.especialidad ILIKE $${params.length}
        )
      `;
    }

    if (completos === 'true') {
      query += ` AND dp.perfil_completo = true `;
    }

    if (completos === 'false') {
      query += ` AND dp.perfil_completo = false `;
    }

    query += `
      ORDER BY dp.fecha_creacion DESC
    `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      doctores: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar doctores:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar doctores',
    });
  }
};