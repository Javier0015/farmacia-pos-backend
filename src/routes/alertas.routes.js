import { Router } from 'express';

import {
  crearAlerta,
  listarAlertas,
  listarMisAlertas,
  contarAlertasNoLeidas,
  marcarAlertaComoLeida,
  desactivarAlerta,
} from '../controllers/alertas.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, listarAlertas);

router.get('/mis-alertas', verificarToken, listarMisAlertas);

router.get('/no-leidas', verificarToken, contarAlertasNoLeidas);

router.post('/', verificarToken, crearAlerta);

router.put('/:id/leer', verificarToken, marcarAlertaComoLeida);

router.delete('/:id', verificarToken, desactivarAlerta);

export default router;