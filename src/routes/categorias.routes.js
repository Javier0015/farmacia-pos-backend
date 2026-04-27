import { Router } from 'express';
import {
  listarCategorias,
  crearCategoria,
  actualizarCategoria,
  desactivarCategoria,
} from '../controllers/categorias.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

const soloSuperAdmin = (req, res, next) => {
  if (req.usuario?.rol !== 'SUPER_ADMIN') {
    return res.status(403).json({
      ok: false,
      mensaje: 'No tienes permisos para administrar categorías',
    });
  }

  next();
};

router.get('/', verificarToken, listarCategorias);

router.post('/', verificarToken, soloSuperAdmin, crearCategoria);
router.put('/:id', verificarToken, soloSuperAdmin, actualizarCategoria);
router.delete('/:id', verificarToken, soloSuperAdmin, desactivarCategoria);

export default router;