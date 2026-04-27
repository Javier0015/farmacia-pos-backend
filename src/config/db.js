// src/config/db.js
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

export async function probarConexion() {
  try {
    const result = await pool.query('SELECT NOW() AS fecha_actual');

    console.log('✅ Conectado correctamente a Supabase PostgreSQL');
    console.log('🕒 Fecha del servidor:', result.rows[0].fecha_actual);

    return true;
  } catch (error) {
    console.error('❌ Error conectando a Supabase PostgreSQL');
    console.error('Detalle:', error.message);

    return false;
  }
}