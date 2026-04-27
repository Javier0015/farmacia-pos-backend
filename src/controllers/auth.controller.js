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
        r.nombre AS rol
      FROM usuarios u
      LEFT JOIN roles r ON r.id_rol = u.id_rol
      WHERE u.usuario = $1
      LIMIT 1
    `;

    const resultado = await pool.query(queryUsuario, [usuario]);

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

    const passwordValido = await bcrypt.compare(password, usuarioDB.password_hash);

    if (!passwordValido) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario o contraseña incorrectos',
      });
    }

    const sucursalesQuery = `
      SELECT 
        s.id_sucursal,
        s.nombre,
        s.clave
      FROM usuario_sucursal us
      INNER JOIN sucursales s ON s.id_sucursal = us.id_sucursal
      WHERE us.id_usuario = $1
      ORDER BY s.nombre ASC
    `;

    const sucursalesResultado = await pool.query(sucursalesQuery, [
      usuarioDB.id_usuario,
    ]);

    const token = jwt.sign(
      {
        id_usuario: usuarioDB.id_usuario,
        usuario: usuarioDB.usuario,
        id_rol: usuarioDB.id_rol,
        rol: usuarioDB.rol,
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
    return res.json({
      ok: true,
      mensaje: 'Perfil obtenido correctamente',
      usuario: req.usuario,
    });
  } catch (error) {
    console.error('Error al obtener perfil:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno en el servidor',
    });
  }
};