import dotenv from 'dotenv';
import app from './app.js';
import { probarConexion } from './config/db.js';

dotenv.config();

const PORT = process.env.PORT || 3001;

const iniciarServidor = async () => {
  await probarConexion();

  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`🔎 Health check: http://localhost:${PORT}/api/health`);
  });
};

iniciarServidor();