import { Router } from 'express';

import {
  crearVenta,
  listarVentas,
  obtenerVenta,
  obtenerInfoDevolucionVenta,
  devolverVenta,
  listarVentasServiciosClinicos,
  cancelarServicioClinicoPendiente,
} from '../controllers/ventas.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

/*
 * Rutas fijas primero.
 */
router.get(
  '/servicios-clinicos',
  verificarToken,
  listarVentasServiciosClinicos
);

router.patch(
  '/servicios-clinicos/:idSolicitud/cancelar-pendiente',
  verificarToken,
  cancelarServicioClinicoPendiente
);

/*
 * Venta nueva.
 */
router.post('/', verificarToken, crearVenta);

/*
 * Rutas dinámicas después de las rutas fijas.
 */
router.get(
  '/:id/devolucion-info',
  verificarToken,
  obtenerInfoDevolucionVenta
);

router.post(
  '/:id/devolver',
  verificarToken,
  devolverVenta
);

router.get('/:id', verificarToken, obtenerVenta);

/*
 * Listado general.
 */
router.get('/', verificarToken, listarVentas);

export default router;
