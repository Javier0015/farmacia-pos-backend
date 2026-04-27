import { Router } from 'express';
import {
  crearVenta,
  listarVentas,
  obtenerVenta,
} from '../controllers/ventas.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, listarVentas);
router.get('/:id', verificarToken, obtenerVenta);
router.post('/', verificarToken, crearVenta);

export default router;