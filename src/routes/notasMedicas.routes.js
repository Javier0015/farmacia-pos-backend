import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.middleware.js';

import {
  crearNotaMedica,
  obtenerNotaPorFila,
  listarNotasPorExpediente,
  obtenerNotaMedicaPorId,
  actualizarNotaMedica,
  eliminarNotaMedica,
} from '../controllers/notasMedicas.controller.js';

const router = Router();

router.post('/', verificarToken, crearNotaMedica);

router.get('/fila/:idFila', verificarToken, obtenerNotaPorFila);

router.get('/expediente/:idExpediente', verificarToken, listarNotasPorExpediente);

router.get('/:idNota', verificarToken, obtenerNotaMedicaPorId);

router.put('/:idNota', verificarToken, actualizarNotaMedica);

router.delete('/:idNota', verificarToken, eliminarNotaMedica);

export default router;