import dotenv from 'dotenv';
import app from './app.js';
import pool from './config/db.js';

dotenv.config();

const PORT = process.env.PORT || 3001;

const iniciarServidor = async () => {
  try {
    await pool.query('SELECT NOW()');

    console.log('Conectado a PostgreSQL correctamente');

    app.listen(PORT, () => {
      console.log(`Servidor corriendo en puerto ${PORT}`);
      console.log(`Health check: /api/health`);
    });
  } catch (error) {
    console.error('Error al conectar con PostgreSQL:', error.message);
    process.exit(1);
  }
};

iniciarServidor();
/*

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

*/