import { Router } from 'express';
import { login, perfil } from '../controllers/auth.controller.js';
import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/login', login);
router.get('/perfil', verificarToken, perfil);

export default router;