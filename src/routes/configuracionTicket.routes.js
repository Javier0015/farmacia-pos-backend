import { Router } from 'express';

import {
  obtenerConfiguracionTicket,
  actualizarConfiguracionTicket,
} from '../controllers/configuracionTicket.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, obtenerConfiguracionTicket);

router.put('/', verificarToken, actualizarConfiguracionTicket);

export default router;