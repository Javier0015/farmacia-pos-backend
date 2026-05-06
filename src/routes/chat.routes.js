import { Router } from 'express';

import {
  listarMensajesChat,
  contarMensajesNoLeidos,
  enviarMensajeChat,
  marcarMensajesComoLeidos,
} from '../controllers/chat.controller.js';

import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/mensajes', verificarToken, listarMensajesChat);

router.get('/no-leidos', verificarToken, contarMensajesNoLeidos);

router.post('/mensajes', verificarToken, enviarMensajeChat);

router.put('/leer', verificarToken, marcarMensajesComoLeidos);

export default router;