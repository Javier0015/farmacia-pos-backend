import { Router } from 'express';
import { obtenerResumenDashboard } from '../controllers/dashboard.controller.js';
import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/resumen', verificarToken, obtenerResumenDashboard);

export default router;