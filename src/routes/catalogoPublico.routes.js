import { Router } from 'express';
import {
  listarCatalogoPublico,
  obtenerDetalleProductoPublico,
  listarCategoriasCatalogoPublico,
} from '../controllers/catalogoPublico.controller.js';

const router = Router();

router.get('/', listarCatalogoPublico);

router.get('/categorias', listarCategoriasCatalogoPublico);

router.get('/:id', obtenerDetalleProductoPublico);

export default router;