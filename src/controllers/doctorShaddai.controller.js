import { pool } from '../config/db.js';
import fs from 'fs';
import path from 'path';

const obtenerIdUsuarioAutenticado = (req) => {
  return Number(req.usuario?.id_usuario || req.usuario?.id || 0);
};

const obtenerRolUsuarioAutenticado = (req) => {
  return String(
    req.usuario?.rol ||
    req.usuario?.nombre_rol ||
    req.usuario?.tipo_usuario ||
    req.usuario?.rol_usuario ||
    ''
  )
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
};

const esSuperAdministrador = (req) => {
  const rolUsuario = obtenerRolUsuarioAutenticado(req);

  return rolUsuario === 'SUPER_ADMIN' || rolUsuario === 'SUPERADMIN';
};

const esUsuarioCajeroOAdmin = (req) => {
  const rolUsuario = obtenerRolUsuarioAutenticado(req);

  return [
    'CAJERO',
    'CAJA',
    'ADMIN_SUCURSAL',
    'ADMINISTRADOR_SUCURSAL',
    'ADMINISTRADOR',
    'ADMIN',
    'SUPER_ADMIN',
    'SUPERADMIN',
  ].includes(rolUsuario);
};

const normalizarIdSucursal = (valor) => {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return null;
  }

  const idSucursal = Number(valor);

  return Number.isInteger(idSucursal) && idSucursal > 0
    ? idSucursal
    : null;
};

const obtenerSucursalesDesdeToken = (usuario = {}) => {
  const ids = [];

  const posiblesIds = [
    usuario.id_sucursal,
    usuario.sucursal_id,
    usuario.idSucursal,
    usuario.sucursal?.id_sucursal,
    usuario.sucursal?.id,
  ];

  posiblesIds.forEach((valor) => {
    const idSucursal = normalizarIdSucursal(valor);

    if (idSucursal) {
      ids.push(idSucursal);
    }
  });

  const sucursales =
    usuario.sucursales ||
    usuario.sucursales_asignadas ||
    usuario.sucursalesAsignadas ||
    usuario.sucursales_ids ||
    [];

  if (Array.isArray(sucursales)) {
    sucursales.forEach((sucursal) => {
      const valor =
        typeof sucursal === 'number' || typeof sucursal === 'string'
          ? sucursal
          : sucursal?.id_sucursal ||
            sucursal?.id ||
            sucursal?.sucursal_id;

      const idSucursal = normalizarIdSucursal(valor);

      if (idSucursal) {
        ids.push(idSucursal);
      }
    });
  }

  return [...new Set(ids)];
};

const obtenerSucursalesAsignadasUsuario = async (req) => {
  const idUsuario = obtenerIdUsuarioAutenticado(req);
  const ids = new Set(obtenerSucursalesDesdeToken(req.usuario));

  if (!idUsuario) {
    return [...ids];
  }

  const consultas = [
    `
      SELECT id_sucursal
      FROM usuario_sucursales
      WHERE id_usuario = $1
        AND COALESCE(activo, true) = true
    `,
    `
      SELECT id_sucursal
      FROM usuarios_sucursales
      WHERE id_usuario = $1
    `,
    `
      SELECT id_sucursal
      FROM usuarios
      WHERE id_usuario = $1
        AND id_sucursal IS NOT NULL
    `,
  ];

  for (const consulta of consultas) {
    try {
      const { rows } = await pool.query(consulta, [idUsuario]);

      rows.forEach((row) => {
        const idSucursal = normalizarIdSucursal(row.id_sucursal);

        if (idSucursal) {
          ids.add(idSucursal);
        }
      });
    } catch (error) {
      // El proyecto puede utilizar solo una de estas tablas de asignación.
    }
  }

  return [...ids].sort((a, b) => a - b);
};

const obtenerIdSucursalSolicitada = (req) => {
  const valor = req.query?.id_sucursal ?? req.body?.id_sucursal ?? null;

  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return null;
  }

  return normalizarIdSucursal(valor);
};

const validarAccesoSucursalServicio = async (req, idSucursal) => {
  if (!idSucursal || esSuperAdministrador(req)) {
    return true;
  }

  const sucursalesPermitidas = await obtenerSucursalesAsignadasUsuario(req);

  return sucursalesPermitidas.includes(Number(idSucursal));
};


export const subirLogoUniversidadDoctor = async (req, res) => {
  try {
    const idUsuario =
      req.usuario?.id_usuario ||
      req.usuario?.id ||
      req.user?.id_usuario ||
      req.user?.id;

    if (!idUsuario) {
      return res.status(401).json({
        ok: false,
        mensaje: 'No se pudo identificar al usuario autenticado.',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Debes seleccionar una imagen.',
      });
    }

    const logoUniversidadUrl = `/uploads/doctor-shaddai/logos-universidad/${req.file.filename}`;

    /*
      IMPORTANTE:
      Cambia doctores_shaddai_perfiles por el nombre real de tu tabla
      si en tu proyecto se llama diferente.
    */
    const perfilActual = await pool.query(
      `
        SELECT logo_universidad_url
        FROM doctores_shaddai_perfiles
        WHERE id_usuario = $1
        LIMIT 1
      `,
      [idUsuario]
    );

    if (perfilActual.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró el perfil del doctor.',
      });
    }

    const result = await pool.query(
      `
        UPDATE doctores_shaddai_perfiles
        SET
          logo_universidad_url = $1,
          fecha_actualizacion = NOW()
        WHERE id_usuario = $2
        RETURNING *
      `,
      [logoUniversidadUrl, idUsuario]
    );

    const logoAnterior = perfilActual.rows[0]?.logo_universidad_url;

    if (
      logoAnterior &&
      logoAnterior.startsWith('/uploads/doctor-shaddai/logos-universidad/')
    ) {
      const rutaAnterior = path.resolve(
        process.cwd(),
        logoAnterior.replace(/^\/uploads\//, 'uploads/')
      );

      fs.unlink(rutaAnterior, (error) => {
        if (error && error.code !== 'ENOENT') {
          console.warn('No se pudo eliminar el logo anterior:', error.message);
        }
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Logo de universidad actualizado correctamente.',
      logo_universidad_url: logoUniversidadUrl,
      perfil: result.rows[0],
    });
  } catch (error) {
    console.error('Error al subir logo de universidad:', error);

    return res.status(500).json({
      ok: false,
      mensaje:
        error.message ||
        'No se pudo subir el logo de universidad.',
    });
  }
};

const limpiarTexto = (valor) => {
  if (valor === undefined || valor === null) return null;

  const limpio = String(valor).trim();

  return limpio === '' ? null : limpio;
};

const limpiarNumero = (valor) => {
  if (valor === undefined || valor === null || valor === '') return null;

  const numero = Number(valor);

  return Number.isNaN(numero) ? null : numero;
};

const limpiarBooleano = (valor) => {
  return valor === true || valor === 'true' || valor === 1 || valor === '1';
};

const obtenerIdSucursalDesdeUsuario = (req, idSucursalBody = null) => {
  const idSucursalUsuario =
    req.usuario?.id_sucursal ||
    req.usuario?.sucursal_id ||
    req.usuario?.idSucursal ||
    null;

  return idSucursalBody || idSucursalUsuario || null;
};

const obtenerIdSucursalDoctor = async (client, req, idUsuario, idSucursalBody = null) => {
  const idSucursalUsuario =
    req.usuario?.id_sucursal ||
    req.usuario?.sucursal_id ||
    req.usuario?.idSucursal ||
    null;

  if (idSucursalBody) return Number(idSucursalBody);
  if (idSucursalUsuario) return Number(idSucursalUsuario);

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

/**
 * Crear expediente clínico
 */
export const crearExpedienteClinico = async (req, res) => {
  try {
    const {
      nombre_paciente,
      primer_apellido,
      segundo_apellido,
      curp,
      telefono,
      sexo,
      fecha_nacimiento,
      edad,
      direccion,
      correo,
      nacionalidad,
      entidad_nacimiento,

      contacto_emergencia_nombre,
      contacto_emergencia_telefono,
      contacto_emergencia_parentesco,

      enfermedades_condiciones,
      alergias,
      medicamentos_actuales,
      observaciones_generales,

      tipo_sangre,
      peso_kg,
      talla_cm,
      imc,
      presion_arterial,
      frecuencia_cardiaca,
      temperatura,
      saturacion_oxigeno,

      antecedentes_heredofamiliares,
      antecedentes_personales_patologicos,
      antecedentes_personales_no_patologicos,
      antecedentes_quirurgicos,
      antecedentes_traumaticos,
      antecedentes_gineco_obstetricos,

      motivo_consulta,
      padecimiento_actual,
      exploracion_fisica,
      diagnostico_inicial,
      plan_tratamiento,

      acepta_tratamiento_datos,
      fecha_consentimiento,

      id_sucursal,
    } = req.body;

    if (!limpiarTexto(nombre_paciente)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del paciente es obligatorio.',
      });
    }

    if (!limpiarTexto(primer_apellido)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El primer apellido del paciente es obligatorio.',
      });
    }

    if (curp && String(curp).trim().length !== 18) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La CURP debe tener 18 caracteres.',
      });
    }

    const aceptaDatos = limpiarBooleano(acepta_tratamiento_datos);

    if (!aceptaDatos) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'Debes confirmar el consentimiento para tratamiento de datos personales.',
      });
    }

    const id_doctor = obtenerIdUsuarioAutenticado(req) || null;
    const idSucursalFinal = obtenerIdSucursalDesdeUsuario(req, id_sucursal);

    const query = `
      INSERT INTO expedientes_clinicos (
        nombre_paciente,
        primer_apellido,
        segundo_apellido,
        curp,
        telefono,
        sexo,
        fecha_nacimiento,
        edad,
        direccion,
        correo,
        nacionalidad,
        entidad_nacimiento,

        contacto_emergencia_nombre,
        contacto_emergencia_telefono,
        contacto_emergencia_parentesco,

        enfermedades_condiciones,
        alergias,
        medicamentos_actuales,
        observaciones_generales,

        tipo_sangre,
        peso_kg,
        talla_cm,
        imc,
        presion_arterial,
        frecuencia_cardiaca,
        temperatura,
        saturacion_oxigeno,

        antecedentes_heredofamiliares,
        antecedentes_personales_patologicos,
        antecedentes_personales_no_patologicos,
        antecedentes_quirurgicos,
        antecedentes_traumaticos,
        antecedentes_gineco_obstetricos,

        motivo_consulta,
        padecimiento_actual,
        exploracion_fisica,
        diagnostico_inicial,
        plan_tratamiento,

        acepta_tratamiento_datos,
        fecha_consentimiento,

        id_doctor,
        id_sucursal
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25,
        $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35,
        $36, $37, $38, $39, $40,
        $41, $42
      )
      RETURNING *;
    `;

    const values = [
      limpiarTexto(nombre_paciente),
      limpiarTexto(primer_apellido),
      limpiarTexto(segundo_apellido),
      limpiarTexto(curp)?.toUpperCase() || null,
      limpiarTexto(telefono),
      limpiarTexto(sexo),
      fecha_nacimiento || null,
      limpiarNumero(edad),
      limpiarTexto(direccion),
      limpiarTexto(correo),
      limpiarTexto(nacionalidad),
      limpiarTexto(entidad_nacimiento),

      limpiarTexto(contacto_emergencia_nombre),
      limpiarTexto(contacto_emergencia_telefono),
      limpiarTexto(contacto_emergencia_parentesco),

      limpiarTexto(enfermedades_condiciones),
      limpiarTexto(alergias),
      limpiarTexto(medicamentos_actuales),
      limpiarTexto(observaciones_generales),

      limpiarTexto(tipo_sangre),
      limpiarNumero(peso_kg),
      limpiarNumero(talla_cm),
      limpiarNumero(imc),
      limpiarTexto(presion_arterial),
      limpiarNumero(frecuencia_cardiaca),
      limpiarNumero(temperatura),
      limpiarNumero(saturacion_oxigeno),

      limpiarTexto(antecedentes_heredofamiliares),
      limpiarTexto(antecedentes_personales_patologicos),
      limpiarTexto(antecedentes_personales_no_patologicos),
      limpiarTexto(antecedentes_quirurgicos),
      limpiarTexto(antecedentes_traumaticos),
      limpiarTexto(antecedentes_gineco_obstetricos),

      limpiarTexto(motivo_consulta),
      limpiarTexto(padecimiento_actual),
      limpiarTexto(exploracion_fisica),
      limpiarTexto(diagnostico_inicial),
      limpiarTexto(plan_tratamiento),

      aceptaDatos,
      fecha_consentimiento || new Date(),

      id_doctor,
      idSucursalFinal,
    ];

    const { rows } = await pool.query(query, values);

    return res.status(201).json({
      ok: true,
      mensaje: 'Expediente clínico creado correctamente.',
      expediente: rows[0],
    });
  } catch (error) {
    console.error('Error al crear expediente clínico:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al crear el expediente clínico.',
      error: error.message,
    });
  }
};

