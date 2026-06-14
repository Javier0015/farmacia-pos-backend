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

  listarCatalogoServiciosClinicos,
  crearServicioClinicoCatalogo,
  actualizarServicioClinicoCatalogo,
  cambiarEstatusServicioClinicoCatalogo,

  crearServicioClinicoDoctorShaddai,
  listarServiciosClinicosDoctorShaddai,
  obtenerServicioClinicoDoctorShaddaiPorId,
  cancelarServicioClinicoDoctorShaddai,

  obtenerNotaMedicaPorId,
} from '../controllers/doctorShaddai.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

/* Perfil Doctor Shaddai */
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

/* Catálogo de servicios clínicos */
/* IMPORTANTE: estas rutas van antes de /servicios-clinicos/:id */
router.get(
  '/servicios-clinicos/catalogo',
  verificarToken,
  listarCatalogoServiciosClinicos
);

router.post(
  '/servicios-clinicos/catalogo',
  verificarToken,
  crearServicioClinicoCatalogo
);

router.put(
  '/servicios-clinicos/catalogo/:id',
  verificarToken,
  actualizarServicioClinicoCatalogo
);

router.patch(
  '/servicios-clinicos/catalogo/:id/estatus',
  verificarToken,
  cambiarEstatusServicioClinicoCatalogo
);

/* Servicios clínicos Doctor Shaddai */
router.get(
  '/servicios-clinicos',
  verificarToken,
  listarServiciosClinicosDoctorShaddai
);

router.get(
  '/servicios-clinicos/:id',
  verificarToken,
  obtenerServicioClinicoDoctorShaddaiPorId
);

router.post(
  '/servicios-clinicos',
  verificarToken,
  crearServicioClinicoDoctorShaddai
);

router.put(
  '/servicios-clinicos/:id/cancelar',
  verificarToken,
  cancelarServicioClinicoDoctorShaddai
);

/* Notas médicas */
router.get('/notas-medicas/:idNota', verificarToken, obtenerNotaMedicaPorId);

export default router;