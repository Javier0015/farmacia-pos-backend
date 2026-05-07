import { Router } from 'express';
import {
  listarCatalogoAdmin,
  listarProductosParaCatalogo,
  crearProductoCatalogo,
  actualizarProductoCatalogo,
  cambiarEstadoProductoCatalogo,
  eliminarProductoCatalogo,
} from '../controllers/catalogo.controller.js';

import uploadCatalogo from '../middlewares/uploadCatalogo.middleware.js';
import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, listarCatalogoAdmin);

router.get('/productos-disponibles', verificarToken, listarProductosParaCatalogo);

router.post(
  '/',
  verificarToken,
  uploadCatalogo.single('imagen'),
  crearProductoCatalogo
);

router.put(
  '/:id',
  verificarToken,
  uploadCatalogo.single('imagen'),
  actualizarProductoCatalogo
);

router.patch(
  '/:id/estado',
  verificarToken,
  cambiarEstadoProductoCatalogo
);

router.delete(
  '/:id',
  verificarToken,
  eliminarProductoCatalogo
);

export default router;