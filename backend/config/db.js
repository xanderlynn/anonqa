const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const sslConfig =
  process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  ssl: sslConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', () => {
  // Error details are intentionally not logged here to avoid leaking connection info
  console.error('Unexpected error on idle PostgreSQL client');
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};