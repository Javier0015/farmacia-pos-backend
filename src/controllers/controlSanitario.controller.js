import { pool } from '../config/db.js';

const esAdministrador = (usuario) => {
  const rol = String(
    usuario?.rol ||
    usuario?.tipo_usuario ||
    usuario?.perfil ||
    ''
  ).toUpperCase();

  return (
    rol === 'ADMIN' ||
    rol === 'ADMINISTRADOR' ||
    rol === 'SUPER_ADMIN' ||
    rol === 'SUPERADMIN'
  );
};

export const listarLibroControlSanitario = async (req, res) => {
  try {
    const {
      sucursal,
      producto,
      tipo_receta,
      tipo_surtido,
      fecha_inicio,
      fecha_fin,
      buscar,
    } = req.query;

    const usuario = req.usuario;
    const admin = esAdministrador(usuario);

    const params = [];

    let query = `
      SELECT
        id_movimiento,
        fecha_registro,
        tipo_movimiento,
        estatus,

        id_venta,
        folio_venta,
        fecha_venta,
        estado_venta,
        metodo_pago,
        total_venta,

        id_producto,
        codigo_barras,
        producto,
        laboratorio,
        presentacion,
        requiere_receta,
        es_controlado,

        id_lote,
        lote,
        fecha_caducidad,

        id_sucursal,
        sucursal,

        cantidad_entrada,
        cantidad_salida,
        existencia_despues,

        tipo_receta,
        numero_receta,
        fecha_receta,

        medico_nombre,
        medico_cedula,

        paciente_nombre,
        paciente_telefono,

        cantidad_recetada,
        cantidad_surtida,
        cantidad_pendiente,
        tipo_surtido,

        observaciones,

        id_usuario,
        usuario_registro
      FROM vw_libro_control_sanitario
      WHERE 1 = 1
    `;

    /**
     * Seguridad por rol:
     * - Administrador puede filtrar por cualquier sucursal.
     * - Cajero queda forzado a su sucursal.
     */
    if (admin) {
      if (sucursal) {
        params.push(Number(sucursal));
        query += ` AND id_sucursal = $${params.length}`;
      }
    } else {
      const idSucursalUsuario =
        usuario?.id_sucursal ||
        usuario?.sucursal_id ||
        usuario?.idSucursal;

      if (!idSucursalUsuario) {
        return res.status(403).json({
          ok: false,
          mensaje: 'El usuario no tiene sucursal asignada.',
        });
      }

      params.push(Number(idSucursalUsuario));
      query += ` AND id_sucursal = $${params.length}`;
    }

    if (producto) {
      params.push(Number(producto));
      query += ` AND id_producto = $${params.length}`;
    }

    if (tipo_receta) {
      params.push(String(tipo_receta).toUpperCase());
      query += ` AND UPPER(tipo_receta) = $${params.length}`;
    }

    if (tipo_surtido) {
      params.push(String(tipo_surtido).toUpperCase());
      query += ` AND UPPER(tipo_surtido) = $${params.length}`;
    }

    if (fecha_inicio) {
      params.push(fecha_inicio);
      query += ` AND fecha_registro::date >= $${params.length}`;
    }

    if (fecha_fin) {
      params.push(fecha_fin);
      query += ` AND fecha_registro::date <= $${params.length}`;
    }

    if (buscar) {
      params.push(`%${String(buscar).trim()}%`);
      query += `
        AND (
          producto ILIKE $${params.length}
          OR codigo_barras ILIKE $${params.length}
          OR folio_venta ILIKE $${params.length}
          OR numero_receta ILIKE $${params.length}
          OR medico_nombre ILIKE $${params.length}
          OR medico_cedula ILIKE $${params.length}
          OR paciente_nombre ILIKE $${params.length}
          OR lote ILIKE $${params.length}
        )
      `;
    }

    query += `
      ORDER BY fecha_registro DESC, id_movimiento DESC
    `;

    const resultado = await pool.query(query, params);

    return res.json({
      ok: true,
      total: resultado.rows.length,
      registros: resultado.rows,
      permisos: {
        administrador: admin,
        restringido_por_sucursal: !admin,
      },
    });
  } catch (error) {
    console.error('Error al listar libro de control sanitario:', error);

    return res.status(500).json({
      ok: false,
      mensaje: error.message || 'Error interno al consultar el libro de control sanitario.',
    });
  }
};