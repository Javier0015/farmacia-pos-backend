import { Router } from 'express';

import {
  obtenerConfiguracionCorreoSmtp,
  actualizarConfiguracionCorreoSmtp,
  probarConfiguracionCorreoSmtp,
} from '../controllers/configuracionCorreoSmtp.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, obtenerConfiguracionCorreoSmtp);

router.put('/', verificarToken, actualizarConfiguracionCorreoSmtp);

router.post(
  '/probar',
  verificarToken,
  probarConfiguracionCorreoSmtp
);

export default router;