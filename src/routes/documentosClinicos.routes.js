import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.middleware.js';

import {
  listarDocumentosClinicosPorAtencion,
  listarDocumentosClinicosPorExpediente,
  obtenerDocumentoClinicoPorId,
} from '../controllers/documentosClinicos.controller.js';

const router = Router();

router.get(
  '/atencion/:id_fila',
  verificarToken,
  listarDocumentosClinicosPorAtencion
);

router.get(
  '/expediente/:id_expediente',
  verificarToken,
  listarDocumentosClinicosPorExpediente
);

router.get(
  '/:id_documento',
  verificarToken,
  obtenerDocumentoClinicoPorId
);

export default router;