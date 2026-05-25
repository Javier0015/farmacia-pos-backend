// src/routes/violenciaLesion.routes.js

import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.middleware.js';

import {
  crearHojaViolenciaLesion,
  listarHojasViolenciaLesionPorExpediente,
  obtenerHojaViolenciaLesionPorId,
} from '../controllers/violenciaLesion.controller.js';

const router = Router();

router.post('/', verificarToken, crearHojaViolenciaLesion);

router.get(
  '/expediente/:id_expediente',
  verificarToken,
  listarHojasViolenciaLesionPorExpediente
);

router.get(
  '/:id_violencia_lesion',
  verificarToken,
  obtenerHojaViolenciaLesionPorId
);

export default router;