import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.middleware.js';
import {
  listarLibroControlSanitario,
} from '../controllers/controlSanitario.controller.js';

const router = Router();

router.get('/libro', verificarToken, listarLibroControlSanitario);

export default router;