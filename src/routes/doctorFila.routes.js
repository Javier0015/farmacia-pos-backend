import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.middleware.js';

import {
  crearPacienteFila,
  listarFilaEspera,
  listarHistoricoFila,
  atenderPaciente,
  vincularExpedienteAFila,
  finalizarPaciente,
  cancelarPaciente,
  marcarNoAsistio,
} from '../controllers/doctorFila.controller.js';

const router = Router();

router.post('/', verificarToken, crearPacienteFila);

router.get('/', verificarToken, listarFilaEspera);

router.get('/historico', verificarToken, listarHistoricoFila);

router.put('/:id/atender', verificarToken, atenderPaciente);

router.put('/:id/expediente', verificarToken, vincularExpedienteAFila);

router.put('/:id/finalizar', verificarToken, finalizarPaciente);

router.put('/:id/cancelar', verificarToken, cancelarPaciente);

router.put('/:id/no-asistio', verificarToken, marcarNoAsistio);

export default router;