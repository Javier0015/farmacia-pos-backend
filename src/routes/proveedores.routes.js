import { Router } from 'express';
import {
  listarProveedores,
  obtenerProveedor,
  crearProveedor,
  actualizarProveedor,
  desactivarProveedor,
} from '../controllers/proveedores.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, listarProveedores);
router.get('/:id', verificarToken, obtenerProveedor);
router.post('/', verificarToken, crearProveedor);
router.put('/:id', verificarToken, actualizarProveedor);
router.delete('/:id', verificarToken, desactivarProveedor);

export default router;