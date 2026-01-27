const { Pool } = require('pg');
require('dotenv').config();

const isNeon = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech');

const poolConfig = process.env.DATABASE_URL
  ? {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  }
  : {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };

// PostgreSQL connection pool
const pool = new Pool({
  ...poolConfig,
  // Optimized for Neon / Cloud: smaller pools and longer timeouts for cold starts
  min: isNeon ? 0 : (parseInt(process.env.DB_POOL_MIN) || 2),
  max: isNeon ? 5 : (parseInt(process.env.DB_POOL_MAX) || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: isNeon ? 15000 : 5000, // 15s for Neon cold start
});

// Test connection on startup
pool.on('connect', () => {
  console.log('✓ Database connected');
});

pool.on('error', (err) => {
  // PRINCIPLE: Do NOT crash the process. Neon disconnects are common and recoverable.
  console.error('Unexpected database pool error:', err.message);
});

/**
 * Execute a query with automatic tenant scoping
 * PRINCIPLE: Multi-tenant by default - all queries are tenant-scoped
 * 
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @param {string} tenantId - Tenant ID for scoping (optional for non-tenant queries)
 * @returns {Promise<Object>} Query result
 */
async function query(query, params = [], tenantId = null) {
  const client = await pool.connect();
  try {
    // If tenantId is provided, set it in the session for RLS policies
    if (tenantId) {
      await client.query('SELECT set_config($1, $2, true)', [
        'app.current_tenant_id',
        tenantId
      ]);
    }

    const result = await client.query(query, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Execute a transaction with tenant scoping
 * PRINCIPLE: Multi-tenant by default - transactions are tenant-scoped
 */
async function transaction(callback, tenantId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (tenantId) {
      await client.query('SELECT set_config($1, $2, true)', [
        'app.current_tenant_id',
        tenantId
      ]);
    }

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Helper to build tenant-scoped WHERE clause
 * PRINCIPLE: Multi-tenant by default
 */
function tenantWhere(tenantId, additionalConditions = '') {
  const baseWhere = `tenant_id = '${tenantId}'`;
  return additionalConditions
    ? `${baseWhere} AND ${additionalConditions}`
    : baseWhere;
}

module.exports = {
  pool,
  query,
  transaction,
  tenantWhere,
};
