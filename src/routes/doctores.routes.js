import { Router } from 'express';

import {
  obtenerMiPerfilDoctor,
  actualizarMiPerfilDoctor,
  listarDoctores,
} from '../controllers/doctores.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, listarDoctores);

router.get('/mi-perfil', verificarToken, obtenerMiPerfilDoctor);
router.put('/mi-perfil', verificarToken, actualizarMiPerfilDoctor);

export default router;