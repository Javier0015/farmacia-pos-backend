import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

export const login = async (req, res) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Usuario y contraseña son obligatorios',
      });
    }

    const queryUsuario = `
      SELECT 
        u.id_usuario,
        u.nombre,
        u.usuario,
        u.correo,
        u.password_hash,
        u.activo,
        r.id_rol,
        r.nombre AS rol,

        dp.id_doctor,
        dp.nombre_completo AS doctor_nombre_completo,
        dp.cedula_profesional AS doctor_cedula_profesional,
        dp.especialidad AS doctor_especialidad,
        dp.telefono AS doctor_telefono,
        dp.correo AS doctor_correo,
        dp.direccion_consultorio AS doctor_direccion_consultorio,
        dp.perfil_completo AS doctor_perfil_completo,
        dp.activo AS doctor_activo
      FROM usuarios u
      LEFT JOIN roles r 
        ON r.id_rol = u.id_rol
      LEFT JOIN doctores_perfiles dp
        ON dp.id_usuario = u.id_usuario
      WHERE LOWER(u.usuario) = LOWER($1)
      LIMIT 1
    `;

    const resultado = await pool.query(queryUsuario, [usuario.trim()]);

    if (resultado.rows.length === 0) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario o contraseña incorrectos',
      });
    }

    const usuarioDB = resultado.rows[0];

    if (!usuarioDB.activo) {
      return res.status(403).json({
        ok: false,
        mensaje: 'El usuario está desactivado',
      });
    }

    const passwordValido = await bcrypt.compare(
      password,
      usuarioDB.password_hash
    );

    if (!passwordValido) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario o contraseña incorrectos',
      });
    }

    const esDoctor = String(usuarioDB.rol || '').toUpperCase() === 'DOCTOR';

    if (esDoctor && usuarioDB.doctor_activo === false) {
      return res.status(403).json({
        ok: false,
        mensaje: 'El perfil de doctor está desactivado',
      });
    }

    const sucursalesQuery = `
      SELECT 
        s.id_sucursal,
        s.nombre,
        s.clave
      FROM usuario_sucursales us
      INNER JOIN sucursales s 
        ON s.id_sucursal = us.id_sucursal
      WHERE us.id_usuario = $1
        AND us.activo = true
      ORDER BY s.nombre ASC
    `;

    const sucursalesResultado = await pool.query(sucursalesQuery, [
      usuarioDB.id_usuario,
    ]);

    const doctor = esDoctor
      ? {
          id_doctor: usuarioDB.id_doctor,
          nombre_completo: usuarioDB.doctor_nombre_completo,
          cedula_profesional: usuarioDB.doctor_cedula_profesional,
          especialidad: usuarioDB.doctor_especialidad,
          telefono: usuarioDB.doctor_telefono,
          correo: usuarioDB.doctor_correo,
          direccion_consultorio: usuarioDB.doctor_direccion_consultorio,
          perfil_completo: usuarioDB.doctor_perfil_completo === true,
          activo: usuarioDB.doctor_activo !== false,
        }
      : null;

    const requiereCompletarPerfilDoctor =
      esDoctor && doctor && doctor.perfil_completo !== true;

    const token = jwt.sign(
      {
        id_usuario: usuarioDB.id_usuario,
        usuario: usuarioDB.usuario,
        id_rol: usuarioDB.id_rol,
        rol: usuarioDB.rol,
        es_doctor: esDoctor,
        id_doctor: doctor?.id_doctor || null,
        requiere_completar_perfil_doctor: requiereCompletarPerfilDoctor,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      }
    );

    return res.json({
      ok: true,
      mensaje: 'Login correcto',
      token,
      usuario: {
        id_usuario: usuarioDB.id_usuario,
        nombre: usuarioDB.nombre,
        usuario: usuarioDB.usuario,
        correo: usuarioDB.correo,
        id_rol: usuarioDB.id_rol,
        rol: usuarioDB.rol,
        sucursales: sucursalesResultado.rows,
        es_doctor: esDoctor,
        doctor,
        requiere_completar_perfil_doctor: requiereCompletarPerfilDoctor,
      },
    });
  } catch (error) {
    console.error('Error en login:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno en el servidor',
    });
  }
};

export const perfil = async (req, res) => {
  try {
    const queryUsuario = `
      SELECT
        u.id_usuario,
        u.nombre,
        u.usuario,
        u.correo,
        u.activo,
        r.id_rol,
        r.nombre AS rol,

        dp.id_doctor,
        dp.nombre_completo AS doctor_nombre_completo,
        dp.cedula_profesional AS doctor_cedula_profesional,
        dp.especialidad AS doctor_especialidad,
        dp.telefono AS doctor_telefono,
        dp.correo AS doctor_correo,
        dp.direccion_consultorio AS doctor_direccion_consultorio,
        dp.perfil_completo AS doctor_perfil_completo,
        dp.activo AS doctor_activo
      FROM usuarios u
      LEFT JOIN roles r
        ON r.id_rol = u.id_rol
      LEFT JOIN doctores_perfiles dp
        ON dp.id_usuario = u.id_usuario
      WHERE u.id_usuario = $1
      LIMIT 1
    `;

    const resultado = await pool.query(queryUsuario, [
      req.usuario.id_usuario,
    ]);

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Usuario no encontrado',
      });
    }

    const usuarioDB = resultado.rows[0];
    const esDoctor = String(usuarioDB.rol || '').toUpperCase() === 'DOCTOR';

    const sucursalesQuery = `
      SELECT 
        s.id_sucursal,
        s.nombre,
        s.clave
      FROM usuario_sucursales us
      INNER JOIN sucursales s 
        ON s.id_sucursal = us.id_sucursal
      WHERE us.id_usuario = $1
        AND us.activo = true
      ORDER BY s.nombre ASC
    `;

    const sucursalesResultado = await pool.query(sucursalesQuery, [
      usuarioDB.id_usuario,
    ]);

    const doctor = esDoctor
      ? {
          id_doctor: usuarioDB.id_doctor,
          nombre_completo: usuarioDB.doctor_nombre_completo,
          cedula_profesional: usuarioDB.doctor_cedula_profesional,
          especialidad: usuarioDB.doctor_especialidad,
          telefono: usuarioDB.doctor_telefono,
          correo: usuarioDB.doctor_correo,
          direccion_consultorio: usuarioDB.doctor_direccion_consultorio,
          perfil_completo: usuarioDB.doctor_perfil_completo === true,
          activo: usuarioDB.doctor_activo !== false,
        }
      : null;

    const requiereCompletarPerfilDoctor =
      esDoctor && doctor && doctor.perfil_completo !== true;

    return res.json({
      ok: true,
      mensaje: 'Perfil obtenido correctamente',
      usuario: {
        id_usuario: usuarioDB.id_usuario,
        nombre: usuarioDB.nombre,
        usuario: usuarioDB.usuario,
        correo: usuarioDB.correo,
        id_rol: usuarioDB.id_rol,
        rol: usuarioDB.rol,
        sucursales: sucursalesResultado.rows,
        es_doctor: esDoctor,
        doctor,
        requiere_completar_perfil_doctor: requiereCompletarPerfilDoctor,
      },
    });
  } catch (error) {
    console.error('Error al obtener perfil:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno en el servidor',
    });
  }
};