/**
 * Listar expedientes clínicos
 */
export const listarExpedientesClinicos = async (req, res) => {
  try {
    const { busqueda = '' } = req.query;
    const textoBusqueda = String(busqueda || '').trim();

    const query = `
      SELECT 
        ec.*,
        u.nombre AS nombre_doctor,
        s.nombre AS nombre_sucursal
      FROM expedientes_clinicos ec
      LEFT JOIN usuarios u ON u.id_usuario = ec.id_doctor
      LEFT JOIN sucursales s ON s.id_sucursal = ec.id_sucursal
      WHERE ec.activo = true
        AND (
          $1 = ''
          OR ec.nombre_paciente ILIKE '%' || $1 || '%'
          OR ec.primer_apellido ILIKE '%' || $1 || '%'
          OR ec.segundo_apellido ILIKE '%' || $1 || '%'
          OR ec.curp ILIKE '%' || $1 || '%'
          OR ec.telefono ILIKE '%' || $1 || '%'
          OR ec.correo ILIKE '%' || $1 || '%'
          OR CONCAT_WS(
            ' ',
            ec.nombre_paciente,
            ec.primer_apellido,
            ec.segundo_apellido
          ) ILIKE '%' || $1 || '%'
        )
      ORDER BY ec.fecha_creacion DESC;
    `;

    const { rows } = await pool.query(query, [textoBusqueda]);

    return res.json({
      ok: true,
      expedientes: rows,
    });
  } catch (error) {
    console.error('Error al listar expedientes clínicos:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al listar los expedientes clínicos.',
      error: error.message,
    });
  }
};

/**
 * Obtener expediente clínico por ID
 */
export const obtenerExpedienteClinicoPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        ec.*,
        u.nombre AS nombre_doctor,
        s.nombre AS nombre_sucursal
      FROM expedientes_clinicos ec
      LEFT JOIN usuarios u ON u.id_usuario = ec.id_doctor
      LEFT JOIN sucursales s ON s.id_sucursal = ec.id_sucursal
      WHERE ec.id_expediente = $1
        AND ec.activo = true;
    `;

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Expediente clínico no encontrado.',
      });
    }

    return res.json({
      ok: true,
      expediente: rows[0],
    });
  } catch (error) {
    console.error('Error al obtener expediente clínico:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al obtener el expediente clínico.',
      error: error.message,
    });
  }
};

/**
 * Actualizar expediente clínico
 */
export const actualizarExpedienteClinico = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      nombre_paciente,
      primer_apellido,
      segundo_apellido,
      curp,
      telefono,
      sexo,
      fecha_nacimiento,
      edad,
      direccion,
      correo,
      nacionalidad,
      entidad_nacimiento,

      contacto_emergencia_nombre,
      contacto_emergencia_telefono,
      contacto_emergencia_parentesco,

      enfermedades_condiciones,
      alergias,
      medicamentos_actuales,
      observaciones_generales,

      tipo_sangre,
      peso_kg,
      talla_cm,
      imc,
      presion_arterial,
      frecuencia_cardiaca,
      temperatura,
      saturacion_oxigeno,

      antecedentes_heredofamiliares,
      antecedentes_personales_patologicos,
      antecedentes_personales_no_patologicos,
      antecedentes_quirurgicos,
      antecedentes_traumaticos,
      antecedentes_gineco_obstetricos,

      motivo_consulta,
      padecimiento_actual,
      exploracion_fisica,
      diagnostico_inicial,
      plan_tratamiento,

      acepta_tratamiento_datos,
      fecha_consentimiento,

      id_sucursal,
    } = req.body;

    if (!limpiarTexto(nombre_paciente)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del paciente es obligatorio.',
      });
    }

    if (!limpiarTexto(primer_apellido)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El primer apellido del paciente es obligatorio.',
      });
    }

    if (curp && String(curp).trim().length !== 18) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La CURP debe tener 18 caracteres.',
      });
    }

    const aceptaDatos = limpiarBooleano(acepta_tratamiento_datos);

    if (!aceptaDatos) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'Debes confirmar el consentimiento para tratamiento de datos personales.',
      });
    }

    const idSucursalFinal = obtenerIdSucursalDesdeUsuario(req, id_sucursal);

    const query = `
      UPDATE expedientes_clinicos
      SET
        nombre_paciente = $1,
        primer_apellido = $2,
        segundo_apellido = $3,
        curp = $4,
        telefono = $5,
        sexo = $6,
        fecha_nacimiento = $7,
        edad = $8,
        direccion = $9,
        correo = $10,
        nacionalidad = $11,
        entidad_nacimiento = $12,

        contacto_emergencia_nombre = $13,
        contacto_emergencia_telefono = $14,
        contacto_emergencia_parentesco = $15,

        enfermedades_condiciones = $16,
        alergias = $17,
        medicamentos_actuales = $18,
        observaciones_generales = $19,

        tipo_sangre = $20,
        peso_kg = $21,
        talla_cm = $22,
        imc = $23,
        presion_arterial = $24,
        frecuencia_cardiaca = $25,
        temperatura = $26,
        saturacion_oxigeno = $27,

        antecedentes_heredofamiliares = $28,
        antecedentes_personales_patologicos = $29,
        antecedentes_personales_no_patologicos = $30,
        antecedentes_quirurgicos = $31,
        antecedentes_traumaticos = $32,
        antecedentes_gineco_obstetricos = $33,

        motivo_consulta = $34,
        padecimiento_actual = $35,
        exploracion_fisica = $36,
        diagnostico_inicial = $37,
        plan_tratamiento = $38,

        acepta_tratamiento_datos = $39,
        fecha_consentimiento = COALESCE($40, fecha_consentimiento),

        id_sucursal = $41,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_expediente = $42
        AND activo = true
      RETURNING *;
    `;

    const values = [
      limpiarTexto(nombre_paciente),
      limpiarTexto(primer_apellido),
      limpiarTexto(segundo_apellido),
      limpiarTexto(curp)?.toUpperCase() || null,
      limpiarTexto(telefono),
      limpiarTexto(sexo),
      fecha_nacimiento || null,
      limpiarNumero(edad),
      limpiarTexto(direccion),
      limpiarTexto(correo),
      limpiarTexto(nacionalidad),
      limpiarTexto(entidad_nacimiento),

      limpiarTexto(contacto_emergencia_nombre),
      limpiarTexto(contacto_emergencia_telefono),
      limpiarTexto(contacto_emergencia_parentesco),

      limpiarTexto(enfermedades_condiciones),
      limpiarTexto(alergias),
      limpiarTexto(medicamentos_actuales),
      limpiarTexto(observaciones_generales),

      limpiarTexto(tipo_sangre),
      limpiarNumero(peso_kg),
      limpiarNumero(talla_cm),
      limpiarNumero(imc),
      limpiarTexto(presion_arterial),
      limpiarNumero(frecuencia_cardiaca),
      limpiarNumero(temperatura),
      limpiarNumero(saturacion_oxigeno),

      limpiarTexto(antecedentes_heredofamiliares),
      limpiarTexto(antecedentes_personales_patologicos),
      limpiarTexto(antecedentes_personales_no_patologicos),
      limpiarTexto(antecedentes_quirurgicos),
      limpiarTexto(antecedentes_traumaticos),
      limpiarTexto(antecedentes_gineco_obstetricos),

      limpiarTexto(motivo_consulta),
      limpiarTexto(padecimiento_actual),
      limpiarTexto(exploracion_fisica),
      limpiarTexto(diagnostico_inicial),
      limpiarTexto(plan_tratamiento),

      aceptaDatos,
      aceptaDatos ? fecha_consentimiento || new Date() : null,

      idSucursalFinal,
      id,
    ];

    const { rows } = await pool.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Expediente clínico no encontrado.',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Expediente clínico actualizado correctamente.',
      expediente: rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar expediente clínico:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al actualizar el expediente clínico.',
      error: error.message,
    });
  }
};

/**
 * Desactivar expediente clínico
 */
export const eliminarExpedienteClinico = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      UPDATE expedientes_clinicos
      SET
        activo = false,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_expediente = $1
        AND activo = true
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Expediente clínico no encontrado.',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Expediente clínico eliminado correctamente.',
    });
  } catch (error) {
    console.error('Error al eliminar expediente clínico:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al eliminar el expediente clínico.',
      error: error.message,
    });
  }
};

/**
 * Obtener mi perfil Doctor Shaddai
 */
export const obtenerMiPerfilDoctorShaddai = async (req, res) => {
  try {
    const idUsuario = obtenerIdUsuarioAutenticado(req);

    if (!idUsuario) {
      return res.status(401).json({
        ok: false,
        mensaje: 'No se pudo identificar al usuario autenticado.',
      });
    }

    const query = `
      SELECT 
        dsp.*,
        u.nombre AS nombre_usuario,
        u.correo AS correo_usuario
      FROM doctores_shaddai_perfiles dsp
      LEFT JOIN usuarios u ON u.id_usuario = dsp.id_usuario
      WHERE dsp.id_usuario = $1
        AND dsp.activo = true
      LIMIT 1;
    `;

    const { rows } = await pool.query(query, [idUsuario]);

    if (rows.length === 0) {
      return res.json({
        ok: true,
        perfil: {
          id_usuario: idUsuario,
          nombre_completo: req.usuario?.nombre || '',
          cedula_profesional: '',
          especialidad: '',
          telefono: '',
          correo: req.usuario?.correo || '',
          direccion_consultorio: '',
          observaciones: '',
          perfil_completo: false,
        },
      });
    }

    return res.json({
      ok: true,
      perfil: rows[0],
    });
  } catch (error) {
    console.error('Error al obtener perfil Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al obtener el perfil de Doctor Shaddai.',
      error: error.message,
    });
  }
};

/**
 * Actualizar mi perfil Doctor Shaddai
 */
export const actualizarMiPerfilDoctorShaddai = async (req, res) => {
  try {
    const idUsuario = obtenerIdUsuarioAutenticado(req);

    if (!idUsuario) {
      return res.status(401).json({
        ok: false,
        mensaje: 'No se pudo identificar al usuario autenticado.',
      });
    }

    const {
      nombre_completo,
      cedula_profesional,
      especialidad,
      telefono,
      correo,
      direccion_consultorio,
      observaciones,
    } = req.body;

    if (!nombre_completo || !nombre_completo.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre completo es obligatorio.',
      });
    }

    if (!cedula_profesional || !cedula_profesional.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La cédula profesional es obligatoria.',
      });
    }

    if (!especialidad || !especialidad.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La especialidad es obligatoria.',
      });
    }

    const perfilCompleto = true;

    const query = `
      INSERT INTO doctores_shaddai_perfiles (
        id_usuario,
        nombre_completo,
        cedula_profesional,
        especialidad,
        telefono,
        correo,
        direccion_consultorio,
        observaciones,
        perfil_completo,
        activo
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, true
      )
      ON CONFLICT (id_usuario)
      DO UPDATE SET
        nombre_completo = EXCLUDED.nombre_completo,
        cedula_profesional = EXCLUDED.cedula_profesional,
        especialidad = EXCLUDED.especialidad,
        telefono = EXCLUDED.telefono,
        correo = EXCLUDED.correo,
        direccion_consultorio = EXCLUDED.direccion_consultorio,
        observaciones = EXCLUDED.observaciones,
        perfil_completo = EXCLUDED.perfil_completo,
        activo = true,
        fecha_actualizacion = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const values = [
      idUsuario,
      nombre_completo.trim(),
      cedula_profesional.trim(),
      especialidad.trim(),
      telefono?.trim() || null,
      correo?.trim() || null,
      direccion_consultorio?.trim() || null,
      observaciones?.trim() || null,
      perfilCompleto,
    ];

    const { rows } = await pool.query(query, values);

    return res.json({
      ok: true,
      mensaje: 'Perfil Doctor Shaddai actualizado correctamente.',
      perfil: rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar perfil Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al actualizar el perfil de Doctor Shaddai.',
      error: error.message,
    });
  }
};


