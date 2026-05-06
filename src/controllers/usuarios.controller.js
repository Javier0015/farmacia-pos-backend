import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';

const esRolDoctor = (rol) => {
  return String(rol || '').toUpperCase() === 'DOCTOR';
};

const asegurarPerfilDoctor = async ({
  client,
  id_usuario,
  nombre,
  correo,
  activo = true,
}) => {
  await client.query(
    `
    INSERT INTO doctores_perfiles (
      id_usuario,
      nombre_completo,
      correo,
      perfil_completo,
      activo
    )
    VALUES ($1, $2, $3, false, $4)
    ON CONFLICT (id_usuario)
    DO UPDATE SET
      activo = EXCLUDED.activo,
      fecha_actualizacion = CURRENT_TIMESTAMP
    `,
    [
      id_usuario,
      nombre || null,
      correo || null,
      activo,
    ]
  );
};

const desactivarPerfilDoctor = async ({ client, id_usuario }) => {
  await client.query(
    `
    UPDATE doctores_perfiles
    SET
      activo = false,
      fecha_actualizacion = CURRENT_TIMESTAMP
    WHERE id_usuario = $1
    `,
    [id_usuario]
  );
};

export const listarRoles = async (req, res) => {
  try {
    const resultado = await pool.query(
      `
      SELECT
        id_rol,
        nombre,
        descripcion,
        activo,
        fecha_creacion
      FROM roles
      WHERE activo = true
      ORDER BY id_rol ASC
      `
    );

    return res.json({
      ok: true,
      roles: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar roles:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar roles',
    });
  }
};

export const listarUsuarios = async (req, res) => {
  try {
    const { buscar, activos } = req.query;

    let query = `
      SELECT
        u.id_usuario,
        u.nombre,
        u.usuario,
        u.correo,
        u.id_rol,
        r.nombre AS rol,
        u.activo,
        u.fecha_creacion,
        u.fecha_actualizacion,

        dp.id_doctor,
        dp.nombre_completo AS doctor_nombre_completo,
        dp.cedula_profesional AS doctor_cedula_profesional,
        dp.especialidad AS doctor_especialidad,
        dp.perfil_completo AS doctor_perfil_completo,

        COALESCE(
          json_agg(
            json_build_object(
              'id_sucursal', s.id_sucursal,
              'nombre', s.nombre,
              'clave', s.clave
            )
          ) FILTER (WHERE s.id_sucursal IS NOT NULL),
          '[]'
        ) AS sucursales
      FROM usuarios u
      INNER JOIN roles r ON r.id_rol = u.id_rol
      LEFT JOIN doctores_perfiles dp
        ON dp.id_usuario = u.id_usuario
      LEFT JOIN usuario_sucursales us 
        ON us.id_usuario = u.id_usuario
        AND us.activo = true
      LEFT JOIN sucursales s 
        ON s.id_sucursal = us.id_sucursal
      WHERE 1 = 1
    `;

    const params = [];

    if (buscar) {
      params.push(`%${buscar.trim()}%`);
      query += `
        AND (
          u.nombre ILIKE $${params.length}
          OR u.usuario ILIKE $${params.length}
          OR u.correo ILIKE $${params.length}
          OR r.nombre ILIKE $${params.length}
          OR dp.nombre_completo ILIKE $${params.length}
          OR dp.cedula_profesional ILIKE $${params.length}
        )
      `;
    }

    if (activos === 'true') {
      query += ` AND u.activo = true `;
    }

    query += `
      GROUP BY
        u.id_usuario,
        u.nombre,
        u.usuario,
        u.correo,
        u.id_rol,
        r.nombre,
        u.activo,
        u.fecha_creacion,
        u.fecha_actualizacion,
        dp.id_doctor,
        dp.nombre_completo,
        dp.cedula_profesional,
        dp.especialidad,
        dp.perfil_completo
      ORDER BY u.nombre ASC
    `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      usuarios: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar usuarios:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar usuarios',
    });
  }
};

