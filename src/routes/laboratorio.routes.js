import { Router } from 'express';

import {
  listarCatalogoLaboratorio,
  crearEstudioLaboratorio,
  crearSolicitudLaboratorio,
  listarMisSolicitudesLaboratorio,
  obtenerSolicitudLaboratorio,
  cancelarSolicitudLaboratorio,
} from '../controllers/laboratorio.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/catalogo', verificarToken, listarCatalogoLaboratorio);

router.post('/catalogo', verificarToken, crearEstudioLaboratorio);

router.post('/solicitudes', verificarToken, crearSolicitudLaboratorio);

router.get('/solicitudes/mis-solicitudes', verificarToken, listarMisSolicitudesLaboratorio);

router.get('/solicitudes/:id', verificarToken, obtenerSolicitudLaboratorio);

router.delete('/solicitudes/:id', verificarToken, cancelarSolicitudLaboratorio);

export default router;