/**
 * Normaliza el tipo de detalle de receta.
 *
 * INVENTARIO: medicamento ligado a un producto del catálogo; puede tener
 * existencia o no al momento de la prescripción.
 *
 * LIBRE: medicamento prescrito por el doctor que no existe en el inventario.
 * No debe agregarse automáticamente a una venta ni descontar existencias.
 */
const normalizarTipoProductoReceta = (producto = {}) => {
  const tipoSolicitado = String(
    producto.tipo_producto_receta || ''
  )
    .trim()
    .toUpperCase();

  const productoLibre =
    limpiarBooleano(producto.producto_libre) ||
    tipoSolicitado === 'LIBRE' ||
    (!producto.id_producto && tipoSolicitado !== 'INVENTARIO');

  return productoLibre ? 'LIBRE' : 'INVENTARIO';
};

const normalizarDisponibleInventario = (
  producto = {},
  tipoProductoReceta = 'INVENTARIO'
) => {
  if (tipoProductoReceta === 'LIBRE') {
    return false;
  }

  const valor = producto.disponible_inventario;

  if (valor === undefined || valor === null || valor === '') {
    return Number(producto.stock || 0) > 0;
  }

  return limpiarBooleano(valor);
};

const normalizarProductoReceta = (producto = {}) => {
  const tipoProductoReceta = normalizarTipoProductoReceta(producto);
  const productoLibre = tipoProductoReceta === 'LIBRE';

  const cantidad = limpiarNumero(producto.cantidad);
  const stockCapturado = Math.max(0, Number(producto.stock || 0));
  const precioCapturado = Math.max(0, Number(producto.precio || 0));

  return {
    id_producto: productoLibre ? null : limpiarNumero(producto.id_producto),
    id_sucursal: productoLibre ? null : limpiarNumero(producto.id_sucursal),

    tipo_producto_receta: tipoProductoReceta,
    producto_libre: productoLibre,
    disponible_inventario: normalizarDisponibleInventario(
      producto,
      tipoProductoReceta
    ),

    nombre: limpiarTexto(producto.nombre),
    nombre_generico: limpiarTexto(producto.nombre_generico),
    forma_farmaceutica: limpiarTexto(producto.forma_farmaceutica),
    presentacion: limpiarTexto(producto.presentacion),
    codigo_barras: productoLibre ? null : limpiarTexto(producto.codigo_barras),

    sucursal: productoLibre ? null : limpiarTexto(producto.sucursal),
    lote: productoLibre ? null : limpiarTexto(producto.lote),
    fecha_caducidad: productoLibre ? null : producto.fecha_caducidad || null,

    cantidad,
    stock: productoLibre ? 0 : stockCapturado,
    precio: productoLibre ? 0 : precioCapturado,

    dosis: limpiarTexto(producto.dosis),
    frecuencia: limpiarTexto(producto.frecuencia),
    duracion: limpiarTexto(producto.duracion),
    indicaciones: limpiarTexto(producto.indicaciones),
  };
};

/**
 * Generar folio de receta
 */
const generarFolioReceta = async (client) => {
  const fecha = new Date();
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  const fechaFolio = `${yyyy}${mm}${dd}`;

  const folioResult = await client.query(
    `
    SELECT COUNT(*)::int AS total
    FROM recetas_shaddai
    WHERE TO_CHAR(fecha_creacion, 'YYYYMMDD') = $1;
    `,
    [fechaFolio]
  );

  const consecutivo = Number(folioResult.rows[0]?.total || 0) + 1;

  return `RX-${fechaFolio}-${String(consecutivo).padStart(6, '0')}`;
};

/**
 * Crear receta Doctor Shaddai
 */