export const crearUsuario = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      nombre,
      usuario,
      correo,
      password,
      id_rol,
      sucursales,
    } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre es obligatorio',
      });
    }

    if (!usuario || !usuario.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El usuario es obligatorio',
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La contraseña debe tener al menos 6 caracteres',
      });
    }

    if (!id_rol) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El rol es obligatorio',
      });
    }

    await client.query('BEGIN');

    const rolExiste = await client.query(
      `
      SELECT
        id_rol,
        nombre
      FROM roles
      WHERE id_rol = $1
        AND activo = true
      `,
      [id_rol]
    );

    if (rolExiste.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Rol no encontrado o inactivo',
      });
    }

    const rolSeleccionado = rolExiste.rows[0].nombre;
    const usuarioEsDoctor = esRolDoctor(rolSeleccionado);

    const sucursalesNormalizadas = Array.isArray(sucursales)
      ? sucursales.filter((idSucursal) => idSucursal !== null && idSucursal !== undefined && idSucursal !== '')
      : [];

    if (!usuarioEsDoctor && sucursalesNormalizadas.length === 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'Debes asignar al menos una sucursal',
      });
    }

    const existeUsuario = await client.query(
      `
      SELECT id_usuario
      FROM usuarios
      WHERE LOWER(usuario) = LOWER($1)
      `,
      [usuario.trim()]
    );

    if (existeUsuario.rows.length > 0) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe un usuario con ese nombre de acceso',
      });
    }

    if (correo && correo.trim()) {
      const existeCorreo = await client.query(
        `
        SELECT id_usuario
        FROM usuarios
        WHERE LOWER(correo) = LOWER($1)
        `,
        [correo.trim()]
      );

      if (existeCorreo.rows.length > 0) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          ok: false,
          mensaje: 'Ya existe un usuario con ese correo',
        });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const usuarioCreado = await client.query(
      `
      INSERT INTO usuarios (
        nombre,
        usuario,
        correo,
        password_hash,
        id_rol,
        activo
      )
      VALUES ($1,$2,$3,$4,$5,true)
      RETURNING
        id_usuario,
        nombre,
        usuario,
        correo,
        id_rol,
        activo,
        fecha_creacion
      `,
      [
        nombre.trim(),
        usuario.trim(),
        correo ? correo.trim() : null,
        passwordHash,
        id_rol,
      ]
    );

    const idUsuarioNuevo = usuarioCreado.rows[0].id_usuario;

    for (const idSucursal of sucursalesNormalizadas) {
      await client.query(
        `
        INSERT INTO usuario_sucursales (
          id_usuario,
          id_sucursal,
          activo
        )
        VALUES ($1,$2,true)
        ON CONFLICT (id_usuario, id_sucursal)
        DO UPDATE SET activo = true
        `,
        [idUsuarioNuevo, idSucursal]
      );
    }

    if (usuarioEsDoctor) {
      await asegurarPerfilDoctor({
        client,
        id_usuario: idUsuarioNuevo,
        nombre: nombre.trim(),
        correo: correo ? correo.trim() : null,
        activo: true,
      });
    }

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: usuarioEsDoctor
        ? 'Cuenta de doctor creada correctamente'
        : 'Usuario creado correctamente',
      usuario: {
        ...usuarioCreado.rows[0],
        rol: rolSeleccionado,
        requiere_completar_perfil_doctor: usuarioEsDoctor,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al crear usuario:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear usuario',
    });
  } finally {
    client.release();
  }
};

