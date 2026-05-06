import { pool } from '../config/db.js';

const normalizarTexto = (valor) => {
  if (valor === undefined || valor === null) return null;

  const texto = String(valor).trim();

  return texto.length > 0 ? texto : null;
};

const normalizarBooleano = (valor, valorDefault = true) => {
  if (valor === undefined || valor === null) return valorDefault;

  if (typeof valor === 'boolean') return valor;

  if (typeof valor === 'string') {
    const texto = valor.trim().toLowerCase();

    if (['true', '1', 'si', 'sí', 's'].includes(texto)) return true;
    if (['false', '0', 'no', 'n'].includes(texto)) return false;
  }

  return Boolean(valor);
};

const normalizarPorcentaje = (valor) => {
  const numero = Number(valor);

  if (Number.isNaN(numero)) {
    throw new Error('El porcentaje de descuento debe ser un número válido');
  }

  if (numero < 0 || numero > 100) {
    throw new Error('El porcentaje de descuento debe estar entre 0 y 100');
  }

  return Number(numero.toFixed(2));
};

const validarFechas = (fechaInicio, fechaFin) => {
  if (!fechaInicio) {
    throw new Error('La fecha de inicio es obligatoria');
  }

  if (!fechaFin) {
    throw new Error('La fecha final es obligatoria');
  }

  const inicio = new Date(`${fechaInicio}T00:00:00`);
  const fin = new Date(`${fechaFin}T00:00:00`);

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    throw new Error('Las fechas no son válidas');
  }

  if (fin < inicio) {
    throw new Error('La fecha final no puede ser menor que la fecha de inicio');
  }
};

const validarCategoriaExiste = async (client, idCategoria) => {
  const resultado = await client.query(
    `
    SELECT
      id_categoria,
      nombre,
      activo
    FROM categorias
    WHERE id_categoria = $1
    LIMIT 1
    `,
    [idCategoria]
  );

  if (resultado.rows.length === 0) {
    throw new Error('La categoría seleccionada no existe');
  }

  if (resultado.rows[0].activo === false) {
    throw new Error('La categoría seleccionada está inactiva');
  }

  return resultado.rows[0];
};

const validarTraslapeOferta = async ({
  client,
  idCategoria,
  fechaInicio,
  fechaFin,
  idOfertaExcluir = null,
}) => {
  const params = [idCategoria, fechaInicio, fechaFin];

  let query = `
    SELECT
      id_oferta,
      nombre,
      fecha_inicio,
      fecha_fin
    FROM ofertas_categorias
    WHERE id_categoria = $1
      AND activo = true
      AND fecha_inicio <= $3::date
      AND fecha_fin >= $2::date
  `;

  if (idOfertaExcluir) {
    params.push(idOfertaExcluir);
    query += ` AND id_oferta <> $${params.length} `;
  }

  query += ` LIMIT 1 `;

  const resultado = await client.query(query, params);

  if (resultado.rows.length > 0) {
    const oferta = resultado.rows[0];

    throw new Error(
      `Ya existe una oferta activa para esta categoría en ese rango de fechas: ${oferta.nombre}`
    );
  }
};

export const listarOfertasCategorias = async (req, res) => {
  try {
    const {
      buscar,
      id_categoria,
      estado = 'TODAS',
      vigencia = 'TODAS',
    } = req.query;

    const params = [];

    let query = `
      SELECT
        oc.id_oferta,
        oc.id_categoria,
        c.nombre AS categoria,
        oc.nombre,
        oc.descripcion,
        oc.porcentaje_descuento,
        oc.fecha_inicio,
        oc.fecha_fin,
        oc.activo,
        oc.fecha_creacion,
        oc.fecha_actualizacion,

        CASE
          WHEN oc.activo = true
           AND CURRENT_DATE BETWEEN oc.fecha_inicio AND oc.fecha_fin
          THEN true
          ELSE false
        END AS vigente,

        CASE
          WHEN CURRENT_DATE < oc.fecha_inicio THEN 'PROGRAMADA'
          WHEN CURRENT_DATE BETWEEN oc.fecha_inicio AND oc.fecha_fin AND oc.activo = true THEN 'VIGENTE'
          WHEN CURRENT_DATE > oc.fecha_fin THEN 'VENCIDA'
          WHEN oc.activo = false THEN 'INACTIVA'
          ELSE 'SIN_ESTADO'
        END AS estatus_calculado
      FROM ofertas_categorias oc
      INNER JOIN categorias c
        ON c.id_categoria = oc.id_categoria
      WHERE 1 = 1
    `;

    if (id_categoria) {
      params.push(id_categoria);
      query += ` AND oc.id_categoria = $${params.length} `;
    }

    if (buscar && buscar.trim()) {
      params.push(`%${buscar.trim()}%`);
      query += `
        AND (
          oc.nombre ILIKE $${params.length}
          OR oc.descripcion ILIKE $${params.length}
          OR c.nombre ILIKE $${params.length}
        )
      `;
    }

    if (estado === 'ACTIVAS') {
      query += ` AND oc.activo = true `;
    }

    if (estado === 'INACTIVAS') {
      query += ` AND oc.activo = false `;
    }

    if (vigencia === 'VIGENTES') {
      query += `
        AND oc.activo = true
        AND CURRENT_DATE BETWEEN oc.fecha_inicio AND oc.fecha_fin
      `;
    }

    if (vigencia === 'PROGRAMADAS') {
      query += `
        AND CURRENT_DATE < oc.fecha_inicio
      `;
    }

    if (vigencia === 'VENCIDAS') {
      query += `
        AND CURRENT_DATE > oc.fecha_fin
      `;
    }

    query += `
      ORDER BY
        CASE
          WHEN oc.activo = true
           AND CURRENT_DATE BETWEEN oc.fecha_inicio AND oc.fecha_fin
          THEN 1
          WHEN oc.activo = true
           AND CURRENT_DATE < oc.fecha_inicio
          THEN 2
          WHEN oc.activo = false
          THEN 4
          ELSE 3
        END ASC,
        oc.fecha_inicio DESC,
        oc.id_oferta DESC
    `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      ofertas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar ofertas por categoría:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar ofertas por categoría',
    });
  }
};