export const crearRecetaDoctorShaddai = async (req, res) => {
  const client = await pool.connect();

  try {
    const idDoctor = obtenerIdUsuarioAutenticado(req) || null;

    const {
      paciente,
      productos,
      id_paciente_expediente,
      id_fila = null,
      id_fila_atencion = null,
      id_sucursal = null,
      diagnostico = null,
      observaciones = null,
    } = req.body;

    if (!idDoctor) {
      return res.status(401).json({
        ok: false,
        mensaje: 'No se pudo identificar al doctor autenticado.',
      });
    }

    if (!paciente) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Los datos del paciente son obligatorios.',
      });
    }

    if (!limpiarTexto(paciente.nombre_paciente)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del paciente es obligatorio.',
      });
    }

    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La receta debe contener al menos un medicamento.',
      });
    }

    /*
      La receta es una prescripción clínica, por lo que puede contener:
      - Productos del inventario, incluso sin existencia actual.
      - Medicamentos libres, que no están en el catálogo de la farmacia.
    */
    const productosNormalizados = productos.map(normalizarProductoReceta);

    const productosInvalidos = productosNormalizados.filter((producto) => {
      if (!producto.nombre || !producto.cantidad || producto.cantidad <= 0) {
        return true;
      }

      // Un producto de inventario siempre debe conservar su referencia.
      if (
        producto.tipo_producto_receta === 'INVENTARIO' &&
        !producto.id_producto
      ) {
        return true;
      }

      return false;
    });

    if (productosInvalidos.length > 0) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'Todos los medicamentos deben tener nombre y cantidad válida. Los productos de inventario deben conservar su identificador.',
      });
    }

    await client.query('BEGIN');

    const perfilDoctorResult = await client.query(
      `
      SELECT
        id_perfil,
        id_usuario,
        nombre_completo,
        cedula_profesional,
        especialidad,
        telefono,
        correo,
        direccion_consultorio,
        observaciones,
        perfil_completo
      FROM doctores_shaddai_perfiles
      WHERE id_usuario = $1
        AND activo = true
      LIMIT 1;
      `,
      [idDoctor]
    );

    if (perfilDoctorResult.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        codigo: 'PERFIL_DOCTOR_INCOMPLETO',
        mensaje:
          'Debes completar tu perfil de Doctor Shaddai antes de generar recetas.',
      });
    }

    const perfilDoctor = perfilDoctorResult.rows[0];

    if (
      perfilDoctor.perfil_completo !== true ||
      !perfilDoctor.nombre_completo ||
      !perfilDoctor.cedula_profesional ||
      !perfilDoctor.especialidad
    ) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        codigo: 'PERFIL_DOCTOR_INCOMPLETO',
        mensaje:
          'Debes completar tu perfil de Doctor Shaddai antes de generar recetas.',
      });
    }

    if (id_paciente_expediente) {
      const expedienteResult = await client.query(
        `
        SELECT id_expediente
        FROM expedientes_clinicos
        WHERE id_expediente = $1
          AND activo = true
        LIMIT 1;
        `,
        [id_paciente_expediente]
      );

      if (expedienteResult.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: 'El expediente seleccionado no existe o está inactivo.',
        });
      }
    }

    const idFilaFinal =
      limpiarNumero(id_fila) ||
      limpiarNumero(id_fila_atencion) ||
      null;

    const idSucursalFinal = await obtenerIdSucursalDoctor(
      client,
      req,
      idDoctor,
      id_sucursal
    );

    if (!idSucursalFinal) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'No se pudo determinar la sucursal donde se generará la receta.',
      });
    }

    const diagnosticoFinal =
      limpiarTexto(diagnostico) ||
      limpiarTexto(paciente?.diagnostico) ||
      null;

    const observacionesFinal =
      limpiarTexto(observaciones) ||
      limpiarTexto(paciente?.observaciones) ||
      null;

    const folioReceta = await generarFolioReceta(client);

    const queryReceta = `
      INSERT INTO recetas_shaddai (
        id_doctor,
        id_paciente_expediente,
        id_sucursal,
        nombre_paciente,
        telefono_paciente,
        edad_paciente,
        sexo_paciente,
        diagnostico,
        observaciones,
        estatus,
        folio_receta
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDIENTE_CAJERO', $10
      )
      RETURNING *;
    `;

    const valuesReceta = [
      idDoctor,
      id_paciente_expediente || null,
      idSucursalFinal,
      limpiarTexto(paciente.nombre_paciente),
      limpiarTexto(paciente.telefono),
      limpiarNumero(paciente.edad),
      limpiarTexto(paciente.sexo),
      diagnosticoFinal,
      observacionesFinal,
      folioReceta,
    ];

    const recetaResult = await client.query(queryReceta, valuesReceta);
    const receta = recetaResult.rows[0];

    const detallesInsertados = [];

    for (const producto of productosNormalizados) {
      const queryDetalle = `
        INSERT INTO recetas_shaddai_detalle (
          id_receta,
          id_producto,
          id_sucursal,
          nombre_producto,
          codigo_barras,
          sucursal_nombre,
          lote,
          fecha_caducidad,
          cantidad,
          stock_disponible,
          dosis,
          frecuencia,
          duracion,
          indicaciones,
          precio_unitario,
          tipo_producto_receta,
          producto_libre,
          disponible_inventario
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18
        )
        RETURNING *;
      `;

      const valuesDetalle = [
        receta.id_receta,
        producto.id_producto,
        producto.id_sucursal,
        producto.nombre,
        producto.codigo_barras,
        producto.sucursal,
        producto.lote,
        producto.fecha_caducidad,
        producto.cantidad,
        producto.stock,
        producto.dosis,
        producto.frecuencia,
        producto.duracion,
        producto.indicaciones,
        producto.precio,
        producto.tipo_producto_receta,
        producto.producto_libre,
        producto.disponible_inventario,
      ];

      const detalleResult = await client.query(queryDetalle, valuesDetalle);
      detallesInsertados.push(detalleResult.rows[0]);
    }

    const totalMedicamentosLibres = detallesInsertados.filter(
      (detalle) =>
        detalle.producto_libre === true ||
        detalle.tipo_producto_receta === 'LIBRE' ||
        !detalle.id_producto
    ).length;

    const totalProductosInventario =
      detallesInsertados.length - totalMedicamentosLibres;

    const documentoClinico = await registrarDocumentoClinico(client, {
      id_expediente: id_paciente_expediente || null,
      id_fila: idFilaFinal,
      id_doctor: idDoctor,
      id_sucursal: idSucursalFinal,

      tipo_documento: 'RECETA',
      id_origen: receta.id_receta,
      folio: receta.folio_receta,
      titulo: 'Receta médica',
      descripcion: diagnosticoFinal || observacionesFinal || 'Receta médica',
      estatus: receta.estatus || 'PENDIENTE_CAJERO',

      tabla_origen: 'recetas_shaddai',
      ruta_frontend: `/app/doctor-shaddai/recetas?id_receta=${receta.id_receta}`,

      metadata: {
        nombre_paciente: receta.nombre_paciente,
        telefono_paciente: receta.telefono_paciente,
        edad_paciente: receta.edad_paciente,
        sexo_paciente: receta.sexo_paciente,
        diagnostico: diagnosticoFinal,
        observaciones: observacionesFinal,
        total_productos: detallesInsertados.length,
        total_productos_inventario: totalProductosInventario,
        total_medicamentos_libres: totalMedicamentosLibres,
        total_piezas: detallesInsertados.reduce(
          (total, item) => total + Number(item.cantidad || 0),
          0
        ),
      },
    });

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Receta generada correctamente.',
      receta,
      detalles: detallesInsertados,
      doctor: perfilDoctor,
      documento_clinico: documentoClinico,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error al hacer rollback:', rollbackError);
    }

    console.error('Error al crear receta Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al generar la receta.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};


/**
 * Generar folio de servicio clínico
 */
const generarFolioServicioClinico = async (client) => {
  const fecha = new Date();
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  const fechaFolio = `${yyyy}${mm}${dd}`;

  const folioResult = await client.query(
    `
    SELECT COUNT(*)::int AS total
    FROM servicios_clinicos_solicitudes
    WHERE TO_CHAR(fecha_creacion, 'YYYYMMDD') = $1;
    `,
    [fechaFolio]
  );

  const consecutivo = Number(folioResult.rows[0]?.total || 0) + 1;

  return `SERV-${fechaFolio}-${String(consecutivo).padStart(6, '0')}`;
};



/**
 * Crear solicitud de servicio clínico Doctor Shaddai
 */
export const crearServicioClinicoDoctorShaddai = async (req, res) => {
  const client = await pool.connect();

  try {
    const idDoctor = obtenerIdUsuarioAutenticado(req) || null;

    const {
      paciente,
      servicios,
      id_paciente_expediente,
      id_fila = null,
      id_fila_atencion = null,
      id_sucursal = null,
      diagnostico = null,
      observaciones = null,
    } = req.body;

    if (!idDoctor) {
      return res.status(401).json({
        ok: false,
        mensaje: 'No se pudo identificar al doctor autenticado.',
      });
    }

    if (!paciente) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Los datos del paciente son obligatorios.',
      });
    }

    if (!paciente.nombre_paciente || !paciente.nombre_paciente.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del paciente es obligatorio.',
      });
    }

    if (!Array.isArray(servicios) || servicios.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Debes agregar al menos un servicio clínico.',
      });
    }

    const serviciosInvalidos = servicios.filter((servicio) => {
      return (
        !servicio.id_servicio ||
        !servicio.nombre_servicio ||
        !servicio.cantidad ||
        Number(servicio.cantidad) <= 0
      );
    });

    if (serviciosInvalidos.length > 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Todos los servicios deben tener nombre y cantidad válida.',
      });
    }

    await client.query('BEGIN');

    const perfilDoctorResult = await client.query(
      `
      SELECT
        id_perfil,
        id_usuario,
        nombre_completo,
        cedula_profesional,
        especialidad,
        telefono,
        correo,
        direccion_consultorio,
        observaciones,
        perfil_completo
      FROM doctores_shaddai_perfiles
      WHERE id_usuario = $1
        AND activo = true
      LIMIT 1;
      `,
      [idDoctor]
    );

    if (perfilDoctorResult.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        codigo: 'PERFIL_DOCTOR_INCOMPLETO',
        mensaje:
          'Debes completar tu perfil de Doctor Shaddai antes de generar servicios clínicos.',
      });
    }

    const perfilDoctor = perfilDoctorResult.rows[0];

    if (
      perfilDoctor.perfil_completo !== true ||
      !perfilDoctor.nombre_completo ||
      !perfilDoctor.cedula_profesional ||
      !perfilDoctor.especialidad
    ) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        codigo: 'PERFIL_DOCTOR_INCOMPLETO',
        mensaje:
          'Debes completar tu perfil de Doctor Shaddai antes de generar servicios clínicos.',
      });
    }

    if (id_paciente_expediente) {
      const expedienteResult = await client.query(
        `
        SELECT id_expediente
        FROM expedientes_clinicos
        WHERE id_expediente = $1
          AND activo = true
        LIMIT 1;
        `,
        [id_paciente_expediente]
      );

      if (expedienteResult.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: 'El expediente seleccionado no existe o está inactivo.',
        });
      }
    }

    const idFilaFinal =
      limpiarNumero(id_fila) ||
      limpiarNumero(id_fila_atencion) ||
      null;

    const idSucursalFinal = await obtenerIdSucursalDoctor(
      client,
      req,
      idDoctor,
      id_sucursal
    );

    if (!idSucursalFinal) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje:
          'No se pudo determinar la sucursal donde se generará el servicio clínico.',
      });
    }

    const diagnosticoFinal =
      limpiarTexto(diagnostico) ||
      limpiarTexto(paciente?.diagnostico) ||
      null;

    const observacionesFinal =
      limpiarTexto(observaciones) ||
      limpiarTexto(paciente?.observaciones) ||
      null;

    const folioServicio = await generarFolioServicioClinico(client);

    let totalServicio = 0;

    const serviciosNormalizados = servicios.map((servicio) => {
      const cantidad = Number(servicio.cantidad || 1);
      const precioUnitario = Number(servicio.precio_unitario ?? servicio.precio ?? 0);
      const subtotal = Number((cantidad * precioUnitario).toFixed(2));

      totalServicio += subtotal;

      return {
        id_servicio: Number(servicio.id_servicio),
        id_producto: servicio.id_producto ? Number(servicio.id_producto) : null,
        nombre_servicio: limpiarTexto(servicio.nombre_servicio),
        cantidad,
        precio_unitario: precioUnitario,
        subtotal,
        indicaciones: limpiarTexto(servicio.indicaciones),
        observaciones: limpiarTexto(servicio.observaciones),
      };
    });

    totalServicio = Number(totalServicio.toFixed(2));

    const querySolicitud = `
      INSERT INTO servicios_clinicos_solicitudes (
        id_paciente_expediente,
        id_fila,
        id_sucursal,
        id_doctor,
        folio_servicio,
        nombre_paciente,
        telefono_paciente,
        edad_paciente,
        sexo_paciente,
        diagnostico,
        observaciones,
        estatus,
        total
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11,
        'PENDIENTE_CAJERO',
        $12
      )
      RETURNING *;
    `;

    const valuesSolicitud = [
      id_paciente_expediente || null,
      idFilaFinal,
      idSucursalFinal,
      idDoctor,
      folioServicio,
      paciente.nombre_paciente.trim(),
      paciente.telefono?.trim() || null,
      paciente.edad ? Number(paciente.edad) : null,
      paciente.sexo || null,
      diagnosticoFinal,
      observacionesFinal,
      totalServicio,
    ];

    const solicitudResult = await client.query(querySolicitud, valuesSolicitud);
    const solicitud = solicitudResult.rows[0];

    const detallesInsertados = [];

    for (const servicio of serviciosNormalizados) {
      const servicioDbResult = await client.query(
        `
        SELECT
          id_servicio,
          nombre,
          descripcion,
          precio,
          requiere_producto,
          activo
        FROM cat_servicios_clinicos
        WHERE id_servicio = $1
          AND activo = true
        LIMIT 1;
        `,
        [servicio.id_servicio]
      );

      if (servicioDbResult.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          ok: false,
          mensaje: `El servicio clínico ${servicio.id_servicio} no existe o está inactivo.`,
        });
      }

      const servicioCatalogo = servicioDbResult.rows[0];

      const requiereProducto =
        servicioCatalogo.requiere_producto === true ||
        servicioCatalogo.requiere_producto === 'true';

      if (requiereProducto && !servicio.id_producto) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          ok: false,
          mensaje: `El servicio ${servicioCatalogo.nombre} requiere seleccionar un producto relacionado.`,
        });
      }

      const queryDetalle = `
        INSERT INTO servicios_clinicos_solicitudes_detalle (
          id_solicitud_servicio,
          id_servicio,
          id_producto,
          nombre_servicio,
          cantidad,
          precio_unitario,
          subtotal,
          indicaciones,
          observaciones
        )
        VALUES (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8, $9
        )
        RETURNING *;
      `;

      const valuesDetalle = [
        solicitud.id_solicitud_servicio,
        servicio.id_servicio,
        servicio.id_producto,
        servicio.nombre_servicio || servicioCatalogo.nombre,
        servicio.cantidad,
        servicio.precio_unitario,
        servicio.subtotal,
        servicio.indicaciones,
        servicio.observaciones,
      ];

      const detalleResult = await client.query(queryDetalle, valuesDetalle);
      detallesInsertados.push(detalleResult.rows[0]);
    }

    const documentoClinico = await registrarDocumentoClinico(client, {
      id_expediente: id_paciente_expediente || null,
      id_fila: idFilaFinal,
      id_doctor: idDoctor,
      id_sucursal: idSucursalFinal,

      tipo_documento: 'SERVICIO_CLINICO',
      id_origen: solicitud.id_solicitud_servicio,
      folio: solicitud.folio_servicio,
      titulo: 'Servicio clínico',
      descripcion:
        diagnosticoFinal ||
        observacionesFinal ||
        detallesInsertados.map((item) => item.nombre_servicio).join(', ') ||
        'Servicio clínico',
      estatus: solicitud.estatus || 'PENDIENTE_CAJERO',

      tabla_origen: 'servicios_clinicos_solicitudes',
      ruta_frontend: `/app/doctor-shaddai/servicios-clinicos?id_solicitud_servicio=${solicitud.id_solicitud_servicio}`,

      metadata: {
        nombre_paciente: solicitud.nombre_paciente,
        telefono_paciente: solicitud.telefono_paciente,
        edad_paciente: solicitud.edad_paciente,
        sexo_paciente: solicitud.sexo_paciente,
        diagnostico: diagnosticoFinal,
        observaciones: observacionesFinal,
        total_servicios: detallesInsertados.length,
        total: solicitud.total,
      },
    });

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Servicio clínico generado correctamente.',
      solicitud,
      detalles: detallesInsertados,
      doctor: perfilDoctor,
      documento_clinico: documentoClinico,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error al hacer rollback:', rollbackError);
    }

    console.error('Error al crear servicio clínico Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al generar el servicio clínico.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

/**
 * Listar servicios clínicos Doctor Shaddai
 *
 * Para caja y administradores de sucursal, id_sucursal es obligatorio:
 * GET /doctor-shaddai/servicios-clinicos?estatus=PENDIENTE_CAJERO&id_sucursal=2
 *
 * Esto evita que una caja visualice servicios generados en otra sucursal.
 */
export const listarServiciosClinicosDoctorShaddai = async (req, res) => {
  try {
    const { estatus, busqueda, id_sucursal } = req.query;

    const seEnvioSucursal =
      id_sucursal !== undefined &&
      id_sucursal !== null &&
      String(id_sucursal).trim() !== '';

    const idSucursalFiltro = normalizarIdSucursal(id_sucursal);

    if (seEnvioSucursal && !idSucursalFiltro) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sucursal seleccionada no es válida.',
      });
    }

    const idUsuario = obtenerIdUsuarioAutenticado(req);
    const esCajeroOAdmin = esUsuarioCajeroOAdmin(req);
    const esSuperAdmin = esSuperAdministrador(req);

    if (esCajeroOAdmin && !esSuperAdmin && !idSucursalFiltro) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'Debes indicar la sucursal activa para consultar servicios clínicos desde caja.',
      });
    }

    if (
      idSucursalFiltro &&
      esCajeroOAdmin &&
      !esSuperAdmin &&
      !(await validarAccesoSucursalServicio(req, idSucursalFiltro))
    ) {
      return res.status(403).json({
        ok: false,
        mensaje: 'No tienes acceso a la sucursal seleccionada.',
      });
    }

    const filtros = ['s.activo = true'];
    const valores = [];

    if (idSucursalFiltro) {
      valores.push(idSucursalFiltro);
      filtros.push(`s.id_sucursal = $${valores.length}`);
    }

    if (!esCajeroOAdmin) {
      valores.push(idUsuario);
      filtros.push(`s.id_doctor = $${valores.length}`);
    }

    if (estatus) {
      const estatusLista = String(estatus)
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);

      if (estatusLista.length > 0) {
        valores.push(estatusLista);
        filtros.push(`s.estatus = ANY($${valores.length}::text[])`);
      }
    }

    if (busqueda && String(busqueda).trim()) {
      valores.push(`%${String(busqueda).trim()}%`);

      filtros.push(`
        (
          s.folio_servicio ILIKE $${valores.length}
          OR s.nombre_paciente ILIKE $${valores.length}
          OR s.telefono_paciente ILIKE $${valores.length}
          OR s.diagnostico ILIKE $${valores.length}
          OR s.observaciones ILIKE $${valores.length}
          OR dsp.nombre_completo ILIKE $${valores.length}
          OR dsp.especialidad ILIKE $${valores.length}
          OR su.nombre ILIKE $${valores.length}
        )
      `);
    }

    const where = `WHERE ${filtros.join(' AND ')}`;

    const resultado = await pool.query(
      `
      SELECT
        s.id_solicitud_servicio,
        s.id_paciente_expediente,
        s.id_fila,
        s.id_sucursal,
        s.id_doctor,
        s.folio_servicio,
        s.nombre_paciente,
        s.telefono_paciente,
        s.edad_paciente,
        s.sexo_paciente,
        s.diagnostico,
        s.observaciones,
        s.estatus,
        s.total,
        s.fecha_creacion,
        s.fecha_actualizacion,
        s.fecha_pago,
        s.fecha_realizado,
        s.activo,

        su.nombre AS nombre_sucursal,

        dsp.nombre_completo AS nombre_doctor,
        dsp.nombre_completo AS nombre_doctor_shaddai,
        dsp.cedula_profesional,
        dsp.especialidad,

        COUNT(sd.id_detalle_servicio)::int AS total_servicios,
        COALESCE(SUM(sd.cantidad), 0)::numeric AS total_cantidad

      FROM servicios_clinicos_solicitudes s
      LEFT JOIN sucursales su
        ON su.id_sucursal = s.id_sucursal
      LEFT JOIN doctores_shaddai_perfiles dsp
        ON dsp.id_usuario = s.id_doctor
       AND dsp.activo = true
      LEFT JOIN servicios_clinicos_solicitudes_detalle sd
        ON sd.id_solicitud_servicio = s.id_solicitud_servicio
       AND sd.activo = true
      ${where}
      GROUP BY
        s.id_solicitud_servicio,
        su.nombre,
        dsp.nombre_completo,
        dsp.cedula_profesional,
        dsp.especialidad
      ORDER BY s.fecha_creacion DESC;
      `,
      valores
    );

    return res.json({
      ok: true,
      id_sucursal: idSucursalFiltro || null,
      servicios: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar servicios clínicos Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar servicios clínicos.',
      error: error.message,
    });
  }
};

