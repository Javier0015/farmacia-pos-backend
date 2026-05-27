import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import { pool } from '../config/db.js';


const REPORTES_CAJA_DIR = path.join(process.cwd(), 'uploads', 'reportes-caja');

// Logo usado dentro del PDF.
// En tu estructura actual está en: backend/src/assets/logoShaddai.png
// Se dejan rutas alternativas para que no falle si después mueves el servidor.
const LOGO_SHADDAI_PATHS = [
  path.join(process.cwd(), 'src', 'assets', 'logoShaddai.png'),
  path.join(process.cwd(), 'assets', 'logoShaddai.png'),
  path.join(process.cwd(), 'backend', 'src', 'assets', 'logoShaddai.png'),
];

const obtenerLogoReporteBase64 = async () => {
  for (const rutaLogo of LOGO_SHADDAI_PATHS) {
    try {
      const bufferLogo = await fs.readFile(rutaLogo);
      const extension = path.extname(rutaLogo).toLowerCase();

      const mimeType =
        extension === '.jpg' || extension === '.jpeg'
          ? 'image/jpeg'
          : extension === '.webp'
            ? 'image/webp'
            : 'image/png';

      return `data:${mimeType};base64,${bufferLogo.toString('base64')}`;
    } catch {
      // Intenta con la siguiente ruta.
    }
  }

  console.warn(
    'No se encontró el logo para el reporte PDF. Rutas revisadas:',
    LOGO_SHADDAI_PATHS
  );

  return null;
};

const formatoMonedaMXN = (valor) => {
  return Number(valor || 0).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
  });
};

