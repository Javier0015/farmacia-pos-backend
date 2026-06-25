import { Router } from 'express';
import {
  listarCatalogoPublico,
  obtenerDetalleProductoPublico,
  listarCategoriasCatalogoPublico,
} from '../controllers/catalogoPublico.controller.js';

import {
  listarRedesSocialesPublicas,
  listarSucursalesWhatsappPublicas,
} from '../controllers/catalogo.controller.js';

const router = Router();

router.get('/', listarCatalogoPublico);

router.get('/categorias', listarCategoriasCatalogoPublico);

/* Deben ir antes de /:id */
router.get('/redes-sociales', listarRedesSocialesPublicas);
router.get('/sucursales-whatsapp', listarSucursalesWhatsappPublicas);

router.get('/:id', obtenerDetalleProductoPublico);

export default router;
