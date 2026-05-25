import { Router } from 'express';

import {
  crearExpedienteClinico,
  listarExpedientesClinicos,
  obtenerExpedienteClinicoPorId,
  actualizarExpedienteClinico,
  eliminarExpedienteClinico,
  obtenerMiPerfilDoctorShaddai,
  actualizarMiPerfilDoctorShaddai,

  crearRecetaDoctorShaddai,
  listarRecetasDoctorShaddai,
  obtenerRecetaDoctorShaddaiPorId,
  cancelarRecetaDoctorShaddai,
  surtirRecetaDoctorShaddai,

  obtenerNotaMedicaPorId,
} from '../controllers/doctorShaddai.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/mi-perfil', verificarToken, obtenerMiPerfilDoctorShaddai);
router.put('/mi-perfil', verificarToken, actualizarMiPerfilDoctorShaddai);

/* Expedientes clínicos */
router.get('/expedientes', verificarToken, listarExpedientesClinicos);
router.get('/expedientes/:id', verificarToken, obtenerExpedienteClinicoPorId);
router.post('/expedientes', verificarToken, crearExpedienteClinico);
router.put('/expedientes/:id', verificarToken, actualizarExpedienteClinico);
router.delete('/expedientes/:id', verificarToken, eliminarExpedienteClinico);

/* Recetas Doctor Shaddai */
router.get('/recetas', verificarToken, listarRecetasDoctorShaddai);
router.get('/recetas/:id', verificarToken, obtenerRecetaDoctorShaddaiPorId);
router.post('/recetas', verificarToken, crearRecetaDoctorShaddai);
router.put('/recetas/:id/cancelar', verificarToken, cancelarRecetaDoctorShaddai);
router.put('/recetas/:id/surtir', verificarToken, surtirRecetaDoctorShaddai);

/* Notas médicas */
router.get('/notas-medicas/:idNota', verificarToken, obtenerNotaMedicaPorId);

export default router;