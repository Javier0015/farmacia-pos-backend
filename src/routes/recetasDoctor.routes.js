import { Router } from 'express';

import {
  subirRecetaDoctor,
  listarMisRecetasDoctor,
  obtenerResumenPuntosDoctor,
  listarTodasRecetasDoctor,
  actualizarEstatusRecetaDoctor,
} from '../controllers/recetasDoctor.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';
import { uploadRecetaDoctor } from '../middlewares/uploadRecetaDoctor.middleware.js';

const router = Router();

router.get('/mis-recetas', verificarToken, listarMisRecetasDoctor);

router.get('/mis-puntos', verificarToken, obtenerResumenPuntosDoctor);

router.get('/admin', verificarToken, listarTodasRecetasDoctor);

router.put(
  '/admin/:id_receta/estatus',
  verificarToken,
  actualizarEstatusRecetaDoctor
);

router.post(
  '/subir',
  verificarToken,
  uploadRecetaDoctor.single('receta'),
  subirRecetaDoctor
);

export default router;