const formatoFechaMX = (fecha) => {
  if (!fecha) return '—';

  return new Date(fecha).toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const escapeHtml = (valor) => {
  return String(valor ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const normalizarMetodoPagoReporte = (metodo) => {
  const valor = String(metodo || '').trim().toUpperCase();
  return valor || '—';
};

const parsearPagosReporte = (pagos) => {
  if (!pagos) return [];
  if (Array.isArray(pagos)) return pagos;

  if (typeof pagos === 'string') {
    try {
      const parsed = JSON.parse(pagos);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

const formatearPagosReporte = (venta) => {
  const pagos = parsearPagosReporte(venta?.pagos)
    .filter((pago) => pago?.metodo_pago)
    .map((pago) => {
      const metodo = normalizarMetodoPagoReporte(pago.metodo_pago);
      const monto = pago.monto === null || pago.monto === undefined ? null : Number(pago.monto);
      return monto === null ? metodo : `${metodo}: ${formatoMonedaMXN(monto)}`;
    });

  if (pagos.length > 0) return pagos.join(' | ');

  return normalizarMetodoPagoReporte(venta?.metodo_pago);
};

const obtenerDatosReporteCierreCaja = async (idSesion) => {
  const sesionResultado = await pool.query(
    `
    SELECT 
      cs.id_sesion,
      cs.id_caja,
      c.nombre AS caja,
      cs.id_sucursal,
      s.nombre AS sucursal,
      cs.id_usuario_apertura,
      ua.nombre AS usuario_apertura,
      cs.id_usuario_cierre,
      uc.nombre AS usuario_cierre,
      cs.monto_inicial,
      cs.monto_final_sistema,
      cs.monto_final_real,
      cs.diferencia,
      cs.estado,
      cs.fecha_apertura,
      cs.fecha_cierre
    FROM caja_sesiones cs
    INNER JOIN cajas c ON c.id_caja = cs.id_caja
    INNER JOIN sucursales s ON s.id_sucursal = cs.id_sucursal
    INNER JOIN usuarios ua ON ua.id_usuario = cs.id_usuario_apertura
    LEFT JOIN usuarios uc ON uc.id_usuario = cs.id_usuario_cierre
    WHERE cs.id_sesion = $1
    `,
    [idSesion]
  );

  if (sesionResultado.rows.length === 0) {
    return null;
  }

  const sesion = sesionResultado.rows[0];

  const movimientosAgrupadosResultado = await pool.query(
    `
    SELECT
      tipo_movimiento,
      metodo_pago,
      COALESCE(SUM(monto), 0)::numeric(12,2) AS total
    FROM caja_movimientos
    WHERE id_sesion = $1
    GROUP BY tipo_movimiento, metodo_pago
    ORDER BY tipo_movimiento ASC, metodo_pago ASC
    `,
    [idSesion]
  );

  const movimientosAgrupados = movimientosAgrupadosResultado.rows;

  const resumenCalculado = construirResumenDesdeMovimientos({
    sesion,
    movimientos: movimientosAgrupados,
  });

  const resumen = {
    ...resumenCalculado,
    monto_final_sistema: Number(
      sesion.monto_final_sistema ?? resumenCalculado.monto_final_sistema
    ),
    monto_final_real: Number(sesion.monto_final_real || 0),
    diferencia: Number(sesion.diferencia || 0),
  };

  const puntosResultado = await pool.query(
    `
    SELECT
      COALESCE(SUM(cpm.puntos), 0)::numeric(12,2) AS puntos_ganados_cajero
    FROM cajeros_puntos_movimientos cpm
    INNER JOIN ventas v ON v.id_venta = cpm.id_venta
    WHERE v.id_sesion = $1
      AND v.estado = 'COMPLETADA'
      AND cpm.tipo_movimiento = 'VENTA'
    `,
    [idSesion]
  );

  resumen.puntos_ganados = Number(
    puntosResultado.rows[0]?.puntos_ganados_cajero || 0
  );


  const ventasResultado = await pool.query(
    `
    SELECT
      v.id_venta,
      v.folio,
      v.fecha_venta,
      v.metodo_pago,
      v.subtotal,
      v.descuento,
      v.impuesto,
      v.total,
      v.estado,
      v.puntos_ganados,
      u.nombre AS usuario,
      COALESCE(
        json_agg(
          json_build_object(
            'id_pago', vp.id_pago,
            'metodo_pago', vp.metodo_pago,
            'monto', vp.monto,
            'referencia', vp.referencia,
            'fecha_pago', vp.fecha_pago
          )
          ORDER BY vp.id_pago
        ) FILTER (WHERE vp.id_pago IS NOT NULL),
        '[]'
      ) AS pagos
    FROM ventas v
    INNER JOIN usuarios u ON u.id_usuario = v.id_usuario
    LEFT JOIN ventas_pagos vp ON vp.id_venta = v.id_venta
    WHERE v.id_sesion = $1
    GROUP BY
      v.id_venta,
      v.folio,
      v.fecha_venta,
      v.metodo_pago,
      v.subtotal,
      v.descuento,
      v.impuesto,
      v.total,
      v.estado,
      v.puntos_ganados,
      u.nombre
    ORDER BY v.fecha_venta ASC
    `,
    [idSesion]
  );

  const productosResultado = await pool.query(
    `
    SELECT
      p.id_producto,
      p.nombre AS producto,
      COALESCE(SUM(vd.cantidad), 0)::numeric(12,2) AS cantidad_total,
      COALESCE(SUM(vd.subtotal), 0)::numeric(12,2) AS total_vendido
    FROM venta_detalle vd
    INNER JOIN ventas v ON v.id_venta = vd.id_venta
    INNER JOIN productos p ON p.id_producto = vd.id_producto
    WHERE v.id_sesion = $1
      AND v.estado = 'COMPLETADA'
    GROUP BY p.id_producto, p.nombre
    ORDER BY p.nombre ASC
    `,
    [idSesion]
  );

  const movimientosResultado = await pool.query(
    `
    SELECT
      cm.id_movimiento,
      cm.id_sesion,
      cm.id_sucursal,
      cm.tipo_movimiento,
      cm.concepto,
      cm.monto,
      cm.metodo_pago,
      cm.referencia,
      cm.observaciones,
      cm.id_usuario,
      u.nombre AS usuario,
      cm.fecha_movimiento
    FROM caja_movimientos cm
    INNER JOIN usuarios u ON u.id_usuario = cm.id_usuario
    WHERE cm.id_sesion = $1
    ORDER BY cm.fecha_movimiento ASC
    `,
    [idSesion]
  );

  const reportePdfResultado = await pool.query(
    `
    SELECT
      id_reporte,
      id_sesion,
      archivo_pdf,
      nombre_archivo,
      fecha_generacion
    FROM caja_reportes_cierre
    WHERE id_sesion = $1
      AND activo = true
    ORDER BY fecha_generacion DESC
    LIMIT 1
    `,
    [idSesion]
  ).catch(() => ({ rows: [] }));

  return {
    ok: true,
    sesion,
    resumen,
    ventas: ventasResultado.rows,
    productos: productosResultado.rows,
    movimientos: movimientosResultado.rows,
    desglose: movimientosAgrupados,
    reporte_pdf: reportePdfResultado.rows[0] || null,
  };
};

const construirHtmlReporteCierreCaja = ({ sesion, resumen, ventas, productos, movimientos, logoBase64 }) => {
  const ventasPuntos = Number(resumen.ventas_puntos || resumen.ventas_puntos_canjeados || 0);
  const puntosGanados = Number(resumen.puntos_ganados || 0);
  const salidasTotales =
    Number(resumen.salidas_efectivo || 0) +
    Number(resumen.gastos_efectivo || 0) +
    Number(resumen.retiros_efectivo || 0) +
    Number(resumen.pagos_proveedor_efectivo || 0);
  const diferencia = Number(resumen.diferencia || sesion.diferencia || 0);

  const filasVentas = ventas.length
    ? ventas.map((venta) => `
      <tr>
        <td>${escapeHtml(venta.folio || '—')}</td>
        <td>${escapeHtml(formatoFechaMX(venta.fecha_venta))}</td>
        <td>${escapeHtml(formatearPagosReporte(venta))}</td>
        <td class="right strong">${escapeHtml(formatoMonedaMXN(venta.total))}</td>
        <td>${escapeHtml(venta.usuario || '—')}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="5" class="empty">No hay ventas registradas.</td></tr>';

  const filasProductos = productos.length
    ? productos.map((producto) => `
      <tr>
        <td>${escapeHtml(producto.producto || '—')}</td>
        <td class="right strong">${escapeHtml(producto.cantidad_total || 0)}</td>
        <td class="right strong">${escapeHtml(formatoMonedaMXN(producto.total_vendido))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="3" class="empty">No hay productos vendidos.</td></tr>';

  const filasMovimientos = movimientos.length
    ? movimientos.map((movimiento) => `
      <tr>
        <td>${escapeHtml(formatoFechaMX(movimiento.fecha_movimiento))}</td>
        <td>${escapeHtml(movimiento.tipo_movimiento || '—')}</td>
        <td>${escapeHtml(movimiento.concepto || '—')}</td>
        <td>${escapeHtml(movimiento.metodo_pago || '—')}</td>
        <td class="right strong">${escapeHtml(formatoMonedaMXN(movimiento.monto))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="5" class="empty">No hay movimientos registrados.</td></tr>';

  return `
  <!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>Reporte cierre caja ${escapeHtml(sesion.id_sesion)}</title>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          color: #0f172a;
          background: #ffffff;
          font-size: 11px;
        }
        .page { padding: 26px; }
        .header {
          background: linear-gradient(135deg, #0369a1, #0ea5e9);
          color: white;
          border-radius: 18px;
          padding: 24px;
          margin-bottom: 18px;
        }
        .header-row { display: flex; justify-content: space-between; align-items: center; gap: 24px; }
        .brand-block { display: flex; align-items: center; gap: 16px; min-width: 0; }
        .logo-wrap {
          width: 72px;
          height: 72px;
          border-radius: 18px;
          background: rgba(255,255,255,.95);
          border: 1px solid rgba(255,255,255,.65);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 8px;
          flex: 0 0 auto;
        }
        .logo-wrap img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          display: block;
        }
        .logo-fallback {
          width: 72px;
          height: 72px;
          border-radius: 18px;
          background: rgba(255,255,255,.2);
          border: 1px solid rgba(255,255,255,.4);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          font-weight: 900;
          letter-spacing: .04em;
          flex: 0 0 auto;
        }
        .brand { font-size: 13px; font-weight: 700; opacity: .95; }
        h1 { margin: 5px 0 6px; font-size: 27px; line-height: 1.1; }
        .subtitle { margin: 0; opacity: .92; }
        .badge {
          display: inline-block;
          background: rgba(255,255,255,.16);
          border: 1px solid rgba(255,255,255,.25);
          border-radius: 999px;
          padding: 8px 12px;
          font-weight: 800;
          text-align: right;
        }
        h2 { font-size: 15px; margin: 16px 0 10px; }
        .grid { display: grid; gap: 10px; }
        .grid-3 { grid-template-columns: repeat(3, 1fr); }
        .grid-5 { grid-template-columns: repeat(5, 1fr); }
        .grid-6 { grid-template-columns: repeat(6, 1fr); }
        .card {
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 12px;
          background: #ffffff;
        }
        .metric {
          border-radius: 14px;
          padding: 12px;
          border: 1px solid #bae6fd;
          background: #f0f9ff;
        }
        .label {
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: .04em;
          color: #64748b;
          font-weight: 800;
          margin-bottom: 5px;
        }
        .value { font-size: 13px; font-weight: 800; word-break: break-word; }
        .metric .value { font-size: 16px; color: #0369a1; }
        .conciliation {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 12px;
          margin-top: 14px;
        }
        .diff-ok { background: #ecfdf5; border-color: #a7f3d0; }
        .diff-bad { background: #fef2f2; border-color: #fecaca; }
        .diff-bad .value { color: #b91c1c; }
        table {
          width: 100%;
          border-collapse: collapse;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 12px;
        }
        th {
          background: #f1f5f9;
          color: #475569;
          text-transform: uppercase;
          font-size: 9px;
          letter-spacing: .04em;
          padding: 9px;
          text-align: left;
        }
        td {
          border-top: 1px solid #e2e8f0;
          padding: 8px;
          vertical-align: top;
          color: #334155;
        }
        .right { text-align: right; }
        .strong { font-weight: 800; }
        .empty { text-align: center; color: #64748b; padding: 18px; }
        .total-box {
          background: #f0f9ff;
          border: 2px solid #bae6fd;
          border-radius: 16px;
          padding: 14px;
          margin-top: 8px;
        }
        .total-row {
          display: flex;
          justify-content: space-between;
          border-bottom: 1px solid #bae6fd;
          padding: 6px 0;
          gap: 16px;
        }
        .total-row:last-child { border-bottom: 0; }
        .danger { color: #b91c1c; }
        .footer {
          color: #64748b;
          font-size: 9px;
          text-align: center;
          margin-top: 18px;
        }
        @page { size: letter; margin: 10mm; }
      </style>
    </head>
    <body>
      <main class="page">
        <section class="header">
          <div class="header-row">
            <div class="brand-block">
              ${logoBase64
                ? `<div class="logo-wrap"><img src="${escapeHtml(logoBase64)}" alt="Farmacia Shaddai" /></div>`
                : '<div class="logo-fallback">FS</div>'}
              <div>
                <div class="brand">Farmacia Shaddai</div>
                <h1>Reporte de cierre de caja</h1>
                <p class="subtitle">Corte generado al finalizar la sesión de caja.</p>
              </div>
            </div>
            <div style="text-align:right; flex:0 0 auto;">
              <div class="badge">Sesión #${escapeHtml(sesion.id_sesion || '—')}</div>
              <p style="margin:10px 0 0; opacity:.9; font-size:10px;">Fecha cierre</p>
              <strong>${escapeHtml(formatoFechaMX(sesion.fecha_cierre))}</strong>
            </div>
          </div>
        </section>

        <section>
          <h2>Datos de la sesión</h2>
          <div class="grid grid-3">
            <div class="card"><div class="label">Sucursal</div><div class="value">${escapeHtml(sesion.sucursal)}</div></div>
            <div class="card"><div class="label">Caja</div><div class="value">${escapeHtml(sesion.caja)}</div></div>
            <div class="card"><div class="label">Usuario cierre</div><div class="value">${escapeHtml(sesion.usuario_cierre || '—')}</div></div>
            <div class="card"><div class="label">Fecha apertura</div><div class="value">${escapeHtml(formatoFechaMX(sesion.fecha_apertura))}</div></div>
            <div class="card"><div class="label">Fecha cierre</div><div class="value">${escapeHtml(formatoFechaMX(sesion.fecha_cierre))}</div></div>
            <div class="card"><div class="label">Estado</div><div class="value">${escapeHtml(sesion.estado)}</div></div>
          </div>
        </section>

        <section>
          <h2>Resumen del corte</h2>
          <div class="grid grid-6">
            <div class="metric"><div class="label">Monto inicial</div><div class="value">${escapeHtml(formatoMonedaMXN(resumen.monto_inicial))}</div></div>
            <div class="metric"><div class="label">Ventas efectivo</div><div class="value">${escapeHtml(formatoMonedaMXN(resumen.ventas_efectivo))}</div></div>
            <div class="metric"><div class="label">Ventas no efectivo</div><div class="value">${escapeHtml(formatoMonedaMXN(resumen.ventas_no_efectivo))}</div></div>
            <div class="metric"><div class="label">Ventas puntos</div><div class="value">${escapeHtml(formatoMonedaMXN(ventasPuntos))}</div></div>
            <div class="metric"><div class="label">Puntos cajero</div><div class="value">${escapeHtml(puntosGanados.toFixed(2))}</div></div>
            <div class="metric"><div class="label">Total vendido</div><div class="value">${escapeHtml(formatoMonedaMXN(resumen.ventas_total))}</div></div>
          </div>
        </section>

        <section class="conciliation">
          <div class="grid grid-5">
            <div class="card"><div class="label">Entradas efectivo</div><div class="value">${escapeHtml(formatoMonedaMXN(resumen.entradas_efectivo))}</div></div>
            <div class="card"><div class="label">Salidas / gastos</div><div class="value">${escapeHtml(formatoMonedaMXN(salidasTotales))}</div></div>
            <div class="card"><div class="label">Esperado en caja</div><div class="value">${escapeHtml(formatoMonedaMXN(resumen.monto_final_sistema))}</div></div>
            <div class="card"><div class="label">Contado</div><div class="value">${escapeHtml(formatoMonedaMXN(resumen.monto_final_real))}</div></div>
            <div class="card ${diferencia === 0 ? 'diff-ok' : 'diff-bad'}"><div class="label">Diferencia</div><div class="value">${escapeHtml(formatoMonedaMXN(diferencia))}</div></div>
          </div>
        </section>

        <section>
          <h2>Ventas realizadas</h2>
          <table>
            <thead><tr><th>Folio</th><th>Fecha</th><th>Pagos</th><th class="right">Total</th><th>Usuario</th></tr></thead>
            <tbody>${filasVentas}</tbody>
          </table>
        </section>

        <section>
          <h2>Productos vendidos</h2>
          <table>
            <thead><tr><th>Producto</th><th class="right">Cantidad</th><th class="right">Total vendido</th></tr></thead>
            <tbody>${filasProductos}</tbody>
          </table>
        </section>

        <section>
          <h2>Movimientos de caja</h2>
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Método</th><th class="right">Monto</th></tr></thead>
            <tbody>${filasMovimientos}</tbody>
          </table>
        </section>

        <section class="total-box">
          <h2 style="margin-top:0">Resultado final del corte</h2>
          <div class="total-row"><span>Total vendido</span><strong>${escapeHtml(formatoMonedaMXN(resumen.ventas_total))}</strong></div>
          <div class="total-row"><span>Total no efectivo</span><strong>${escapeHtml(formatoMonedaMXN(resumen.ventas_no_efectivo))}</strong></div>
          <div class="total-row"><span>Ventas con puntos</span><strong>${escapeHtml(formatoMonedaMXN(ventasPuntos))}</strong></div>
          <div class="total-row"><span>Puntos cajero</span><strong>${escapeHtml(puntosGanados.toFixed(2))}</strong></div>
          <div class="total-row"><span>Monto esperado en caja física</span><strong>${escapeHtml(formatoMonedaMXN(resumen.monto_final_sistema))}</strong></div>
          <div class="total-row"><span>Monto contado</span><strong>${escapeHtml(formatoMonedaMXN(resumen.monto_final_real))}</strong></div>
          <div class="total-row"><span><strong>Diferencia</strong></span><strong class="${diferencia !== 0 ? 'danger' : ''}">${escapeHtml(formatoMonedaMXN(diferencia))}</strong></div>
        </section>

        <div class="footer">
          Documento generado automáticamente · ${escapeHtml(formatoFechaMX(new Date()))}
        </div>
      </main>
    </body>
  </html>
  `;
};

const generarReporteCierreCajaPDF = async ({ idSesion, idUsuario }) => {
  const datosReporte = await obtenerDatosReporteCierreCaja(idSesion);

  if (!datosReporte) {
    throw new Error('No se encontró la sesión para generar el reporte PDF');
  }

  await fs.mkdir(REPORTES_CAJA_DIR, { recursive: true });

  const nombreArchivo = `cierre-caja-${idSesion}-${Date.now()}.pdf`;
  const rutaAbsoluta = path.join(REPORTES_CAJA_DIR, nombreArchivo);
  const rutaRelativa = `/uploads/reportes-caja/${nombreArchivo}`;
  const logoBase64 = await obtenerLogoReporteBase64();
  const html = construirHtmlReporteCierreCaja({
    ...datosReporte,
    logoBase64,
  });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: rutaAbsoluta,
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
    });
  } finally {
    await browser.close();
  }

  const reporteGuardado = await pool.query(
    `
    INSERT INTO caja_reportes_cierre (
      id_sesion,
      id_sucursal,
      id_caja,
      archivo_pdf,
      nombre_archivo,
      generado_por
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id_sesion)
    DO UPDATE SET
      archivo_pdf = EXCLUDED.archivo_pdf,
      nombre_archivo = EXCLUDED.nombre_archivo,
      generado_por = EXCLUDED.generado_por,
      fecha_generacion = CURRENT_TIMESTAMP,
      activo = true
    RETURNING *
    `,
    [
      idSesion,
      datosReporte.sesion.id_sucursal,
      datosReporte.sesion.id_caja,
      rutaRelativa,
      nombreArchivo,
      idUsuario || datosReporte.sesion.id_usuario_cierre || null,
    ]
  );

  return reporteGuardado.rows[0];
};

const construirResumenDesdeMovimientos = ({ sesion, movimientos }) => {
  const montoInicial = Number(sesion?.monto_inicial || 0);

  const sumar = (tipo, metodo = null) => {
    const tipoFinal = String(tipo || '').toUpperCase();
    const metodoFinal = metodo ? String(metodo).toUpperCase() : null;

    return movimientos
      .filter((m) => {
        const tipoMovimiento = String(m.tipo_movimiento || '').toUpperCase();
        const metodoPago = String(m.metodo_pago || '').toUpperCase();

        if (metodoFinal) {
          return tipoMovimiento === tipoFinal && metodoPago === metodoFinal;
        }

        return tipoMovimiento === tipoFinal;
      })
      .reduce((acc, m) => acc + Number(m.total || 0), 0);
  };

  // =========================
  // VENTAS BRUTAS POR MÉTODO
  // =========================
  const ventasEfectivoBruto = sumar('VENTA', 'EFECTIVO');
  const ventasTarjetaBruto = sumar('VENTA', 'TARJETA');
  const ventasTransferenciaBruto = sumar('VENTA', 'TRANSFERENCIA');
  const ventasPuntosBruto = sumar('VENTA', 'PUNTOS');

  // =========================
  // DEVOLUCIONES POR MÉTODO
  // =========================
  const devolucionesEfectivo = sumar('DEVOLUCION_VENTA', 'EFECTIVO');
  const devolucionesTarjeta = sumar('DEVOLUCION_VENTA', 'TARJETA');
  const devolucionesTransferencia = sumar('DEVOLUCION_VENTA', 'TRANSFERENCIA');
  const devolucionesPuntos = sumar('DEVOLUCION_VENTA', 'PUNTOS');

  const devolucionesTotal =
    devolucionesEfectivo +
    devolucionesTarjeta +
    devolucionesTransferencia +
    devolucionesPuntos;

  // =========================
  // VENTAS NETAS
  // =========================
  const ventasEfectivoNeto = ventasEfectivoBruto - devolucionesEfectivo;
  const ventasTarjetaNeto = ventasTarjetaBruto - devolucionesTarjeta;
  const ventasTransferenciaNeto =
    ventasTransferenciaBruto - devolucionesTransferencia;
  const ventasPuntosNeto = ventasPuntosBruto - devolucionesPuntos;

  const ventasNoEfectivoBruto =
    ventasTarjetaBruto + ventasTransferenciaBruto;

  const ventasNoEfectivoNeto =
    ventasTarjetaNeto + ventasTransferenciaNeto;

  const ventasDigitalesBruto =
    ventasTarjetaBruto + ventasTransferenciaBruto + ventasPuntosBruto;

  const ventasDigitalesNeto =
    ventasTarjetaNeto + ventasTransferenciaNeto + ventasPuntosNeto;

  const ventasTotalBruto =
    ventasEfectivoBruto +
    ventasTarjetaBruto +
    ventasTransferenciaBruto +
    ventasPuntosBruto;

  const ventasTotalNeto =
    ventasEfectivoNeto +
    ventasTarjetaNeto +
    ventasTransferenciaNeto +
    ventasPuntosNeto;

  // =========================
  // MOVIMIENTOS MANUALES DE EFECTIVO
  // =========================
  const entradasEfectivo = sumar('ENTRADA', 'EFECTIVO');
  const salidasEfectivo = sumar('SALIDA', 'EFECTIVO');
  const gastosEfectivo = sumar('GASTO', 'EFECTIVO');
  const retirosEfectivo = sumar('RETIRO', 'EFECTIVO');
  const pagosProveedorEfectivo = sumar('PAGO_PROVEEDOR', 'EFECTIVO');

  // =========================
  // CAJA FÍSICA
  // =========================
  // Solo debe afectar efectivo:
  // monto inicial + ventas efectivo + entradas - salidas/gastos/retiros/pagos proveedor.
  // Tarjeta, transferencia y puntos NO entran a caja física.
  const montoFinalSistema =
    montoInicial +
    ventasEfectivoNeto +
    entradasEfectivo -
    salidasEfectivo -
    gastosEfectivo -
    retirosEfectivo -
    pagosProveedorEfectivo;

  return {
    monto_inicial: montoInicial,

    // Campos principales usados por frontend.
    ventas_efectivo: ventasEfectivoNeto,
    ventas_tarjeta: ventasTarjetaNeto,
    ventas_transferencia: ventasTransferenciaNeto,
    ventas_puntos: ventasPuntosNeto,

    // Mantengo ventas_no_efectivo como tarjeta + transferencia.
    // Los puntos van separados para que no confundan la tarjeta "Total no efectivo".
    ventas_no_efectivo: ventasNoEfectivoNeto,

    // Campo adicional por si quieres mostrar tarjeta + transferencia + puntos.
    ventas_digitales: ventasDigitalesNeto,

    ventas_total: ventasTotalNeto,

    // Brutos.
    ventas_efectivo_bruto: ventasEfectivoBruto,
    ventas_tarjeta_bruto: ventasTarjetaBruto,
    ventas_transferencia_bruto: ventasTransferenciaBruto,
    ventas_puntos_bruto: ventasPuntosBruto,
    ventas_no_efectivo_bruto: ventasNoEfectivoBruto,
    ventas_digitales_bruto: ventasDigitalesBruto,
    ventas_total_bruto: ventasTotalBruto,

    // Netos.
    ventas_efectivo_neto: ventasEfectivoNeto,
    ventas_tarjeta_neto: ventasTarjetaNeto,
    ventas_transferencia_neto: ventasTransferenciaNeto,
    ventas_puntos_neto: ventasPuntosNeto,
    ventas_no_efectivo_neto: ventasNoEfectivoNeto,
    ventas_digitales_neto: ventasDigitalesNeto,
    ventas_total_neto: ventasTotalNeto,

    entradas_efectivo: entradasEfectivo,
    salidas_efectivo: salidasEfectivo,
    gastos_efectivo: gastosEfectivo,
    retiros_efectivo: retirosEfectivo,
    pagos_proveedor_efectivo: pagosProveedorEfectivo,

    devoluciones_efectivo: devolucionesEfectivo,
    devoluciones_tarjeta: devolucionesTarjeta,
    devoluciones_transferencia: devolucionesTransferencia,
    devoluciones_puntos: devolucionesPuntos,
    devoluciones_total: devolucionesTotal,

    monto_final_sistema: montoFinalSistema,
  };
};

export const listarCajas = async (req, res) => {
  try {
    const { sucursal } = req.query;

    if (!sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro sucursal es obligatorio',
      });
    }

    const resultado = await pool.query(
      `
      SELECT 
        id_caja,
        id_sucursal,
        nombre,
        activo,
        fecha_creacion
      FROM cajas
      WHERE id_sucursal = $1
      ORDER BY id_caja ASC
      `,
      [sucursal]
    );

    return res.json({
      ok: true,
      cajas: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar cajas:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar cajas',
    });
  }
};

export const obtenerSesionAbierta = async (req, res) => {
  try {
    const { id_caja } = req.query;

    if (!id_caja) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro id_caja es obligatorio',
      });
    }

    const resultado = await pool.query(
      `
      SELECT 
        cs.id_sesion,
        cs.id_caja,
        c.nombre AS caja,
        cs.id_sucursal,
        s.nombre AS sucursal,
        cs.id_usuario_apertura,
        u.nombre AS usuario_apertura,
        cs.monto_inicial,
        cs.monto_final_sistema,
        cs.monto_final_real,
        cs.diferencia,
        cs.estado,
        cs.fecha_apertura,
        cs.fecha_cierre
      FROM caja_sesiones cs
      INNER JOIN cajas c ON c.id_caja = cs.id_caja
      INNER JOIN sucursales s ON s.id_sucursal = cs.id_sucursal
      INNER JOIN usuarios u ON u.id_usuario = cs.id_usuario_apertura
      WHERE cs.id_caja = $1
        AND cs.estado = 'ABIERTA'
      ORDER BY cs.fecha_apertura DESC
      LIMIT 1
      `,
      [id_caja]
    );

    if (resultado.rows.length === 0) {
      return res.json({
        ok: true,
        sesion_abierta: null,
      });
    }

    return res.json({
      ok: true,
      sesion_abierta: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener sesión abierta:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener sesión abierta',
    });
  }
};

export const abrirCaja = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id_caja, id_sucursal, monto_inicial } = req.body;

    if (!id_caja || !id_sucursal) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Caja y sucursal son obligatorias',
      });
    }

    if (Number(monto_inicial) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El monto inicial no puede ser negativo',
      });
    }

    await client.query('BEGIN');

    const cajaExiste = await client.query(
      `
      SELECT id_caja
      FROM cajas
      WHERE id_caja = $1
        AND id_sucursal = $2
        AND activo = true
      `,
      [id_caja, id_sucursal]
    );

    if (cajaExiste.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'La caja no existe o no pertenece a la sucursal indicada',
      });
    }

    const sesionAbierta = await client.query(
      `
      SELECT id_sesion
      FROM caja_sesiones
      WHERE id_caja = $1
        AND estado = 'ABIERTA'
      LIMIT 1
      `,
      [id_caja]
    );

    if (sesionAbierta.rows.length > 0) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        ok: false,
        mensaje: 'Esta caja ya tiene una sesión abierta',
        id_sesion: sesionAbierta.rows[0].id_sesion,
      });
    }

    const sesion = await client.query(
      `
      INSERT INTO caja_sesiones (
        id_caja,
        id_sucursal,
        id_usuario_apertura,
        monto_inicial,
        estado
      )
      VALUES ($1, $2, $3, $4, 'ABIERTA')
      RETURNING *
      `,
      [
        id_caja,
        id_sucursal,
        req.usuario.id_usuario,
        Number(monto_inicial || 0),
      ]
    );

    await client.query(
      `
      INSERT INTO caja_movimientos (
        id_sesion,
        id_sucursal,
        tipo_movimiento,
        concepto,
        monto,
        metodo_pago,
        referencia,
        observaciones,
        id_usuario
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        sesion.rows[0].id_sesion,
        id_sucursal,
        'APERTURA',
        'Apertura de caja',
        Number(monto_inicial || 0),
        'EFECTIVO',
        'APERTURA_CAJA',
        'Monto inicial de caja',
        req.usuario.id_usuario,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Caja abierta correctamente',
      sesion: sesion.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al abrir caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al abrir caja',
    });
  } finally {
    client.release();
  }
};

export const registrarMovimientoCaja = async (req, res) => {
  try {
    const {
      id_sesion,
      id_sucursal,
      tipo_movimiento,
      concepto,
      monto,
      metodo_pago,
      referencia,
      observaciones,
    } = req.body;

    if (
      !id_sesion ||
      !id_sucursal ||
      !tipo_movimiento ||
      !concepto ||
      monto === undefined
    ) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Sesión, sucursal, tipo, concepto y monto son obligatorios',
      });
    }

    if (Number(monto) <= 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El monto debe ser mayor a cero',
      });
    }

    const tipoMovimientoFinal = String(tipo_movimiento || '').toUpperCase();
    const metodoPagoFinal = String(metodo_pago || 'EFECTIVO').toUpperCase();

    const tiposPermitidos = [
      'ENTRADA',
      'SALIDA',
      'GASTO',
      'RETIRO',
      'PAGO_PROVEEDOR',
      'AJUSTE',
    ];

    if (!tiposPermitidos.includes(tipoMovimientoFinal)) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'Tipo de movimiento no válido. Las devoluciones deben registrarse desde una venta, no como movimiento manual de caja.',
        tipos_permitidos: tiposPermitidos,
      });
    }

    const metodosPermitidos = [
      'EFECTIVO',
      'TARJETA',
      'TRANSFERENCIA',
      'PUNTOS',
    ];

    if (!metodosPermitidos.includes(metodoPagoFinal)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Método de pago no válido',
        metodos_permitidos: metodosPermitidos,
      });
    }

    const sesion = await pool.query(
      `
      SELECT id_sesion
      FROM caja_sesiones
      WHERE id_sesion = $1
        AND id_sucursal = $2
        AND estado = 'ABIERTA'
      `,
      [id_sesion, id_sucursal]
    );

    if (sesion.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'No existe una sesión de caja abierta con esos datos',
      });
    }

    const resultado = await pool.query(
      `
      INSERT INTO caja_movimientos (
        id_sesion,
        id_sucursal,
        tipo_movimiento,
        concepto,
        monto,
        metodo_pago,
        referencia,
        observaciones,
        id_usuario
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        id_sesion,
        id_sucursal,
        tipoMovimientoFinal,
        concepto.trim(),
        Number(monto),
        metodoPagoFinal,
        referencia ? referencia.trim() : null,
        observaciones ? observaciones.trim() : null,
        req.usuario.id_usuario,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: 'Movimiento de caja registrado correctamente',
      movimiento: resultado.rows[0],
    });
  } catch (error) {
    console.error('Error al registrar movimiento de caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al registrar movimiento de caja',
    });
  }
};

export const listarMovimientosCaja = async (req, res) => {
  try {
    const { id_sesion } = req.query;

    if (!id_sesion) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro id_sesion es obligatorio',
      });
    }

    const resultado = await pool.query(
      `
      SELECT
        cm.id_movimiento,
        cm.id_sesion,
        cm.id_sucursal,
        s.nombre AS sucursal,
        cm.tipo_movimiento,
        cm.concepto,
        cm.monto,
        cm.metodo_pago,
        cm.referencia,
        cm.observaciones,
        cm.id_usuario,
        u.nombre AS usuario,
        cm.fecha_movimiento
      FROM caja_movimientos cm
      INNER JOIN sucursales s ON s.id_sucursal = cm.id_sucursal
      INNER JOIN usuarios u ON u.id_usuario = cm.id_usuario
      WHERE cm.id_sesion = $1
      ORDER BY cm.fecha_movimiento DESC
      `,
      [id_sesion]
    );

    return res.json({
      ok: true,
      movimientos: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar movimientos de caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar movimientos de caja',
    });
  }
};

export const obtenerResumenCaja = async (req, res) => {
  try {
    const { id_sesion } = req.query;

    if (!id_sesion) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro id_sesion es obligatorio',
      });
    }

    const sesionResultado = await pool.query(
      `
      SELECT 
        cs.id_sesion,
        cs.id_caja,
        c.nombre AS caja,
        cs.id_sucursal,
        s.nombre AS sucursal,
        cs.id_usuario_apertura,
        u.nombre AS usuario_apertura,
        cs.monto_inicial,
        cs.estado,
        cs.fecha_apertura,
        cs.fecha_cierre
      FROM caja_sesiones cs
      INNER JOIN cajas c ON c.id_caja = cs.id_caja
      INNER JOIN sucursales s ON s.id_sucursal = cs.id_sucursal
      INNER JOIN usuarios u ON u.id_usuario = cs.id_usuario_apertura
      WHERE cs.id_sesion = $1
      `,
      [id_sesion]
    );

    if (sesionResultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Sesión de caja no encontrada',
      });
    }

    const movimientosResultado = await pool.query(
      `
      SELECT
        tipo_movimiento,
        metodo_pago,
        COALESCE(SUM(monto), 0)::numeric(12,2) AS total
      FROM caja_movimientos
      WHERE id_sesion = $1
      GROUP BY tipo_movimiento, metodo_pago
      ORDER BY tipo_movimiento ASC, metodo_pago ASC
      `,
      [id_sesion]
    );

    const sesion = sesionResultado.rows[0];

    const resumen = construirResumenDesdeMovimientos({
      sesion,
      movimientos: movimientosResultado.rows,
    });

    const puntosResultado = await pool.query(
      `
      SELECT
        COALESCE(SUM(cpm.puntos), 0)::numeric(12,2) AS puntos_ganados_cajero
      FROM cajeros_puntos_movimientos cpm
      INNER JOIN ventas v ON v.id_venta = cpm.id_venta
      WHERE v.id_sesion = $1
        AND v.estado = 'COMPLETADA'
        AND cpm.tipo_movimiento = 'VENTA'
      `,
      [id_sesion]
    );

    resumen.puntos_ganados = Number(
      puntosResultado.rows[0]?.puntos_ganados_cajero || 0
    );

    return res.json({
      ok: true,
      sesion,
      resumen,
      desglose: movimientosResultado.rows,
    });
  } catch (error) {
    console.error('Error al obtener resumen de caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener resumen de caja',
    });
  }
};

export const cerrarCaja = async (req, res) => {
  const client = await pool.connect();
  let cierreFinal = null;
  let resumenFinal = null;
  let idSesionCierre = null;

  try {
    const { id_sesion, monto_final_real, observaciones } = req.body;

    if (!id_sesion || monto_final_real === undefined) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La sesión y el monto final real son obligatorios',
      });
    }

    if (Number(monto_final_real) < 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El monto final real no puede ser negativo',
      });
    }

    idSesionCierre = Number(id_sesion);

    await client.query('BEGIN');

    const sesionResultado = await client.query(
      `
      SELECT 
        id_sesion,
        id_sucursal,
        monto_inicial,
        estado
      FROM caja_sesiones
      WHERE id_sesion = $1
      FOR UPDATE
      `,
      [id_sesion]
    );

    if (sesionResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'Sesión de caja no encontrada',
      });
    }

    const sesion = sesionResultado.rows[0];

    if (sesion.estado !== 'ABIERTA') {
      await client.query('ROLLBACK');

      return res.status(400).json({
        ok: false,
        mensaje: 'La sesión de caja ya está cerrada o cancelada',
      });
    }

    const movimientosResultado = await client.query(
      `
      SELECT
        tipo_movimiento,
        metodo_pago,
        COALESCE(SUM(monto), 0)::numeric(12,2) AS total
      FROM caja_movimientos
      WHERE id_sesion = $1
      GROUP BY tipo_movimiento, metodo_pago
      `,
      [id_sesion]
    );

    const resumen = construirResumenDesdeMovimientos({
      sesion,
      movimientos: movimientosResultado.rows,
    });

    const montoFinalSistema = Number(resumen.monto_final_sistema || 0);
    const diferencia = Number(monto_final_real) - montoFinalSistema;

    const cierre = await client.query(
      `
      UPDATE caja_sesiones
      SET
        id_usuario_cierre = $1,
        monto_final_sistema = $2,
        monto_final_real = $3,
        diferencia = $4,
        estado = 'CERRADA',
        fecha_cierre = CURRENT_TIMESTAMP
      WHERE id_sesion = $5
      RETURNING *
      `,
      [
        req.usuario.id_usuario,
        montoFinalSistema,
        Number(monto_final_real),
        diferencia,
        id_sesion,
      ]
    );

    await client.query(
      `
      INSERT INTO caja_movimientos (
        id_sesion,
        id_sucursal,
        tipo_movimiento,
        concepto,
        monto,
        metodo_pago,
        referencia,
        observaciones,
        id_usuario
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        id_sesion,
        sesion.id_sucursal,
        'CIERRE',
        'Cierre de caja',
        Number(monto_final_real),
        'EFECTIVO',
        'CIERRE_CAJA',
        observaciones || `Cierre con diferencia: ${diferencia}`,
        req.usuario.id_usuario,
      ]
    );

    await client.query('COMMIT');

    cierreFinal = cierre.rows[0];
    resumenFinal = {
      ...resumen,
      monto_final_sistema: montoFinalSistema,
      monto_final_real: Number(monto_final_real),
      diferencia,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al cerrar caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al cerrar caja',
    });
  } finally {
    client.release();
  }

  try {
    const reportePdf = await generarReporteCierreCajaPDF({
      idSesion: idSesionCierre,
      idUsuario: req.usuario.id_usuario,
    });

    return res.json({
      ok: true,
      mensaje: 'Caja cerrada correctamente y reporte PDF generado',
      cierre: cierreFinal,
      resumen: resumenFinal,
      reporte_pdf: reportePdf,
    });
  } catch (errorPdf) {
    console.error('La caja cerró, pero no se pudo generar el PDF:', errorPdf);

    return res.json({
      ok: true,
      mensaje: 'Caja cerrada correctamente, pero no se pudo generar el PDF',
      cierre: cierreFinal,
      resumen: resumenFinal,
      reporte_pdf: null,
      advertencia_pdf:
        errorPdf.message || 'No se pudo generar el reporte PDF del cierre de caja',
    });
  }
};

