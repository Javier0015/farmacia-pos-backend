import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('Falta la variable DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  options: '-c search_path=public',
});

pool.on('error', (err) => {
  console.error('Error inesperado en PostgreSQL:', err);
});

export default pool;
export { pool };