export const actualizarUsuario = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    const {
      nombre,
      usuario,
      correo,
      password,
      id_rol,
      sucursales,
      activo,
    } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre es obligatorio',
      });
    }

    if (!usuario || !usuario.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El usuario es obligatorio',
      });
    }

    if (!id_rol) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El rol es obligatorio',
      });
    }

    await client.query('BEGIN');

    const rolExiste = await client.query(
      `
      SELECT
        id_rol,
        nombre
      FROM roles
      WHERE id_rol = $1
        AND activo = true
      `,
      [id_rol]
    );

    if (rolExiste.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Rol no encontrado o inactivo',
      });
    }

    const rolSeleccionado = rolExiste.rows[0].nombre;
    const usuarioEsDoctor = esRolDoctor(rolSeleccionado);

    const sucursalesNormalizadas = Array.isArray(sucursales)
      ? sucursales.filter((idSucursal) => idSucursal !== null && idSucursal !== undefined && idSucursal !== '')
      : [];

    if (!usuarioEsDoctor && sucursalesNormalizadas.length === 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'Debes asignar al menos una sucursal',
      });
    }

    const existeUsuario = await client.query(
      `
      SELECT id_usuario
      FROM usuarios
      WHERE LOWER(usuario) = LOWER($1)
        AND id_usuario <> $2
      `,
      [usuario.trim(), id]
    );

    if (existeUsuario.rows.length > 0) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe otro usuario con ese nombre de acceso',
      });
    }

    if (correo && correo.trim()) {
      const existeCorreo = await client.query(
        `
        SELECT id_usuario
        FROM usuarios
        WHERE LOWER(correo) = LOWER($1)
          AND id_usuario <> $2
        `,
        [correo.trim(), id]
      );

      if (existeCorreo.rows.length > 0) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          ok: false,
          mensaje: 'Ya existe otro usuario con ese correo',
        });
      }
    }

    let query = `
      UPDATE usuarios
      SET
        nombre = $1,
        usuario = $2,
        correo = $3,
        id_rol = $4,
        activo = COALESCE($5, activo),
        fecha_actualizacion = CURRENT_TIMESTAMP
    `;

    const params = [
      nombre.trim(),
      usuario.trim(),
      correo ? correo.trim() : null,
      id_rol,
      activo,
    ];

    if (password && password.trim()) {
      if (password.length < 6) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: 'La nueva contraseña debe tener al menos 6 caracteres',
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      params.push(passwordHash);
      query += `, password_hash = $${params.length}`;
    }

    params.push(id);

    query += `
      WHERE id_usuario = $${params.length}
      RETURNING
        id_usuario,
        nombre,
        usuario,
        correo,
        id_rol,
        activo,
        fecha_creacion,
        fecha_actualizacion
    `;

    const usuarioActualizado = await client.query(query, params);

    if (usuarioActualizado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Usuario no encontrado',
      });
    }

    await client.query(
      `
      UPDATE usuario_sucursales
      SET activo = false
      WHERE id_usuario = $1
      `,
      [id]
    );

    for (const idSucursal of sucursalesNormalizadas) {
      await client.query(
        `
        INSERT INTO usuario_sucursales (
          id_usuario,
          id_sucursal,
          activo
        )
        VALUES ($1,$2,true)
        ON CONFLICT (id_usuario, id_sucursal)
        DO UPDATE SET activo = true
        `,
        [id, idSucursal]
      );
    }

    if (usuarioEsDoctor) {
      await asegurarPerfilDoctor({
        client,
        id_usuario: id,
        nombre: nombre.trim(),
        correo: correo ? correo.trim() : null,
        activo: activo !== false,
      });
    } else {
      await desactivarPerfilDoctor({
        client,
        id_usuario: id,
      });
    }

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: usuarioEsDoctor
        ? 'Cuenta de doctor actualizada correctamente'
        : 'Usuario actualizado correctamente',
      usuario: {
        ...usuarioActualizado.rows[0],
        rol: rolSeleccionado,
        requiere_completar_perfil_doctor: usuarioEsDoctor,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al actualizar usuario:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar usuario',
    });
  } finally {
    client.release();
  }
};

export const desactivarUsuario = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    if (Number(id) === Number(req.usuario?.id_usuario)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'No puedes desactivar tu propio usuario',
      });
    }

    await client.query('BEGIN');

    const resultado = await client.query(
      `
      UPDATE usuarios
      SET
        activo = false,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_usuario = $1
      RETURNING id_usuario, nombre, usuario, activo
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Usuario no encontrado',
      });
    }

    await desactivarPerfilDoctor({
      client,
      id_usuario: id,
    });

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Usuario desactivado correctamente',
      usuario: resultado.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al desactivar usuario:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al desactivar usuario',
    });
  } finally {
    client.release();
  }
};