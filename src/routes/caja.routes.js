import { Router } from 'express';

import {
  listarCajas,
  obtenerSesionAbierta,
  abrirCaja,
  registrarMovimientoCaja,
  listarMovimientosCaja,
  obtenerResumenCaja,
  cerrarCaja,
  obtenerReporteCierreCaja,
  generarReporteCierreCajaManual,
  listarReportesCierreCaja,
  descargarReporteCierreCaja,
  eliminarReportesCierreCaja,
} from '../controllers/caja.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/cajas', verificarToken, listarCajas);

router.get('/sesion-abierta', verificarToken, obtenerSesionAbierta);

router.post('/abrir', verificarToken, abrirCaja);

router.post('/movimiento', verificarToken, registrarMovimientoCaja);

router.get('/movimientos', verificarToken, listarMovimientosCaja);

router.get('/resumen', verificarToken, obtenerResumenCaja);

router.get('/reporte-cierre', verificarToken, obtenerReporteCierreCaja);

router.post('/cerrar', verificarToken, cerrarCaja);

// ===============================
// REPORTES DE CIERRE DE CAJA PDF
// ===============================

router.post(
  '/generar-reporte-cierre-pdf',
  verificarToken,
  generarReporteCierreCajaManual
);

router.get(
  '/reportes-cierre',
  verificarToken,
  listarReportesCierreCaja
);

router.get(
  '/reportes-cierre/:id_reporte/descargar',
  verificarToken,
  descargarReporteCierreCaja
);

router.delete(
  '/reportes-cierre',
  verificarToken,
  eliminarReportesCierreCaja
);

export default router;