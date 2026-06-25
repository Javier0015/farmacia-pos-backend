import { pool } from '../config/db.js';

const construirUrlImagen = (req, file) => {
  if (!file) return null;

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/catalogo/${file.filename}`;
};

export const listarCatalogoAdmin = async (req, res) => {
  try {
    const query = `
      SELECT
        cp.id_catalogo,
        cp.id_producto,
        cp.titulo_catalogo,
        cp.descripcion_catalogo,
        cp.advertencias,
        cp.indicaciones,
        cp.modo_uso,
        cp.imagen_url,
        cp.activo,
        cp.destacado,
        cp.mostrar_stock,
        cp.orden,
        cp.fecha_creacion,
        cp.fecha_actualizacion,

        p.codigo_barras,
        p.nombre AS nombre_producto,
        p.descripcion AS descripcion_producto,
        p.laboratorio,
        p.presentacion,
        p.requiere_receta,
        p.es_controlado,
        p.precio_venta,

        c.nombre AS nombre_categoria,

        COALESCE(inv.stock_total, 0) AS stock_total,

        oc.id_oferta,
        oc.nombre AS nombre_oferta,
        oc.descripcion AS descripcion_oferta,
        oc.porcentaje_descuento,

        CASE 
          WHEN oc.id_oferta IS NOT NULL THEN true
          ELSE false
        END AS tiene_oferta,

        CASE
          WHEN oc.id_oferta IS NOT NULL THEN
            ROUND(
              p.precio_venta - (p.precio_venta * oc.porcentaje_descuento / 100),
              2
            )
          ELSE p.precio_venta
        END AS precio_final

      FROM public.catalogo_productos cp

      INNER JOIN public.productos p
        ON p.id_producto = cp.id_producto

      LEFT JOIN public.categorias c
        ON c.id_categoria = p.id_categoria

      LEFT JOIN LATERAL (
        SELECT 
          oc2.id_oferta,
          oc2.nombre,
          oc2.descripcion,
          oc2.porcentaje_descuento
        FROM public.ofertas_categorias oc2
        WHERE oc2.id_categoria = p.id_categoria
          AND oc2.activo = true
          AND CURRENT_DATE BETWEEN oc2.fecha_inicio AND oc2.fecha_fin
        ORDER BY oc2.fecha_creacion DESC
        LIMIT 1
      ) oc ON true

      LEFT JOIN (
        SELECT
          id_producto,
          SUM(stock_actual) AS stock_total
        FROM public.inventario_sucursal
        GROUP BY id_producto
      ) inv
        ON inv.id_producto = p.id_producto

      ORDER BY 
        cp.fecha_creacion DESC;
    `;

    const { rows } = await pool.query(query);

    res.json({
      ok: true,
      catalogo: rows,
    });
  } catch (error) {
    console.error('Error al listar catálogo admin:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al listar el catálogo',
      error: error.message,
    });
  }
};

export const listarProductosParaCatalogo = async (req, res) => {
  try {
    const query = `
      SELECT
        p.id_producto,
        p.codigo_barras,
        p.nombre,
        p.descripcion,
        p.laboratorio,
        p.presentacion,
        p.requiere_receta,
        p.es_controlado,
        p.precio_venta,
        p.id_categoria,

        c.nombre AS nombre_categoria,

        COALESCE(inv.stock_total, 0) AS stock_total,

        CASE 
          WHEN cp.id_catalogo IS NOT NULL THEN true
          ELSE false
        END AS ya_en_catalogo,

        cp.id_catalogo

      FROM public.productos p

      LEFT JOIN public.categorias c
        ON c.id_categoria = p.id_categoria

      LEFT JOIN (
        SELECT
          id_producto,
          SUM(stock_actual) AS stock_total
        FROM public.inventario_sucursal
        GROUP BY id_producto
      ) inv
        ON inv.id_producto = p.id_producto

      LEFT JOIN public.catalogo_productos cp
        ON cp.id_producto = p.id_producto

      WHERE p.activo = true

      ORDER BY p.nombre ASC;
    `;

    const { rows } = await pool.query(query);

    res.json({
      ok: true,
      productos: rows,
    });
  } catch (error) {
    console.error('Error al listar productos para catálogo:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al listar productos para catálogo',
      error: error.message,
    });
  }
};

export const crearProductoCatalogo = async (req, res) => {
  try {
    const {
      id_producto,
      titulo_catalogo,
      descripcion_catalogo,
      advertencias,
      indicaciones,
      modo_uso,
      activo,
      destacado,
      mostrar_stock,
      orden,
    } = req.body;

    if (!id_producto) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El producto es obligatorio',
      });
    }

    const imagen_url = construirUrlImagen(req, req.file);

    const query = `
      INSERT INTO public.catalogo_productos (
        id_producto,
        titulo_catalogo,
        descripcion_catalogo,
        advertencias,
        indicaciones,
        modo_uso,
        imagen_url,
        activo,
        destacado,
        mostrar_stock,
        orden
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true), COALESCE($9, false), COALESCE($10, false), COALESCE($11, 0))
      RETURNING *;
    `;

    const values = [
      id_producto,
      titulo_catalogo || null,
      descripcion_catalogo || null,
      advertencias || null,
      indicaciones || null,
      modo_uso || null,
      imagen_url,
      activo === undefined ? true : activo,
      destacado === undefined ? false : destacado,
      mostrar_stock === undefined ? false : mostrar_stock,
      orden || 0,
    ];

    const { rows } = await pool.query(query, values);

    res.status(201).json({
      ok: true,
      mensaje: 'Producto agregado al catálogo correctamente',
      producto: rows[0],
    });
  } catch (error) {
    console.error('Error al crear producto de catálogo:', error);

    if (error.code === '23505') {
      return res.status(400).json({
        ok: false,
        mensaje: 'Este producto ya está agregado al catálogo',
      });
    }

    res.status(500).json({
      ok: false,
      mensaje: 'Error al crear producto de catálogo',
      error: error.message,
    });
  }
};

export const actualizarProductoCatalogo = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      titulo_catalogo,
      descripcion_catalogo,
      advertencias,
      indicaciones,
      modo_uso,
      activo,
      destacado,
      mostrar_stock,
      orden,
    } = req.body;

    let imagen_url = null;

    if (req.file) {
      imagen_url = construirUrlImagen(req, req.file);
    }

    const query = `
      UPDATE public.catalogo_productos
      SET
        titulo_catalogo = $1,
        descripcion_catalogo = $2,
        advertencias = $3,
        indicaciones = $4,
        modo_uso = $5,
        activo = $6,
        destacado = $7,
        mostrar_stock = $8,
        orden = $9,
        imagen_url = COALESCE($10, imagen_url),
        fecha_actualizacion = NOW()
      WHERE id_catalogo = $11
      RETURNING *;
    `;

    const values = [
      titulo_catalogo || null,
      descripcion_catalogo || null,
      advertencias || null,
      indicaciones || null,
      modo_uso || null,
      activo === undefined ? true : activo,
      destacado === undefined ? false : destacado,
      mostrar_stock === undefined ? false : mostrar_stock,
      orden || 0,
      imagen_url,
      id,
    ];

    const { rows } = await pool.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto del catálogo no encontrado',
      });
    }

    res.json({
      ok: true,
      mensaje: 'Producto del catálogo actualizado correctamente',
      producto: rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar producto de catálogo:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al actualizar producto de catálogo',
      error: error.message,
    });
  }
};

export const cambiarEstadoProductoCatalogo = async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body;

    const query = `
      UPDATE public.catalogo_productos
      SET 
        activo = $1,
        fecha_actualizacion = NOW()
      WHERE id_catalogo = $2
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [activo, id]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto del catálogo no encontrado',
      });
    }

    res.json({
      ok: true,
      mensaje: activo
        ? 'Producto activado en catálogo'
        : 'Producto desactivado del catálogo',
      producto: rows[0],
    });
  } catch (error) {
    console.error('Error al cambiar estado del producto de catálogo:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al cambiar estado del producto',
      error: error.message,
    });
  }
};

