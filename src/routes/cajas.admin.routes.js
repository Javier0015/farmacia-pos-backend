import { Router } from 'express';
import {
  listarCajasAdmin,
  crearCajaAdmin,
  actualizarCajaAdmin,
  desactivarCajaAdmin,
} from '../controllers/cajas.admin.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

const soloSuperAdmin = (req, res, next) => {
  if (req.usuario?.rol !== 'SUPER_ADMIN') {
    return res.status(403).json({
      ok: false,
      mensaje: 'No tienes permisos para administrar cajas',
    });
  }

  next();
};

router.get('/', verificarToken, soloSuperAdmin, listarCajasAdmin);
router.post('/', verificarToken, soloSuperAdmin, crearCajaAdmin);
router.put('/:id', verificarToken, soloSuperAdmin, actualizarCajaAdmin);
router.delete('/:id', verificarToken, soloSuperAdmin, desactivarCajaAdmin);

export default router;
