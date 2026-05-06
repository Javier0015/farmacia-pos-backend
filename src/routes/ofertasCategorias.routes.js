import { Router } from 'express';

import {
  listarOfertasCategorias,
  obtenerOfertaCategoria,
  crearOfertaCategoria,
  actualizarOfertaCategoria,
  cambiarEstadoOfertaCategoria,
  eliminarOfertaCategoria,
} from '../controllers/ofertasCategorias.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, listarOfertasCategorias);

router.get('/:id_oferta', verificarToken, obtenerOfertaCategoria);

router.post('/', verificarToken, crearOfertaCategoria);

router.put('/:id_oferta', verificarToken, actualizarOfertaCategoria);

router.patch(
  '/:id_oferta/estado',
  verificarToken,
  cambiarEstadoOfertaCategoria
);

router.delete('/:id_oferta', verificarToken, eliminarOfertaCategoria);

export default router;