/**
 * Obtener servicio clínico Doctor Shaddai por ID.
 *
 * La caja debe enviar la sucursal activa:
 * GET /doctor-shaddai/servicios-clinicos/:id?id_sucursal=2
 */
export const obtenerServicioClinicoDoctorShaddaiPorId = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_sucursal } = req.query;

    const seEnvioSucursal =
      id_sucursal !== undefined &&
      id_sucursal !== null &&
      String(id_sucursal).trim() !== '';

    const idSucursalFiltro = normalizarIdSucursal(id_sucursal);

    if (seEnvioSucursal && !idSucursalFiltro) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sucursal seleccionada no es válida.',
      });
    }

    const idUsuario = obtenerIdUsuarioAutenticado(req);
    const esCajeroOAdmin = esUsuarioCajeroOAdmin(req);
    const esSuperAdmin = esSuperAdministrador(req);

    if (esCajeroOAdmin && !esSuperAdmin && !idSucursalFiltro) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'Debes indicar la sucursal activa para consultar el detalle del servicio desde caja.',
      });
    }

    if (
      idSucursalFiltro &&
      esCajeroOAdmin &&
      !esSuperAdmin &&
      !(await validarAccesoSucursalServicio(req, idSucursalFiltro))
    ) {
      return res.status(403).json({
        ok: false,
        mensaje: 'No tienes acceso a la sucursal seleccionada.',
      });
    }

    const filtros = ['s.id_solicitud_servicio = $1', 's.activo = true'];
    const valores = [id];

    if (idSucursalFiltro) {
      valores.push(idSucursalFiltro);
      filtros.push(`s.id_sucursal = $${valores.length}`);
    }

    if (!esCajeroOAdmin) {
      valores.push(idUsuario);
      filtros.push(`s.id_doctor = $${valores.length}`);
    }

    const solicitudResult = await pool.query(
      `
      SELECT
        s.*,
        su.nombre AS nombre_sucursal,
        u.nombre AS nombre_doctor_usuario,
        dsp.nombre_completo AS nombre_doctor,
        dsp.cedula_profesional,
        dsp.especialidad,
        dsp.telefono AS telefono_doctor,
        dsp.correo AS correo_doctor,
        dsp.direccion_consultorio
      FROM servicios_clinicos_solicitudes s
      LEFT JOIN sucursales su
        ON su.id_sucursal = s.id_sucursal
      LEFT JOIN usuarios u
        ON u.id_usuario = s.id_doctor
      LEFT JOIN doctores_shaddai_perfiles dsp
        ON dsp.id_usuario = s.id_doctor
       AND dsp.activo = true
      WHERE ${filtros.join(' AND ')}
      LIMIT 1;
      `,
      valores
    );

    if (solicitudResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje:
          'Servicio clínico no encontrado o no corresponde a la sucursal seleccionada.',
      });
    }

    const detalleResult = await pool.query(
      `
      SELECT
        sd.id_detalle_servicio,
        sd.id_solicitud_servicio,
        sd.id_servicio,
        sd.id_producto,
        sd.nombre_servicio,
        sd.cantidad,
        sd.precio_unitario,
        sd.subtotal,
        sd.indicaciones,
        sd.observaciones,
        sd.activo,
        sd.fecha_creacion,

        cs.descripcion AS descripcion_catalogo,
        cs.requiere_producto,

        p.nombre AS nombre_producto,
        p.codigo_barras

      FROM servicios_clinicos_solicitudes_detalle sd
      LEFT JOIN cat_servicios_clinicos cs
        ON cs.id_servicio = sd.id_servicio
      LEFT JOIN productos p
        ON p.id_producto = sd.id_producto
      WHERE sd.id_solicitud_servicio = $1
        AND sd.activo = true
      ORDER BY sd.id_detalle_servicio ASC;
      `,
      [id]
    );

    return res.json({
      ok: true,
      solicitud: solicitudResult.rows[0],
      detalles: detalleResult.rows,
    });
  } catch (error) {
    console.error('Error al obtener servicio clínico Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al obtener el servicio clínico.',
      error: error.message,
    });
  }
};

/**
 * Cancelar servicio clínico Doctor Shaddai.
 *
 * Un doctor conserva la cancelación de sus propios servicios. Para caja o
 * administración se exige la sucursal activa como protección adicional.
 */
export const cancelarServicioClinicoDoctorShaddai = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_sucursal } = req.query;

    const seEnvioSucursal =
      id_sucursal !== undefined &&
      id_sucursal !== null &&
      String(id_sucursal).trim() !== '';

    const idSucursalFiltro = normalizarIdSucursal(id_sucursal);

    if (seEnvioSucursal && !idSucursalFiltro) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sucursal seleccionada no es válida.',
      });
    }

    const idUsuario = obtenerIdUsuarioAutenticado(req);
    const esCajeroOAdmin = esUsuarioCajeroOAdmin(req);
    const esSuperAdmin = esSuperAdministrador(req);

    if (esCajeroOAdmin && !esSuperAdmin && !idSucursalFiltro) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'Debes indicar la sucursal activa para cancelar un servicio desde caja.',
      });
    }

    if (
      idSucursalFiltro &&
      esCajeroOAdmin &&
      !esSuperAdmin &&
      !(await validarAccesoSucursalServicio(req, idSucursalFiltro))
    ) {
      return res.status(403).json({
        ok: false,
        mensaje: 'No tienes acceso a la sucursal seleccionada.',
      });
    }

    const valores = [id];
    const filtros = [
      'id_solicitud_servicio = $1',
      'activo = true',
      `estatus NOT IN ('PAGADO', 'REALIZADO', 'CANCELADO')`,
    ];

    if (idSucursalFiltro) {
      valores.push(idSucursalFiltro);
      filtros.push(`id_sucursal = $${valores.length}`);
    }

    if (!esCajeroOAdmin) {
      valores.push(idUsuario);
      filtros.push(`id_doctor = $${valores.length}`);
    }

    const resultado = await pool.query(
      `
      UPDATE servicios_clinicos_solicitudes
      SET
        estatus = 'CANCELADO',
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE ${filtros.join(' AND ')}
      RETURNING *;
      `,
      valores
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje:
          'Servicio clínico no encontrado, ya fue cobrado/realizado o no corresponde a tu sucursal.',
      });
    }

    await pool.query(
      `
      UPDATE documentos_clinicos
      SET
        estatus = 'CANCELADO',
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE tabla_origen = 'servicios_clinicos_solicitudes'
        AND id_origen = $1;
      `,
      [id]
    );

    return res.json({
      ok: true,
      mensaje: 'Servicio clínico cancelado correctamente.',
      solicitud: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al cancelar servicio clínico Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al cancelar el servicio clínico.',
      error: error.message,
    });
  }
};

