import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.middleware.js';

import {
  crearReferencia,
  listarReferenciasPorExpediente,
  obtenerReferenciaPorId,
} from '../controllers/referencias.controller.js';

const router = Router();

router.post('/', verificarToken, crearReferencia);

router.get('/expediente/:id_expediente', verificarToken, listarReferenciasPorExpediente);

router.get('/:id_referencia', verificarToken, obtenerReferenciaPorId);

export default router;