export const obtenerReporteCierreCaja = async (req, res) => {
  try {
    const { id_sesion } = req.query;

    if (!id_sesion) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro id_sesion es obligatorio',
      });
    }

    const datosReporte = await obtenerDatosReporteCierreCaja(id_sesion);

    if (!datosReporte) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Sesión de caja no encontrada',
      });
    }

    return res.json(datosReporte);
  } catch (error) {
    console.error('Error al obtener reporte de cierre de caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al obtener reporte de cierre de caja',
    });
  }
};

export const generarReporteCierreCajaManual = async (req, res) => {
  try {
    const { id_sesion } = req.body;

    if (!id_sesion) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro id_sesion es obligatorio',
      });
    }

    const reportePdf = await generarReporteCierreCajaPDF({
      idSesion: Number(id_sesion),
      idUsuario: req.usuario.id_usuario,
    });

    return res.json({
      ok: true,
      mensaje: 'Reporte PDF generado correctamente',
      reporte_pdf: reportePdf,
    });
  } catch (error) {
    console.error('Error al generar reporte PDF de cierre de caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje:
        error.message || 'Error interno al generar el reporte PDF de cierre de caja',
    });
  }
};

export const listarReportesCierreCaja = async (req, res) => {
  try {
    const {
      id_sucursal,
      id_caja,
      fecha_inicio,
      fecha_fin,
      desde,
      hasta,
    } = req.query;

    const fechaInicio = fecha_inicio || desde || null;
    const fechaFin = fecha_fin || hasta || null;

    const condiciones = ['r.activo = true'];
    const valores = [];

    if (id_sucursal) {
      valores.push(id_sucursal);
      condiciones.push(`r.id_sucursal = $${valores.length}`);
    }

    if (id_caja) {
      valores.push(id_caja);
      condiciones.push(`r.id_caja = $${valores.length}`);
    }

    if (fechaInicio) {
      valores.push(fechaInicio);
      condiciones.push(`r.fecha_generacion::date >= $${valores.length}::date`);
    }

    if (fechaFin) {
      valores.push(fechaFin);
      condiciones.push(`r.fecha_generacion::date <= $${valores.length}::date`);
    }

    const resultado = await pool.query(
      `
      SELECT
        r.id_reporte,
        r.id_sesion,
        r.id_sucursal,
        s.nombre AS sucursal,
        r.id_caja,
        c.nombre AS caja,
        r.archivo_pdf,
        r.nombre_archivo,
        r.generado_por,
        ug.nombre AS usuario_generador,
        r.fecha_generacion,
        r.activo,
        cs.fecha_apertura,
        cs.fecha_cierre,
        cs.monto_final_sistema,
        cs.monto_final_real,
        cs.diferencia,
        cs.estado AS estado_sesion,
        uc.nombre AS usuario_cierre
      FROM caja_reportes_cierre r
      INNER JOIN caja_sesiones cs ON cs.id_sesion = r.id_sesion
      INNER JOIN sucursales s ON s.id_sucursal = r.id_sucursal
      INNER JOIN cajas c ON c.id_caja = r.id_caja
      LEFT JOIN usuarios ug ON ug.id_usuario = r.generado_por
      LEFT JOIN usuarios uc ON uc.id_usuario = cs.id_usuario_cierre
      WHERE ${condiciones.join(' AND ')}
      ORDER BY r.fecha_generacion DESC, cs.fecha_cierre DESC
      `,
      valores
    );

    return res.json({
      ok: true,
      reportes: resultado.rows,
    });
  } catch (error) {
    console.error('Error al listar reportes de cierre de caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al listar reportes de cierre de caja',
    });
  }
};