/**
 * Listar recetas Doctor Shaddai
 */
export const listarRecetasDoctorShaddai = async (req, res) => {
  try {
    const { estatus, busqueda, id_sucursal } = req.query;

    const filtros = [];
    const valores = [];

    filtros.push('r.activo = true');

    const idSucursalFiltro = limpiarNumero(id_sucursal);

    if (idSucursalFiltro) {
      valores.push(idSucursalFiltro);
      filtros.push(`r.id_sucursal = $${valores.length}`);
    }

    const idUsuario = obtenerIdUsuarioAutenticado(req);
    const esCajeroOAdmin = esUsuarioCajeroOAdmin(req);

    if (!esCajeroOAdmin) {
      valores.push(idUsuario);
      filtros.push(`r.id_doctor = $${valores.length}`);
    }

    if (estatus) {
      const estatusLista = String(estatus)
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);

      if (estatusLista.length > 0) {
        valores.push(estatusLista);
        filtros.push(`r.estatus = ANY($${valores.length}::text[])`);
      }
    }

    if (busqueda && String(busqueda).trim()) {
      valores.push(`%${String(busqueda).trim()}%`);

      filtros.push(`
        (
          r.folio_receta ILIKE $${valores.length}
          OR r.nombre_paciente ILIKE $${valores.length}
          OR r.telefono_paciente ILIKE $${valores.length}
          OR r.diagnostico ILIKE $${valores.length}
          OR r.observaciones ILIKE $${valores.length}
          OR dsp.nombre_completo ILIKE $${valores.length}
          OR dsp.especialidad ILIKE $${valores.length}
        )
      `);
    }

    const where = filtros.length > 0 ? `WHERE ${filtros.join(' AND ')}` : '';

    const resultado = await pool.query(
      `
      SELECT
        r.id_receta,
        r.id_doctor,
        r.id_paciente_expediente,
        r.id_sucursal,
        r.nombre_paciente,
        r.telefono_paciente,
        r.edad_paciente,
        r.sexo_paciente,
        r.diagnostico,
        r.observaciones,
        r.estatus,
        r.fecha_creacion,
        r.fecha_actualizacion,
        r.activo,
        r.folio_receta,
        r.fecha_surtida,
        r.fecha_finalizacion,
        r.finalizada_por,
        r.motivo_finalizacion,

        dsp.nombre_completo AS nombre_doctor,
        dsp.nombre_completo AS nombre_doctor_shaddai,
        dsp.cedula_profesional,
        dsp.especialidad,

        COUNT(rd.id_detalle)::int AS total_productos,
        COUNT(rd.id_detalle) FILTER (
          WHERE COALESCE(rd.producto_libre, false) = true
             OR COALESCE(rd.tipo_producto_receta, 'INVENTARIO') = 'LIBRE'
             OR rd.id_producto IS NULL
        )::int AS total_medicamentos_libres,
        COUNT(rd.id_detalle) FILTER (
          WHERE rd.id_producto IS NOT NULL
            AND COALESCE(rd.producto_libre, false) = false
            AND COALESCE(rd.tipo_producto_receta, 'INVENTARIO') <> 'LIBRE'
        )::int AS total_productos_inventario,
        COALESCE(SUM(rd.cantidad), 0)::numeric AS total_piezas

      FROM recetas_shaddai r
      LEFT JOIN doctores_shaddai_perfiles dsp
        ON dsp.id_usuario = r.id_doctor
       AND dsp.activo = true
      LEFT JOIN recetas_shaddai_detalle rd
        ON rd.id_receta = r.id_receta
       AND rd.activo = true
      ${where}
      GROUP BY
        r.id_receta,
        dsp.nombre_completo,
        dsp.cedula_profesional,
        dsp.especialidad
      ORDER BY r.fecha_creacion DESC
      `,
      valores
    );

    return res.json({
      ok: true,
      recetas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar recetas Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar recetas',
      error: error.message,
    });
  }
};

/**
 * Obtener receta Doctor Shaddai por ID
 */
export const obtenerRecetaDoctorShaddaiPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const idUsuario = obtenerIdUsuarioAutenticado(req);
    const esCajeroOAdmin = esUsuarioCajeroOAdmin(req);

    const filtros = ['r.id_receta = $1', 'r.activo = true'];
    const valores = [id];

    if (!esCajeroOAdmin) {
      valores.push(idUsuario);
      filtros.push(`r.id_doctor = $${valores.length}`);
    }

    const queryReceta = `
      SELECT
        r.*,
        u.nombre AS nombre_doctor_usuario,
        dsp.nombre_completo AS nombre_doctor,
        dsp.cedula_profesional,
        dsp.especialidad,
        dsp.telefono AS telefono_doctor,
        dsp.correo AS correo_doctor,
        dsp.direccion_consultorio
      FROM recetas_shaddai r
      LEFT JOIN usuarios u
        ON u.id_usuario = r.id_doctor
      LEFT JOIN doctores_shaddai_perfiles dsp
        ON dsp.id_usuario = r.id_doctor
       AND dsp.activo = true
      WHERE ${filtros.join(' AND ')}
      LIMIT 1;
    `;

    const recetaResult = await pool.query(queryReceta, valores);

    if (recetaResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Receta no encontrada o no tienes permiso para verla.',
      });
    }

    const queryDetalle = `
      SELECT
        rd.id_detalle,
        rd.id_receta,
        rd.id_producto,
        rd.id_sucursal,
        rd.nombre_producto,
        rd.codigo_barras,
        rd.sucursal_nombre,
        rd.lote,
        rd.fecha_caducidad,
        rd.cantidad AS cantidad_recetada,
        rd.cantidad,
        rd.stock_disponible,
        rd.dosis,
        rd.frecuencia,
        rd.duracion,
        rd.indicaciones,
        rd.precio_unitario,

        COALESCE(rd.tipo_producto_receta, 'INVENTARIO') AS tipo_producto_receta,
        COALESCE(rd.producto_libre, false) AS producto_libre,
        COALESCE(rd.disponible_inventario, true) AS disponible_inventario,

        CASE
          WHEN COALESCE(rd.producto_libre, false) = true
            OR COALESCE(rd.tipo_producto_receta, 'INVENTARIO') = 'LIBRE'
            OR rd.id_producto IS NULL
          THEN false
          ELSE true
        END AS surtible_desde_inventario,

        CASE
          WHEN COALESCE(rd.producto_libre, false) = true
            OR COALESCE(rd.tipo_producto_receta, 'INVENTARIO') = 'LIBRE'
            OR rd.id_producto IS NULL
          THEN 'Medicamento libre / no registrado en inventario.'
          ELSE NULL
        END AS motivo_no_surtible,

        rd.activo,
        rd.fecha_creacion,

        COALESCE(SUM(vd.cantidad), 0)::numeric AS cantidad_surtida,

        CASE
          WHEN COALESCE(rd.producto_libre, false) = true
            OR COALESCE(rd.tipo_producto_receta, 'INVENTARIO') = 'LIBRE'
            OR rd.id_producto IS NULL
          THEN 0::numeric
          ELSE GREATEST(
            rd.cantidad - COALESCE(SUM(vd.cantidad), 0),
            0
          )::numeric
        END AS cantidad_pendiente,

        CASE
          WHEN COALESCE(rd.producto_libre, false) = true
            OR COALESCE(rd.tipo_producto_receta, 'INVENTARIO') = 'LIBRE'
            OR rd.id_producto IS NULL
          THEN false
          WHEN COALESCE(SUM(vd.cantidad), 0) >= rd.cantidad
          THEN true
          ELSE false
        END AS surtido_completo,

        CASE
          WHEN COALESCE(rd.producto_libre, false) = true
            OR COALESCE(rd.tipo_producto_receta, 'INVENTARIO') = 'LIBRE'
            OR rd.id_producto IS NULL
          THEN false
          WHEN COALESCE(SUM(vd.cantidad), 0) > 0
           AND COALESCE(SUM(vd.cantidad), 0) < rd.cantidad
          THEN true
          ELSE false
        END AS surtido_parcial

      FROM recetas_shaddai_detalle rd
      LEFT JOIN venta_detalle vd
        ON vd.id_detalle_receta_shaddai = rd.id_detalle
      WHERE rd.id_receta = $1
        AND rd.activo = true
      GROUP BY
        rd.id_detalle,
        rd.id_receta,
        rd.id_producto,
        rd.id_sucursal,
        rd.nombre_producto,
        rd.codigo_barras,
        rd.sucursal_nombre,
        rd.lote,
        rd.fecha_caducidad,
        rd.cantidad,
        rd.stock_disponible,
        rd.dosis,
        rd.frecuencia,
        rd.duracion,
        rd.indicaciones,
        rd.precio_unitario,
        rd.tipo_producto_receta,
        rd.producto_libre,
        rd.disponible_inventario,
        rd.activo,
        rd.fecha_creacion
      ORDER BY rd.id_detalle ASC;
    `;

    const detalleResult = await pool.query(queryDetalle, [id]);

    return res.json({
      ok: true,
      receta: recetaResult.rows[0],
      detalles: detalleResult.rows,
    });
  } catch (error) {
    console.error('Error al obtener receta Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al obtener la receta.',
      error: error.message,
    });
  }
};


/**
 * Cancelar receta Doctor Shaddai
 */
export const cancelarRecetaDoctorShaddai = async (req, res) => {
  try {
    const { id } = req.params;

    const idUsuario = obtenerIdUsuarioAutenticado(req);
    const esCajeroOAdmin = esUsuarioCajeroOAdmin(req);

    const valores = [id];
    let filtroPropietario = '';

    if (!esCajeroOAdmin) {
      valores.push(idUsuario);
      filtroPropietario = `AND id_doctor = $${valores.length}`;
    }

    const query = `
      UPDATE recetas_shaddai
      SET
        estatus = 'CANCELADA',
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_receta = $1
        AND activo = true
        ${filtroPropietario}
      RETURNING *;
    `;

    const { rows } = await pool.query(query, valores);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Receta no encontrada o no tienes permiso para cancelarla.',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Receta cancelada correctamente.',
      receta: rows[0],
    });
  } catch (error) {
    console.error('Error al cancelar receta Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al cancelar la receta.',
      error: error.message,
    });
  }
};


/**
 * Finalizar receta desde caja sin generar una venta adicional.
 *
 * - FINALIZADA_SIN_SURTIR: no hay piezas vendidas.
 * - FINALIZADA_PARCIAL: existen piezas vendidas, pero quedaron pendientes
 *   o la receta contiene medicamentos libres/no surtibles desde inventario.
 * - SURTIDA: todos los detalles surtibles fueron cubiertos y no hay
 *   medicamentos libres pendientes.
 */
