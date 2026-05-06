import { Router } from 'express';
import {
  crearCompra,
  listarCompras,
  obtenerCompra,
} from '../controllers/compras.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';
import { uploadTicketProveedor } from '../middlewares/uploadTicketProveedor.middleware.js';

const router = Router();

router.get('/', verificarToken, listarCompras);
router.get('/:id', verificarToken, obtenerCompra);

router.post(
  '/',
  verificarToken,
  uploadTicketProveedor.single('ticket'),
  crearCompra
);

export default router;  