export const eliminarProductoCatalogo = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      DELETE FROM public.catalogo_productos
      WHERE id_catalogo = $1
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto del catálogo no encontrado',
      });
    }

    res.json({
      ok: true,
      mensaje: 'Producto eliminado del catálogo correctamente',
      producto: rows[0],
    });
  } catch (error) {
    console.error('Error al eliminar producto de catálogo:', error);

    res.status(500).json({
      ok: false,
      mensaje: 'Error al eliminar producto del catálogo',
      error: error.message,
    });
  }
};

const convertirBooleano = (valor, valorPorDefecto = false) => {
  if (typeof valor === 'boolean') return valor;

  if (typeof valor === 'string') {
    const texto = valor.trim().toLowerCase();

    if (['true', '1', 'on', 'si', 'sí'].includes(texto)) return true;
    if (['false', '0', 'off', 'no'].includes(texto)) return false;
  }

  if (typeof valor === 'number') {
    return valor === 1;
  }

  return valorPorDefecto;
};

const normalizarUrlRedSocial = (url) => {
  const valor = String(url || '').trim();

  if (!valor) return null;

  let urlValidada;

  try {
    urlValidada = new URL(valor);
  } catch {
    throw new Error('El enlace no tiene un formato válido.');
  }

  if (!['http:', 'https:'].includes(urlValidada.protocol)) {
    throw new Error('El enlace debe iniciar con http:// o https://');
  }

  return urlValidada.toString();
};