export const finalizarRecetaDoctorShaddai = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { motivo_finalizacion = null } = req.body || {};
    const idUsuario = obtenerIdUsuarioAutenticado(req);

    /* if (!esUsuarioCajeroOAdmin(req)) {
       return res.status(403).json({
         ok: false,
         mensaje: 'No tienes permiso para finalizar recetas desde caja.',
       });
     }*/

    if (!id || Number.isNaN(Number(id))) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El identificador de la receta no es válido.',
      });
    }

    await client.query('BEGIN');

    const recetaResult = await client.query(
      `
      SELECT
        id_receta,
        folio_receta,
        estatus,
        activo
      FROM recetas_shaddai
      WHERE id_receta = $1
        AND activo = true
      FOR UPDATE;
      `,
      [Number(id)]
    );

    if (recetaResult.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró la receta.',
      });
    }

    const recetaActual = recetaResult.rows[0];
    const estatusActual = String(recetaActual.estatus || '').toUpperCase();

    if (estatusActual === 'CANCELADA') {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'No se puede finalizar una receta cancelada.',
      });
    }

    if (
      ['FINALIZADA_SIN_SURTIR', 'FINALIZADA_PARCIAL'].includes(estatusActual)
    ) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'La receta ya se encuentra finalizada.',
      });
    }

    const detalleResult = await client.query(
      `
      SELECT
        rd.id_detalle,
        rd.id_producto,
        rd.cantidad,
        COALESCE(rd.tipo_producto_receta, 'INVENTARIO') AS tipo_producto_receta,
        COALESCE(rd.producto_libre, false) AS producto_libre,
        COALESCE(SUM(vd.cantidad), 0)::numeric AS cantidad_surtida
      FROM recetas_shaddai_detalle rd
      LEFT JOIN venta_detalle vd
        ON vd.id_detalle_receta_shaddai = rd.id_detalle
      WHERE rd.id_receta = $1
        AND rd.activo = true
      GROUP BY
        rd.id_detalle,
        rd.id_producto,
        rd.cantidad,
        rd.tipo_producto_receta,
        rd.producto_libre
      ORDER BY rd.id_detalle ASC;
      `,
      [Number(id)]
    );

    const detalles = detalleResult.rows;

    const esDetalleSurtible = (detalle) => {
      const tipo = String(detalle.tipo_producto_receta || 'INVENTARIO')
        .trim()
        .toUpperCase();

      return (
        tipo !== 'LIBRE' &&
        detalle.producto_libre !== true &&
        detalle.producto_libre !== 'true' &&
        Number(detalle.id_producto || 0) > 0
      );
    };

    const detallesSurtibles = detalles.filter(esDetalleSurtible);
    const hayDetallesNoSurtibles = detalles.some(
      (detalle) => !esDetalleSurtible(detalle)
    );

    const huboSurtido = detalles.some(
      (detalle) => Number(detalle.cantidad_surtida || 0) > 0
    );

    const todosLosSurtiblesCompletos =
      detallesSurtibles.length > 0 &&
      detallesSurtibles.every(
        (detalle) =>
          Number(detalle.cantidad_surtida || 0) >=
          Number(detalle.cantidad || 0)
      );

    let estatusFinal = 'FINALIZADA_SIN_SURTIR';

    if (todosLosSurtiblesCompletos && !hayDetallesNoSurtibles) {
      estatusFinal = 'SURTIDA';
    } else if (huboSurtido) {
      estatusFinal = 'FINALIZADA_PARCIAL';
    }

    const motivoFinal =
      limpiarTexto(motivo_finalizacion) ||
      (estatusFinal === 'SURTIDA'
        ? 'Receta finalizada desde caja con surtido completo.'
        : estatusFinal === 'FINALIZADA_PARCIAL'
          ? 'Receta finalizada desde caja con surtido parcial.'
          : 'Receta finalizada desde caja sin surtirse.');

    const recetaSeSurtioCompleta = estatusFinal === 'SURTIDA';

    const actualizarReceta = await client.query(
      `
  UPDATE recetas_shaddai
  SET
    estatus = $1,
    fecha_surtida = CASE
      WHEN $5 = true THEN COALESCE(fecha_surtida, NOW())
      ELSE fecha_surtida
    END,
    fecha_finalizacion = NOW(),
    finalizada_por = $2,
    motivo_finalizacion = $3,
    fecha_actualizacion = NOW()
  WHERE id_receta = $4
    AND activo = true
  RETURNING *;
  `,
      [
        estatusFinal,
        idUsuario || null,
        motivoFinal,
        Number(id),
        recetaSeSurtioCompleta,
      ]
    );
    await client.query(
      `
      UPDATE documentos_clinicos
      SET
        estatus = $1,
        fecha_actualizacion = NOW()
      WHERE tabla_origen = 'recetas_shaddai'
        AND id_origen = $2;
      `,
      [estatusFinal, Number(id)]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje:
        estatusFinal === 'SURTIDA'
          ? 'La receta se finalizó como surtida.'
          : estatusFinal === 'FINALIZADA_PARCIAL'
            ? 'La receta se finalizó con surtido parcial.'
            : 'La receta se finalizó sin surtirse.',
      receta: actualizarReceta.rows[0],
      resumen: {
        total_detalles: detalles.length,
        detalles_surtibles: detallesSurtibles.length,
        detalles_no_surtibles: detalles.filter(
          (detalle) => !esDetalleSurtible(detalle)
        ).length,
        hubo_surtido: huboSurtido,
      },
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(
        'Error al hacer rollback al finalizar receta:',
        rollbackError
      );
    }

    console.error('Error al finalizar receta Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al finalizar la receta.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};



export const obtenerNotaMedicaPorId = async (req, res) => {
  try {
    const { idNota } = req.params;

    if (!idNota || Number.isNaN(Number(idNota))) {
      return res.status(400).json({
        ok: false,
        mensaje: 'ID de nota médica inválido.',
      });
    }

    const query = `
      SELECT
        n.id_nota,
        n.id_expediente,
        n.id_fila,
        n.id_doctor,
        n.id_sucursal,
        n.antecedentes_padecimiento_actual,
        n.exploracion_fisica,
        n.plan,
        n.pronostico,
        n.pasa_a,

        e.nombre_paciente,
        e.primer_apellido,
        e.segundo_apellido,
        e.curp,
        e.edad,
        e.sexo,
        e.telefono,
        e.fecha_nacimiento,

        p.nombre_completo AS doctor_nombre_completo,
        p.cedula_profesional,
        p.especialidad

      FROM public.notas_medicas n

      LEFT JOIN public.expedientes_clinicos e
        ON e.id_expediente = n.id_expediente

      LEFT JOIN public.doctores_shaddai_perfiles p
        ON p.id_usuario = n.id_doctor

      WHERE n.id_nota = $1
      LIMIT 1
    `;

    const { rows } = await pool.query(query, [Number(idNota)]);

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró la nota médica.',
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

/**
 * Surtir receta Doctor Shaddai
 */
export const surtirRecetaDoctorShaddai = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { estatus = 'SURTIDA' } = req.body;

    const estatusNormalizado = String(estatus || '').trim().toUpperCase();
    const estatusPermitidos = ['SURTIDA', 'SURTIDA_PARCIAL'];

    if (!estatusPermitidos.includes(estatusNormalizado)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Estatus de surtido no válido.',
      });
    }

    const esCajeroOAdmin = esUsuarioCajeroOAdmin(req);

    if (!esCajeroOAdmin) {
      return res.status(403).json({
        ok: false,
        mensaje: 'No tienes permiso para surtir recetas desde caja.',
      });
    }

    await client.query('BEGIN');

    const recetaResultado = await client.query(
      `
      SELECT 
        id_receta,
        folio_receta,
        estatus
      FROM recetas_shaddai
      WHERE id_receta = $1
        AND activo = true
      FOR UPDATE;
      `,
      [id]
    );

    if (recetaResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontró la receta.',
      });
    }

    const receta = recetaResultado.rows[0];

    if (
      ['CANCELADA', 'FINALIZADA_SIN_SURTIR', 'FINALIZADA_PARCIAL'].includes(
        String(receta.estatus || '').toUpperCase()
      )
    ) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'La receta ya fue finalizada y no puede volver a surtirse desde caja.',
      });
    }

    if (receta.estatus === 'SURTIDA') {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'Esta receta ya fue surtida.',
      });
    }

    const actualizarResultado = await client.query(
      `
      UPDATE recetas_shaddai
      SET
        estatus = $1,
        fecha_surtida = CASE
          WHEN $1 = 'SURTIDA' THEN NOW()
          ELSE fecha_surtida
        END,
        fecha_actualizacion = NOW()
      WHERE id_receta = $2
        AND activo = true
      RETURNING *;
      `,
      [estatusNormalizado, id]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje:
        estatusNormalizado === 'SURTIDA'
          ? 'Receta marcada como surtida correctamente.'
          : 'Receta marcada como surtida parcial correctamente.',
      receta: actualizarResultado.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al surtir receta Doctor Shaddai:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al surtir la receta.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};


export const listarCatalogoServiciosClinicos = async (req, res) => {
  try {
    const { busqueda = '', incluir_inactivos = 'false' } = req.query;

    const params = [];
    let where = 'WHERE 1 = 1';

    const incluirInactivos =
      incluir_inactivos === true ||
      incluir_inactivos === 'true' ||
      incluir_inactivos === '1';

    if (!incluirInactivos) {
      where += ' AND activo = true';
    }

    if (String(busqueda).trim()) {
      params.push(`%${String(busqueda).trim()}%`);
      where += `
        AND (
          nombre ILIKE $${params.length}
          OR COALESCE(descripcion, '') ILIKE $${params.length}
        )
      `;
    }

    const resultado = await pool.query(
      `
      SELECT
        id_servicio,
        nombre,
        descripcion,
        precio,
        requiere_producto,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM cat_servicios_clinicos
      ${where}
      ORDER BY activo DESC, nombre ASC
      `,
      params
    );

    return res.json({
      ok: true,
      servicios: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar catálogo de servicios clínicos:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar catálogo de servicios clínicos.',
      error: error.message,
    });
  }
};