export const descargarReporteCierreCaja = async (req, res) => {
  try {
    const { id_reporte } = req.params;

    if (!id_reporte) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El parámetro id_reporte es obligatorio',
      });
    }

    const resultado = await pool.query(
      `
      SELECT
        id_reporte,
        archivo_pdf,
        nombre_archivo
      FROM caja_reportes_cierre
      WHERE id_reporte = $1
        AND activo = true
      `,
      [id_reporte]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Reporte PDF no encontrado',
      });
    }

    const reporte = resultado.rows[0];
    const rutaAbsoluta = path.join(process.cwd(), reporte.archivo_pdf.replace(/^\//, ''));

    return res.download(rutaAbsoluta, reporte.nombre_archivo);
  } catch (error) {
    console.error('Error al descargar reporte de cierre de caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al descargar reporte de cierre de caja',
    });
  }
};


export const eliminarReportesCierreCaja = async (req, res) => {
  const client = await pool.connect();

  try {
    const { ids_reportes } = req.body;

    if (!Array.isArray(ids_reportes) || ids_reportes.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Debes seleccionar al menos un reporte para eliminar',
      });
    }

    const idsLimpios = ids_reportes
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (idsLimpios.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Los reportes seleccionados no son válidos',
      });
    }

    await client.query('BEGIN');

    const reportesResultado = await client.query(
      `
      SELECT
        id_reporte,
        archivo_pdf,
        nombre_archivo
      FROM caja_reportes_cierre
      WHERE id_reporte = ANY($1::int[])
        AND activo = true
      `,
      [idsLimpios]
    );

    if (reportesResultado.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        ok: false,
        mensaje: 'No se encontraron reportes activos para eliminar',
      });
    }

    await client.query(
      `
      UPDATE caja_reportes_cierre
      SET activo = false
      WHERE id_reporte = ANY($1::int[])
      `,
      [idsLimpios]
    );

    await client.query('COMMIT');

    const archivosEliminados = [];
    const archivosNoEncontrados = [];
    const archivosConError = [];

    for (const reporte of reportesResultado.rows) {
      try {
        if (!reporte.archivo_pdf) {
          archivosNoEncontrados.push({
            id_reporte: reporte.id_reporte,
            archivo: reporte.nombre_archivo,
            motivo: 'Ruta vacía',
          });
          continue;
        }

        const rutaRelativa = String(reporte.archivo_pdf).replace(/^\/+/, '');
        const rutaAbsoluta = path.join(process.cwd(), rutaRelativa);

        try {
          await fs.access(rutaAbsoluta);
          await fs.unlink(rutaAbsoluta);

          archivosEliminados.push({
            id_reporte: reporte.id_reporte,
            archivo: reporte.nombre_archivo,
          });
        } catch {
          archivosNoEncontrados.push({
            id_reporte: reporte.id_reporte,
            archivo: reporte.nombre_archivo,
            motivo: 'El archivo físico no existe',
          });
        }
      } catch (errorArchivo) {
        console.error(
          `Error al eliminar archivo del reporte ${reporte.id_reporte}:`,
          errorArchivo
        );

        archivosConError.push({
          id_reporte: reporte.id_reporte,
          archivo: reporte.nombre_archivo,
        });
      }
    }

    return res.json({
      ok: true,
      mensaje: 'Reportes eliminados correctamente',
      total_eliminados: reportesResultado.rows.length,
      archivos_eliminados: archivosEliminados,
      archivos_no_encontrados: archivosNoEncontrados,
      archivos_con_error: archivosConError,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Error al eliminar reportes de cierre de caja:', error);

    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al eliminar reportes de cierre de caja',
    });
  } finally {
    client.release();
  }
};