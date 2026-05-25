import { Router } from 'express';

import {
  obtenerConfiguracionPuntos,
  actualizarConfiguracionPuntos,
  obtenerSaldoPuntosCajero,
  listarMovimientosPuntosCajero,
  listarResumenPuntosCajeros,
  canjearPuntosCajero,
  listarResumenPuntosDoctores,
  canjearPuntosDoctor,
  listarResumenDoctoresShaddai,
  actualizarPorcentajeDoctorShaddai,
  canjearPuntosDoctorShaddai,
} from '../controllers/configuracionPuntos.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, obtenerConfiguracionPuntos);

router.put('/', verificarToken, actualizarConfiguracionPuntos);

router.get('/cajeros/resumen', verificarToken, listarResumenPuntosCajeros);

router.get('/cajeros/movimientos', verificarToken, listarMovimientosPuntosCajero);

router.get('/cajeros/:id_usuario/saldo', verificarToken, obtenerSaldoPuntosCajero);

router.post('/cajeros/:id_usuario/canjear', verificarToken, canjearPuntosCajero);

router.get('/doctores/resumen', verificarToken, listarResumenPuntosDoctores);

router.post('/doctores/:id_doctor/canjear', verificarToken, canjearPuntosDoctor);

router.get('/doctores-shaddai/resumen', verificarToken, listarResumenDoctoresShaddai
);

router.put('/doctores-shaddai/:id_doctor/porcentaje', verificarToken, actualizarPorcentajeDoctorShaddai);

router.post('/doctores-shaddai/:id_doctor/canjear', verificarToken, canjearPuntosDoctorShaddai);

export default router;