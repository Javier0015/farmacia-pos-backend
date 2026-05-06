import { Router } from 'express';
import {
  listarInventarioPorSucursal,
  listarBajoStock,
  asignarInventario,
  ajustarInventario,
  listarMovimientosInventario,
  listarLotesProducto,
  listarCaducidadProxima,
  bajaLotePorCaducidad,
  consultarStockSucursales,
} from '../controllers/inventario.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', verificarToken, listarInventarioPorSucursal);
router.get('/bajo-stock', verificarToken, listarBajoStock);
router.get('/movimientos', verificarToken, listarMovimientosInventario);
router.get('/lotes', verificarToken, listarLotesProducto);
router.get('/caducidad-proxima', verificarToken, listarCaducidadProxima);

router.post('/asignar', verificarToken, asignarInventario);
router.post('/ajustar', verificarToken, ajustarInventario);
router.post('/baja-caducidad', verificarToken, bajaLotePorCaducidad);

router.get('/stock-sucursales', verificarToken, consultarStockSucursales);

export default router;