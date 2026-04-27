import { Router } from 'express';
import {
  listarRoles,
  listarUsuarios,
  crearUsuario,
  actualizarUsuario,
  desactivarUsuario,
} from '../controllers/usuarios.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/roles', verificarToken, listarRoles);
router.get('/', verificarToken, listarUsuarios);
router.post('/', verificarToken, crearUsuario);
router.put('/:id', verificarToken, actualizarUsuario);
router.delete('/:id', verificarToken, desactivarUsuario);

export default router;