/*
 * Convierte números mexicanos capturados como 7711234567, 52 771 123 4567
 * o 5217711234567 al formato internacional que utiliza wa.me: 527711234567.
 */
const normalizarTelefonoWhatsApp = (telefono) => {
  let digitos = String(telefono || '').replace(/\D/g, '');

  if (!digitos) return null;

  if (digitos.startsWith('521') && digitos.length === 13) {
    digitos = `52${digitos.slice(3)}`;
  }

  if (digitos.startsWith('52') && digitos.length === 12) {
    return digitos;
  }

  if (digitos.length === 10) {
    return `52${digitos}`;
  }

  return null;
};

/* =========================================================
   ADMINISTRACIÓN: devuelve todas las redes del catálogo
========================================================= */
export const listarRedesSocialesCatalogo = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id_red_social,
        clave,
        nombre,
        url,
        activo,
        orden,
        fecha_creacion,
        fecha_actualizacion
      FROM public.catalogo_redes_sociales
      ORDER BY orden ASC, nombre ASC
    `);

    return res.json({
      ok: true,
      redes_sociales: rows,
    });
  } catch (error) {
    console.error('Error al listar redes sociales del catálogo:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudieron cargar las redes sociales.',
    });
  }
};

/* =========================================================
   ADMINISTRACIÓN: sucursales configurables desde Catálogo
========================================================= */
export const listarSucursalesWhatsappCatalogo = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id_sucursal,
        nombre,
        clave,
        direccion,
        telefono,
        url_google_maps,
        activo,
        mostrar_whatsapp_catalogo
      FROM public.sucursales
      ORDER BY activo DESC, nombre ASC
    `);

    const sucursales = rows.map((sucursal) => {
      const telefonoWhatsapp = normalizarTelefonoWhatsApp(sucursal.telefono);

      return {
        ...sucursal,
        telefono_valido: Boolean(telefonoWhatsapp),
        telefono_whatsapp: telefonoWhatsapp,
      };
    });

    return res.json({
      ok: true,
      sucursales: sucursales,
    });
  } catch (error) {
    console.error('Error al listar sucursales para WhatsApp del catálogo:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudieron cargar las sucursales para WhatsApp.',
    });
  }
};

/* =========================================================
   ADMINISTRACIÓN: muestra u oculta una sucursal en WhatsApp
========================================================= */
export const actualizarSucursalWhatsappCatalogo = async (req, res) => {
  try {
    const idSucursal = Number(req.params.id);
    const mostrarWhatsapp = convertirBooleano(
      req.body?.mostrar_whatsapp_catalogo,
      false
    );

    if (!Number.isInteger(idSucursal) || idSucursal <= 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El identificador de la sucursal no es válido.',
      });
    }

    const { rows: sucursales } = await pool.query(
      `
      SELECT
        id_sucursal,
        nombre,
        telefono,
        url_google_maps,
        activo
      FROM public.sucursales
      WHERE id_sucursal = $1
      `,
      [idSucursal]
    );

    if (sucursales.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'La sucursal no fue encontrada.',
      });
    }

    const sucursal = sucursales[0];
    const telefonoWhatsapp = normalizarTelefonoWhatsApp(sucursal.telefono);

    if (mostrarWhatsapp && !sucursal.activo) {
      return res.status(400).json({
        ok: false,
        mensaje: 'No puedes mostrar una sucursal inactiva en WhatsApp.',
      });
    }

    if (mostrarWhatsapp && !telefonoWhatsapp) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'La sucursal requiere un teléfono mexicano válido de 10 dígitos para mostrarse en WhatsApp.',
      });
    }

    const { rows } = await pool.query(
      `
      UPDATE public.sucursales
      SET
        mostrar_whatsapp_catalogo = $1,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_sucursal = $2
      RETURNING
        id_sucursal,
        nombre,
        clave,
        direccion,
        telefono,
        activo,
        mostrar_whatsapp_catalogo,
        fecha_actualizacion
      `,
      [mostrarWhatsapp, idSucursal]
    );

    const actualizado = rows[0];

    return res.json({
      ok: true,
      mensaje: mostrarWhatsapp
        ? 'Sucursal disponible en WhatsApp del catálogo.'
        : 'Sucursal oculta de WhatsApp del catálogo.',
      sucursal: {
        ...actualizado,
        telefono_valido: Boolean(
          normalizarTelefonoWhatsApp(actualizado.telefono)
        ),
      },
    });
  } catch (error) {
    console.error('Error al actualizar sucursal para WhatsApp del catálogo:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudo actualizar la sucursal para WhatsApp.',
    });
  }
};

