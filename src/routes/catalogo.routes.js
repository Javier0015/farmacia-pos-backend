import { Router } from 'express';
import {
  listarCatalogoAdmin,
  listarProductosParaCatalogo,
  crearProductoCatalogo,
  actualizarProductoCatalogo,
  cambiarEstadoProductoCatalogo,
  eliminarProductoCatalogo,
  listarRedesSocialesCatalogo,
  actualizarRedSocialCatalogo,
  listarSucursalesWhatsappCatalogo,
  actualizarSucursalWhatsappCatalogo,
} from '../controllers/catalogo.controller.js';

import uploadCatalogo from '../middlewares/uploadCatalogo.middleware.js';
import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, listarCatalogoAdmin);

router.get(
  '/productos-disponibles',
  verificarToken,
  listarProductosParaCatalogo
);

/* Redes sociales del catálogo */
router.get(
  '/redes-sociales',
  verificarToken,
  listarRedesSocialesCatalogo
);

router.put(
  '/redes-sociales/:id',
  verificarToken,
  actualizarRedSocialCatalogo
);

/* Sucursales que se podrán elegir desde el botón de WhatsApp */
router.get(
  '/sucursales-whatsapp',
  verificarToken,
  listarSucursalesWhatsappCatalogo
);

router.put(
  '/sucursales-whatsapp/:id',
  verificarToken,
  actualizarSucursalWhatsappCatalogo
);

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
