import { Router } from 'express';
import {
  crearCompra,
  listarCompras,
  obtenerCompra,
} from '../controllers/compras.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, listarCompras);
router.get('/:id', verificarToken, obtenerCompra);
router.post('/', verificarToken, crearCompra);

export default router;