/* =========================================================
   ADMINISTRACIÓN: actualiza enlace, visibilidad y orden
========================================================= */
export const actualizarRedSocialCatalogo = async (req, res) => {
  try {
    const idRedSocial = Number(req.params.id);
    const { url, activo, orden } = req.body;

    if (!Number.isInteger(idRedSocial) || idRedSocial <= 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El identificador de la red social no es válido.',
      });
    }

    const { rows: existentes } = await pool.query(
      `
      SELECT id_red_social, clave
      FROM public.catalogo_redes_sociales
      WHERE id_red_social = $1
      `,
      [idRedSocial]
    );

    if (existentes.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'La red social no fue encontrada.',
      });
    }

    const clave = String(existentes[0].clave || '').toUpperCase();
    const esWhatsapp = clave === 'WHATSAPP';

    let urlNormalizada = null;

    if (!esWhatsapp) {
      try {
        urlNormalizada = normalizarUrlRedSocial(url);
      } catch (errorUrl) {
        return res.status(400).json({
          ok: false,
          mensaje: errorUrl.message,
        });
      }
    }

    const activoNormalizado = convertirBooleano(activo, false);
    const ordenNormalizado =
      orden === '' || orden === null || orden === undefined
        ? 0
        : Number(orden);

    if (!Number.isInteger(ordenNormalizado) || ordenNormalizado < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El orden debe ser un número entero mayor o igual a cero.',
      });
    }

    if (activoNormalizado && !esWhatsapp && !urlNormalizada) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'Para mostrar una red social en el catálogo debes capturar un enlace válido.',
      });
    }

    const { rows } = await pool.query(
      `
      UPDATE public.catalogo_redes_sociales
      SET
        url = $1,
        activo = $2,
        orden = $3,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_red_social = $4
      RETURNING
        id_red_social,
        clave,
        nombre,
        url,
        activo,
        orden,
        fecha_creacion,
        fecha_actualizacion
      `,
      [
        esWhatsapp ? null : urlNormalizada,
        activoNormalizado,
        ordenNormalizado,
        idRedSocial,
      ]
    );

    return res.json({
      ok: true,
      mensaje: 'Red social actualizada correctamente.',
      red_social: rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar red social del catálogo:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudo actualizar la red social.',
    });
  }
};

/* =========================================================
   PÚBLICO: redes visibles. WhatsApp depende de sucursales
========================================================= */
export const listarRedesSocialesPublicas = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        rs.clave,
        rs.nombre,
        rs.url,
        rs.activo,
        rs.orden
      FROM public.catalogo_redes_sociales rs
      WHERE rs.activo = true
        AND (
          (
            rs.clave = 'WHATSAPP'
            AND EXISTS (
              SELECT 1
              FROM public.sucursales s
              WHERE s.activo = true
                AND s.mostrar_whatsapp_catalogo = true
                AND NULLIF(BTRIM(s.telefono), '') IS NOT NULL
            )
          )
          OR (
            rs.clave <> 'WHATSAPP'
            AND NULLIF(BTRIM(rs.url), '') IS NOT NULL
          )
        )
      ORDER BY rs.orden ASC, rs.nombre ASC
    `);

    return res.json({
      ok: true,
      redes_sociales: rows,
    });
  } catch (error) {
    console.error('Error al listar redes sociales públicas:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudieron cargar las redes sociales públicas.',
    });
  }
};

/* =========================================================
   PÚBLICO: sucursales visibles en el selector de WhatsApp
========================================================= */
export const listarSucursalesWhatsappPublicas = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id_sucursal,
        nombre,
        clave,
        direccion,
        url_google_maps,
        telefono
      FROM public.sucursales
      WHERE activo = true
        AND mostrar_whatsapp_catalogo = true
        AND NULLIF(BTRIM(telefono), '') IS NOT NULL
      ORDER BY nombre ASC
    `);

    const sucursales = rows
      .map((sucursal) => {
        const telefonoWhatsapp = normalizarTelefonoWhatsApp(sucursal.telefono);

        if (!telefonoWhatsapp) return null;

        const mensaje = encodeURIComponent(
          `Hola.`
        );

        return {
          ...sucursal,
          telefono_whatsapp: telefonoWhatsapp,
          url_whatsapp: `https://wa.me/${telefonoWhatsapp}?text=${mensaje}`,
        };
      })
      .filter(Boolean);

    return res.json({
      ok: true,
      sucursales: sucursales,
    });
  } catch (error) {
    console.error('Error al listar sucursales públicas para WhatsApp:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudieron cargar las sucursales para WhatsApp.',
    });
  }
};
