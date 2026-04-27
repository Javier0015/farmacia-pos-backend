import { Router } from 'express';
import {
  listarSucursales,
  obtenerSucursal,
  crearSucursal,
  actualizarSucursal,
  desactivarSucursal,
} from '../controllers/sucursales.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

const soloSuperAdmin = (req, res, next) => {
  if (req.usuario?.rol !== 'SUPER_ADMIN') {
    return res.status(403).json({
      ok: false,
      mensaje: 'No tienes permisos para administrar sucursales',
    });
  }

  next();
};

router.get('/', verificarToken, listarSucursales);
router.get('/:id', verificarToken, obtenerSucursal);

router.post('/', verificarToken, soloSuperAdmin, crearSucursal);
router.put('/:id', verificarToken, soloSuperAdmin, actualizarSucursal);
router.delete('/:id', verificarToken, soloSuperAdmin, desactivarSucursal);

export default router;