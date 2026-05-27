import { Router } from 'express';
import {
  crearVenta,
  listarVentas,
  obtenerVenta,
  obtenerInfoDevolucionVenta,
  devolverVenta,
} from '../controllers/ventas.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, listarVentas);
router.get('/:id', verificarToken, obtenerVenta);

router.get('/:id/devolucion-info', verificarToken, obtenerInfoDevolucionVenta);
router.post('/:id/devolver', verificarToken, devolverVenta);

router.post('/', verificarToken, crearVenta);

export default router;