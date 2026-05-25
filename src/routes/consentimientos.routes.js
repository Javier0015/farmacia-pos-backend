import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.middleware.js';

import {
  crearConsentimiento,
  listarConsentimientosPorExpediente,
  obtenerConsentimientoPorId,
} from '../controllers/consentimientos.controller.js';

const router = Router();

router.post('/', verificarToken, crearConsentimiento);

router.get(
  '/expediente/:id_expediente',
  verificarToken,
  listarConsentimientosPorExpediente
);

router.get(
  '/:id_consentimiento',
  verificarToken,
  obtenerConsentimientoPorId
);

export default router;