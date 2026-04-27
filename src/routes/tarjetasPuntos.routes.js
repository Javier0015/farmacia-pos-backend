import { Router } from 'express';
import {
  listarTarjetas,
  obtenerTarjetaPorCodigo,
  crearTarjeta,
  actualizarTarjeta,
  desactivarTarjeta,
  listarMovimientosTarjeta,
} from '../controllers/tarjetasPuntos.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, listarTarjetas);
router.get('/codigo/:codigo', verificarToken, obtenerTarjetaPorCodigo);
router.get('/:id/movimientos', verificarToken, listarMovimientosTarjeta);
router.post('/', verificarToken, crearTarjeta);
router.put('/:id', verificarToken, actualizarTarjeta);
router.delete('/:id', verificarToken, desactivarTarjeta);

export default router;