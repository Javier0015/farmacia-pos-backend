import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

export const probarConexion = async () => {
  try {
    const resultado = await pool.query('SELECT NOW() AS fecha_servidor');
    console.log('✅ Conexión a PostgreSQL correcta:', resultado.rows[0].fecha_servidor);
  } catch (error) {
    console.error('❌ Error al conectar con PostgreSQL:');
    console.error(error.message);
    process.exit(1);
  }
};