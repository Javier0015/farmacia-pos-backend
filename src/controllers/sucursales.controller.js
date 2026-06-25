import { pool } from '../config/db.js';

const normalizarUrlGoogleMaps = (url) => {
  const valor = String(url || '').trim();

  if (!valor) return null;

  let urlValidada;

  try {
    urlValidada = new URL(valor);
  } catch {
    throw new Error('El enlace de Google Maps no tiene un formato válido.');
  }

  if (!['http:', 'https:'].includes(urlValidada.protocol)) {
    throw new Error(
      'El enlace de Google Maps debe iniciar con http:// o https://'
    );
  }

  const host = urlValidada.hostname.toLowerCase();
  const ruta = urlValidada.pathname.toLowerCase();

  const esLinkCortoMaps =
    host === 'maps.app.goo.gl' ||
    host === 'goo.gl' ||
    host === 'www.goo.gl';

  const esGoogleMaps =
    /^maps\.google\.[a-z.]+$/.test(host) ||
    (/(\.|^)google\.[a-z.]+$/.test(host) && ruta.startsWith('/maps'));

  if (!esLinkCortoMaps && !esGoogleMaps) {
    throw new Error(
      'Captura un enlace compartido de Google Maps, por ejemplo https://maps.app.goo.gl/...'
    );
  }

  return urlValidada.toString();
};

const validarCorreo = (correo) => {
  if (!correo || !correo.trim()) return true;

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
};

export const listarSucursales = async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT
        id_sucursal,
        nombre,
        clave,
        direccion,
        url_google_maps,
        telefono,
        correo,
        responsable,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM sucursales
      ORDER BY id_sucursal ASC
    `);

    return res.json({
      ok: true,
      sucursales: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar sucursales:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar sucursales',
    });
  }
};

export const obtenerSucursal = async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      SELECT
        id_sucursal,
        nombre,
        clave,
        direccion,
        url_google_maps,
        telefono,
        correo,
        responsable,
        activo,
        fecha_creacion,
        fecha_actualizacion
      FROM sucursales
      WHERE id_sucursal = $1
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Sucursal no encontrada',
      });
    }

    return res.json({
      ok: true,
      sucursal: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener sucursal:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener sucursal',
    });
  }
};

export const crearSucursal = async (req, res) => {
  try {
    const {
      nombre,
      clave,
      direccion,
      url_google_maps,
      telefono,
      correo,
      responsable,
    } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la sucursal es obligatorio',
      });
    }

    if (!clave || !clave.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La clave de la sucursal es obligatoria',
      });
    }

    if (!validarCorreo(correo)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El correo electrónico no es válido',
      });
    }

    let urlGoogleMapsNormalizada = null;

    try {
      urlGoogleMapsNormalizada = normalizarUrlGoogleMaps(url_google_maps);
    } catch (errorUrl) {
      return res.status(400).json({
        ok: false,
        mensaje: errorUrl.message,
      });
    }

    const claveNormalizada = clave.trim().toUpperCase();

    const existe = await pool.query(
      `
      SELECT id_sucursal
      FROM sucursales
      WHERE clave = $1
      `,
      [claveNormalizada]
    );

    if (existe.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe una sucursal con esa clave',
      });
    }

    const resultado = await pool.query(
      `
      INSERT INTO sucursales (
        nombre,
        clave,
        direccion,
        url_google_maps,
        telefono,
        correo,
        responsable,
        activo,
        fecha_creacion,
        fecha_actualizacion
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        true,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING
        id_sucursal,
        nombre,
        clave,
        direccion,
        url_google_maps,
        telefono,
        correo,
        responsable,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        nombre.trim(),
        claveNormalizada,
        direccion?.trim() || null,
        urlGoogleMapsNormalizada,
        telefono?.trim() || null,
        correo?.trim() || null,
        responsable?.trim() || null,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Sucursal creada correctamente',
      sucursal: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al crear sucursal:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al crear sucursal',
    });
  }
};

export const actualizarSucursal = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      nombre,
      clave,
      direccion,
      url_google_maps,
      telefono,
      correo,
      responsable,
      activo,
    } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la sucursal es obligatorio',
      });
    }

    if (!clave || !clave.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La clave de la sucursal es obligatoria',
      });
    }

    if (!validarCorreo(correo)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El correo electrónico no es válido',
      });
    }

    let urlGoogleMapsNormalizada = null;

    try {
      urlGoogleMapsNormalizada = normalizarUrlGoogleMaps(url_google_maps);
    } catch (errorUrl) {
      return res.status(400).json({
        ok: false,
        mensaje: errorUrl.message,
      });
    }

    const claveNormalizada = clave.trim().toUpperCase();

    const existe = await pool.query(
      `
      SELECT id_sucursal
      FROM sucursales
      WHERE clave = $1
        AND id_sucursal <> $2
      `,
      [claveNormalizada, id]
    );

    if (existe.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe otra sucursal con esa clave',
      });
    }

    const resultado = await pool.query(
      `
      UPDATE sucursales
      SET
        nombre = $1,
        clave = $2,
        direccion = $3,
        url_google_maps = $4,
        telefono = $5,
        correo = $6,
        responsable = $7,
        activo = COALESCE($8, activo),
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_sucursal = $9
      RETURNING
        id_sucursal,
        nombre,
        clave,
        direccion,
        url_google_maps,
        telefono,
        correo,
        responsable,
        activo,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        nombre.trim(),
        claveNormalizada,
        direccion?.trim() || null,
        urlGoogleMapsNormalizada,
        telefono?.trim() || null,
        correo?.trim() || null,
        responsable?.trim() || null,
        activo,
        id,
      ]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Sucursal no encontrada',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Sucursal actualizada correctamente',
      sucursal: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar sucursal:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al actualizar sucursal',
    });
  }
};

export const desactivarSucursal = async (req, res) => {
  try {
    const { id } = req.params;

    const cajasAbiertas = await pool.query(
      `
      SELECT id_sesion
      FROM caja_sesiones
      WHERE id_sucursal = $1
        AND estado = 'ABIERTA'
      LIMIT 1
      `,
      [id]
    );

    if (cajasAbiertas.rows.length > 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'No puedes desactivar una sucursal con caja abierta',
      });
    }

    const resultado = await pool.query(
      `
      UPDATE sucursales
      SET
        activo = false,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_sucursal = $1
      RETURNING
        id_sucursal,
        nombre,
        clave,
        activo
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Sucursal no encontrada',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Sucursal desactivada correctamente',
      sucursal: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al desactivar sucursal:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al desactivar sucursal',
    });
  }
};