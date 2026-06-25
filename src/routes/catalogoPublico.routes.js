import { Router } from 'express';
import {
  listarCatalogoPublico,
  obtenerDetalleProductoPublico,
  listarCategoriasCatalogoPublico,
} from '../controllers/catalogoPublico.controller.js';

import {
  listarRedesSocialesPublicas,
} from '../controllers/catalogo.controller.js';

const router = Router();

router.get('/', listarCatalogoPublico);

router.get('/categorias', listarCategoriasCatalogoPublico);

/* Debe ir antes de /:id */
router.get('/redes-sociales', listarRedesSocialesPublicas);

router.get('/:id', obtenerDetalleProductoPublico);

export default router;