export const obtenerOfertaCategoria = async (req, res) => {
  try {
    const { id_oferta } = req.params;

    const resultado = await pool.query(
      `
      SELECT
        oc.id_oferta,
        oc.id_categoria,
        c.nombre AS categoria,
        oc.nombre,
        oc.descripcion,
        oc.porcentaje_descuento,
        oc.fecha_inicio,
        oc.fecha_fin,
        oc.activo,
        oc.fecha_creacion,
        oc.fecha_actualizacion,

        CASE
          WHEN oc.activo = true
           AND CURRENT_DATE BETWEEN oc.fecha_inicio AND oc.fecha_fin
          THEN true
          ELSE false
        END AS vigente
      FROM ofertas_categorias oc
      INNER JOIN categorias c
        ON c.id_categoria = oc.id_categoria
      WHERE oc.id_oferta = $1
      LIMIT 1
      `,
      [id_oferta]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Oferta no encontrada',
      });
    }

    return res.json({
      ok: true,
      oferta: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener oferta por categoría:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener oferta',
    });
  }
};

export const crearOfertaCategoria = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      id_categoria,
      nombre,
      descripcion,
      porcentaje_descuento,
      fecha_inicio,
      fecha_fin,
      activo,
    } = req.body;

    const idCategoria = Number(id_categoria);

    if (!idCategoria || Number.isNaN(idCategoria)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La categoría es obligatoria',
      });
    }

    const nombreLimpio = normalizarTexto(nombre);

    if (!nombreLimpio) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la oferta es obligatorio',
      });
    }

    const porcentaje = normalizarPorcentaje(porcentaje_descuento);
    validarFechas(fecha_inicio, fecha_fin);

    const activoFinal = normalizarBooleano(activo, true);
    const descripcionLimpia = normalizarTexto(descripcion);

    await client.query('BEGIN');

    await validarCategoriaExiste(client, idCategoria);

    if (activoFinal) {
      await validarTraslapeOferta({
        client,
        idCategoria,
        fechaInicio: fecha_inicio,
        fechaFin: fecha_fin,
      });
    }

    const resultado = await client.query(
      `
      INSERT INTO ofertas_categorias (
        id_categoria,
        nombre,
        descripcion,
        porcentaje_descuento,
        fecha_inicio,
        fecha_fin,
        activo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        idCategoria,
        nombreLimpio,
        descripcionLimpia,
        porcentaje,
        fecha_inicio,
        fecha_fin,
        activoFinal,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Oferta creada correctamente',
      oferta: resultado.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al crear oferta por categoría:', error);

    return res.status(400).json({
      ok: false,
      mensaje: error.message || 'No se pudo crear la oferta',
    });
  } finally {
    client.release();
  }
};

export const actualizarOfertaCategoria = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_oferta } = req.params;

    const {
      id_categoria,
      nombre,
      descripcion,
      porcentaje_descuento,
      fecha_inicio,
      fecha_fin,
      activo,
    } = req.body;

    await client.query('BEGIN');

    const ofertaActualResultado = await client.query(
      `
      SELECT *
      FROM ofertas_categorias
      WHERE id_oferta = $1
      FOR UPDATE
      `,
      [id_oferta]
    );

    if (ofertaActualResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Oferta no encontrada',
      });
    }

    const ofertaActual = ofertaActualResultado.rows[0];

    const idCategoria =
      id_categoria === undefined || id_categoria === null || id_categoria === ''
        ? Number(ofertaActual.id_categoria)
        : Number(id_categoria);

    if (!idCategoria || Number.isNaN(idCategoria)) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'La categoría es obligatoria',
      });
    }

    const nombreLimpio =
      nombre === undefined
        ? ofertaActual.nombre
        : normalizarTexto(nombre);

    if (!nombreLimpio) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre de la oferta es obligatorio',
      });
    }

    const porcentaje =
      porcentaje_descuento === undefined ||
      porcentaje_descuento === null ||
      porcentaje_descuento === ''
        ? Number(ofertaActual.porcentaje_descuento)
        : normalizarPorcentaje(porcentaje_descuento);

    const fechaInicio = fecha_inicio || ofertaActual.fecha_inicio;
    const fechaFin = fecha_fin || ofertaActual.fecha_fin;

    validarFechas(fechaInicio, fechaFin);

    const activoFinal = normalizarBooleano(
      activo,
      ofertaActual.activo
    );

    const descripcionLimpia =
      descripcion === undefined
        ? ofertaActual.descripcion
        : normalizarTexto(descripcion);

    await validarCategoriaExiste(client, idCategoria);

    if (activoFinal) {
      await validarTraslapeOferta({
        client,
        idCategoria,
        fechaInicio,
        fechaFin,
        idOfertaExcluir: id_oferta,
      });
    }

    const resultado = await client.query(
      `
      UPDATE ofertas_categorias
      SET
        id_categoria = $1,
        nombre = $2,
        descripcion = $3,
        porcentaje_descuento = $4,
        fecha_inicio = $5,
        fecha_fin = $6,
        activo = $7,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_oferta = $8
      RETURNING *
      `,
      [
        idCategoria,
        nombreLimpio,
        descripcionLimpia,
        porcentaje,
        fechaInicio,
        fechaFin,
        activoFinal,
        id_oferta,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Oferta actualizada correctamente',
      oferta: resultado.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al actualizar oferta por categoría:', error);

    return res.status(400).json({
      ok: false,
      mensaje: error.message || 'No se pudo actualizar la oferta',
    });
  } finally {
    client.release();
  }
};

export const cambiarEstadoOfertaCategoria = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_oferta } = req.params;
    const { activo } = req.body;

    await client.query('BEGIN');

    const ofertaResultado = await client.query(
      `
      SELECT *
      FROM ofertas_categorias
      WHERE id_oferta = $1
      FOR UPDATE
      `,
      [id_oferta]
    );

    if (ofertaResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Oferta no encontrada',
      });
    }

    const oferta = ofertaResultado.rows[0];
    const activoFinal = normalizarBooleano(activo, !oferta.activo);

    if (activoFinal) {
      await validarTraslapeOferta({
        client,
        idCategoria: oferta.id_categoria,
        fechaInicio: oferta.fecha_inicio,
        fechaFin: oferta.fecha_fin,
        idOfertaExcluir: id_oferta,
      });
    }

    const resultado = await client.query(
      `
      UPDATE ofertas_categorias
      SET
        activo = $1,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_oferta = $2
      RETURNING *
      `,
      [activoFinal, id_oferta]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: activoFinal
        ? 'Oferta activada correctamente'
        : 'Oferta desactivada correctamente',
      oferta: resultado.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al cambiar estado de oferta:', error);

    return res.status(400).json({
      ok: false,
      mensaje: error.message || 'No se pudo cambiar el estado de la oferta',
    });
  } finally {
    client.release();
  }
};

export const eliminarOfertaCategoria = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_oferta } = req.params;

    await client.query('BEGIN');

    const ofertaResultado = await client.query(
      `
      SELECT *
      FROM ofertas_categorias
      WHERE id_oferta = $1
      FOR UPDATE
      `,
      [id_oferta]
    );

    if (ofertaResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Oferta no encontrada',
      });
    }

    const usadaEnVentasResultado = await client.query(
      `
      SELECT 1
      FROM venta_detalle
      WHERE id_oferta = $1
      LIMIT 1
      `,
      [id_oferta]
    );

    if (usadaEnVentasResultado.rows.length > 0) {
      const resultado = await client.query(
        `
        UPDATE ofertas_categorias
        SET
          activo = false,
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_oferta = $1
        RETURNING *
        `,
        [id_oferta]
      );

      await client.query('COMMIT');

      return res.json({
        ok: true,
        mensaje:
          'La oferta ya tiene ventas asociadas, por seguridad solo fue desactivada',
        oferta: resultado.rows[0],
      });
    }

    const resultado = await client.query(
      `
      DELETE FROM ofertas_categorias
      WHERE id_oferta = $1
      RETURNING *
      `,
      [id_oferta]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      mensaje: 'Oferta eliminada correctamente',
      oferta: resultado.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al eliminar oferta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al eliminar oferta',
    });
  } finally {
    client.release();
  }
};