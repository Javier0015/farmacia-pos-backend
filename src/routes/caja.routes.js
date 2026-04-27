import { Router } from 'express';
import {
  listarCajas,
  obtenerSesionAbierta,
  abrirCaja,
  registrarMovimientoCaja,
  listarMovimientosCaja,
  obtenerResumenCaja,
  cerrarCaja,
} from '../controllers/caja.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/cajas', verificarToken, listarCajas);
router.get('/sesion-abierta', verificarToken, obtenerSesionAbierta);
router.post('/abrir', verificarToken, abrirCaja);
router.post('/movimiento', verificarToken, registrarMovimientoCaja);
router.get('/movimientos', verificarToken, listarMovimientosCaja);
router.get('/resumen', verificarToken, obtenerResumenCaja);
router.post('/cerrar', verificarToken, cerrarCaja);

export default router;