export const crearServicioClinicoCatalogo = async (req, res) => {
  try {
    const {
      nombre,
      descripcion = null,
      precio = 0,
      requiere_producto = false,
      activo = true,
    } = req.body;

    const nombreLimpio = limpiarTexto(nombre);

    if (!nombreLimpio) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del servicio es obligatorio.',
      });
    }

    const precioNumerico = Number(precio || 0);

    if (Number.isNaN(precioNumerico) || precioNumerico < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El precio debe ser un número mayor o igual a cero.',
      });
    }

    const existe = await pool.query(
      `
      SELECT id_servicio
      FROM cat_servicios_clinicos
      WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))
      LIMIT 1
      `,
      [nombreLimpio]
    );

    if (existe.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe un servicio clínico con ese nombre.',
      });
    }

    const resultado = await pool.query(
      `
      INSERT INTO cat_servicios_clinicos (
        nombre,
        descripcion,
        precio,
        requiere_producto,
        activo
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id_servicio,
        nombre,
        descripcion,
        precio,
        requiere_producto,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        nombreLimpio,
        limpiarTexto(descripcion),
        precioNumerico,
        requiere_producto === true || requiere_producto === 'true' || requiere_producto === 1 || requiere_producto === '1',
        activo === true || activo === 'true' || activo === 1 || activo === '1',
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Servicio clínico creado correctamente.',
      servicio: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al crear servicio clínico del catálogo:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear servicio clínico.',
      error: error.message,
    });
  }
};

export const actualizarServicioClinicoCatalogo = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      nombre,
      descripcion = null,
      precio = 0,
      requiere_producto = false,
      activo = true,
    } = req.body;

    const idServicio = Number(id || 0);

    if (!idServicio) {
      return res.status(400).json({
        ok: false,
        mensaje: 'ID de servicio inválido.',
      });
    }

    const nombreLimpio = limpiarTexto(nombre);

    if (!nombreLimpio) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del servicio es obligatorio.',
      });
    }

    const precioNumerico = Number(precio || 0);

    if (Number.isNaN(precioNumerico) || precioNumerico < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El precio debe ser un número mayor o igual a cero.',
      });
    }

    const duplicado = await pool.query(
      `
      SELECT id_servicio
      FROM cat_servicios_clinicos
      WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))
        AND id_servicio <> $2
      LIMIT 1
      `,
      [nombreLimpio, idServicio]
    );

    if (duplicado.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe otro servicio clínico con ese nombre.',
      });
    }

    const resultado = await pool.query(
      `
      UPDATE cat_servicios_clinicos
      SET
        nombre = $1,
        descripcion = $2,
        precio = $3,
        requiere_producto = $4,
        activo = $5,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_servicio = $6
      RETURNING
        id_servicio,
        nombre,
        descripcion,
        precio,
        requiere_producto,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        nombreLimpio,
        limpiarTexto(descripcion),
        precioNumerico,
        requiere_producto === true || requiere_producto === 'true' || requiere_producto === 1 || requiere_producto === '1',
        activo === true || activo === 'true' || activo === 1 || activo === '1',
        idServicio,
      ]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Servicio clínico no encontrado.',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Servicio clínico actualizado correctamente.',
      servicio: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar servicio clínico del catálogo:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar servicio clínico.',
      error: error.message,
    });
  }
};


const obtenerIdUsuarioRequest = (req) => {
  return (
    req.usuario?.id_usuario ||
    req.usuario?.id ||
    req.user?.id_usuario ||
    req.user?.id ||
    null
  );
};

const obtenerIdSucursalRequest = (req) => {
  return (
    req.usuario?.id_sucursal ||
    req.usuario?.sucursal?.id_sucursal ||
    req.user?.id_sucursal ||
    null
  );
};

const normalizarTexto = (valor) => {
  if (valor === undefined || valor === null) return null;

  const texto = String(valor).trim();

  return texto || null;
};

const normalizarNumero = (valor) => {
  if (valor === undefined || valor === null || valor === '') return null;

  const numero = Number(valor);

  return Number.isFinite(numero) ? numero : null;
};

const normalizarJson = (valor) => {
  if (!valor || typeof valor !== 'object') return {};

  return valor;
};

const obtenerFechaCompacta = () => {
  const ahora = new Date();

  const year = ahora.getFullYear();
  const month = String(ahora.getMonth() + 1).padStart(2, '0');
  const day = String(ahora.getDate()).padStart(2, '0');

  return `${year}${month}${day}`;
};

const generarFolioCertificado = async (client) => {
  const fecha = obtenerFechaCompacta();
  const prefijo = `CERT-${fecha}`;

  const { rows } = await client.query(
    `
      SELECT folio_certificado
      FROM certificados_medicos_shaddai
      WHERE folio_certificado LIKE $1
      ORDER BY id_certificado DESC
      LIMIT 1
    `,
    [`${prefijo}-%`]
  );

  let consecutivo = 1;

  if (rows.length > 0) {
    const ultimoFolio = rows[0].folio_certificado || '';
    const partes = ultimoFolio.split('-');
    const ultimoNumero = Number(partes[2] || 0);

    if (Number.isFinite(ultimoNumero)) {
      consecutivo = ultimoNumero + 1;
    }
  }

  return `${prefijo}-${String(consecutivo).padStart(4, '0')}`;
};

export const crearCertificadoMedico = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      id_expediente,
      id_fila,
      id_sucursal,
      tipo_atencion,

      tipo_certificado,
      folio_certificado,

      lugar_expedicion,
      fecha_expedicion,
      destinatario,
      finalidad,

      estado_salud,
      antecedentes,
      exploracion_fisica,
      conclusion,
      observaciones,
      texto_libre,

      datos_paciente,
      datos_doctor,
    } = req.body;

    if (!id_expediente) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El id_expediente es obligatorio para guardar el certificado.',
      });
    }

    if (!tipo_certificado) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El tipo de certificado es obligatorio.',
      });
    }

    if (!estado_salud || !String(estado_salud).trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El estado de salud es obligatorio.',
      });
    }

    if (!conclusion || !String(conclusion).trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La conclusión del certificado es obligatoria.',
      });
    }

    const idDoctor = obtenerIdUsuarioRequest(req);

    if (!idDoctor) {
      return res.status(401).json({
        ok: false,
        mensaje: 'No se pudo identificar al doctor autenticado.',
      });
    }

    const idSucursalFinal =
      normalizarNumero(id_sucursal) ||
      normalizarNumero(datos_paciente?.id_sucursal) ||
      obtenerIdSucursalRequest(req);

    await client.query('BEGIN');

    const folioFinal =
      normalizarTexto(folio_certificado) ||
      (await generarFolioCertificado(client));

    const sql = `
      INSERT INTO certificados_medicos_shaddai (
        id_expediente,
        id_fila,
        id_sucursal,
        id_doctor,
        tipo_atencion,
        tipo_certificado,
        folio_certificado,
        lugar_expedicion,
        fecha_expedicion,
        destinatario,
        finalidad,
        estado_salud,
        antecedentes,
        exploracion_fisica,
        conclusion,
        observaciones,
        texto_libre,
        datos_paciente,
        datos_doctor,
        estatus,
        activo
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18::jsonb, $19::jsonb,
        'ACTIVO', TRUE
      )
      RETURNING *
    `;

    const params = [
      normalizarNumero(id_expediente),
      normalizarNumero(id_fila),
      idSucursalFinal,
      idDoctor,
      normalizarTexto(tipo_atencion),

      normalizarTexto(tipo_certificado),
      folioFinal,
      normalizarTexto(lugar_expedicion),
      fecha_expedicion || null,
      normalizarTexto(destinatario),

      normalizarTexto(finalidad),
      normalizarTexto(estado_salud),
      normalizarTexto(antecedentes),
      normalizarTexto(exploracion_fisica),
      normalizarTexto(conclusion),

      normalizarTexto(observaciones),
      normalizarTexto(texto_libre),
      JSON.stringify(normalizarJson(datos_paciente)),
      JSON.stringify(normalizarJson(datos_doctor)),
    ];



    const { rows } = await client.query(sql, params);
    const certificado = rows[0];

    const datosPacienteFinal = normalizarJson(datos_paciente);
    const datosDoctorFinal = normalizarJson(datos_doctor);

    const documentoClinico = await registrarDocumentoClinico(client, {
      id_expediente: certificado.id_expediente,
      id_fila: certificado.id_fila,
      id_doctor: certificado.id_doctor || idDoctor,
      id_sucursal: certificado.id_sucursal || idSucursalFinal,

      tipo_documento: 'CERTIFICADO_MEDICO',
      id_origen: certificado.id_certificado,
      folio: certificado.folio_certificado,
      titulo: 'Certificado médico',
      descripcion:
        normalizarTexto(certificado.finalidad) ||
        normalizarTexto(certificado.estado_salud) ||
        normalizarTexto(certificado.conclusion) ||
        'Certificado médico',

      estatus: certificado.estatus || 'ACTIVO',
      tabla_origen: 'certificados_medicos_shaddai',

      ruta_frontend: `/app/doctor-shaddai/recetas?id_expediente=${certificado.id_expediente}${certificado.id_fila ? `&id_fila=${certificado.id_fila}` : ''
        }&tipo_atencion=${certificado.tipo_atencion || 'CONSULTA_MEDICA'}`,

      metadata: {
        id_certificado: certificado.id_certificado,
        folio_certificado: certificado.folio_certificado,
        tipo_certificado: certificado.tipo_certificado,

        lugar_expedicion: certificado.lugar_expedicion,
        fecha_expedicion: certificado.fecha_expedicion,
        destinatario: certificado.destinatario,
        finalidad: certificado.finalidad,

        estado_salud: certificado.estado_salud,
        antecedentes: certificado.antecedentes,
        exploracion_fisica: certificado.exploracion_fisica,
        conclusion: certificado.conclusion,
        observaciones: certificado.observaciones,
        texto_libre: certificado.texto_libre,

        datos_paciente: certificado.datos_paciente || datosPacienteFinal,
        datos_doctor: certificado.datos_doctor || datosDoctorFinal,

        nombre_paciente:
          datosPacienteFinal.nombre_paciente ||
          certificado.datos_paciente?.nombre_paciente ||
          null,

        edad:
          datosPacienteFinal.edad ||
          certificado.datos_paciente?.edad ||
          null,

        sexo:
          datosPacienteFinal.sexo ||
          certificado.datos_paciente?.sexo ||
          null,

        fecha_nacimiento:
          datosPacienteFinal.fecha_nacimiento ||
          certificado.datos_paciente?.fecha_nacimiento ||
          null,

        telefono:
          datosPacienteFinal.telefono ||
          certificado.datos_paciente?.telefono ||
          null,

        doctor_nombre_completo:
          datosDoctorFinal.nombre_completo ||
          certificado.datos_doctor?.nombre_completo ||
          null,

        cedula_profesional:
          datosDoctorFinal.cedula_profesional ||
          certificado.datos_doctor?.cedula_profesional ||
          null,

        especialidad:
          datosDoctorFinal.especialidad ||
          certificado.datos_doctor?.especialidad ||
          null,

        logo_universidad_url:
          datosDoctorFinal.logo_universidad_url ||
          certificado.datos_doctor?.logo_universidad_url ||
          null,
      },
    });

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Certificado médico guardado correctamente.',
      certificado,
      documento_clinico: documentoClinico,
    });

  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al crear certificado médico:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe un certificado con ese folio. Intenta guardar nuevamente.',
      });
    }

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudo guardar el certificado médico.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};


export const cambiarEstatusServicioClinicoCatalogo = async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body;

    const idServicio = Number(id || 0);

    if (!idServicio) {
      return res.status(400).json({
        ok: false,
        mensaje: 'ID de servicio inválido.',
      });
    }

    const activoFinal =
      activo === true || activo === 'true' || activo === 1 || activo === '1';

    const resultado = await pool.query(
      `
      UPDATE cat_servicios_clinicos
      SET
        activo = $1,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_servicio = $2
      RETURNING
        id_servicio,
        nombre,
        descripcion,
        precio,
        requiere_producto,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [activoFinal, idServicio]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Servicio clínico no encontrado.',
      });
    }

    return res.json({
      ok: true,
      mensaje: activoFinal
        ? 'Servicio clínico activado correctamente.'
        : 'Servicio clínico desactivado correctamente.',
      servicio: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al cambiar estatus del servicio clínico:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al cambiar estatus del servicio clínico.',
      error: error.message,
    });
  }
};
