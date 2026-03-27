/**
 * Migration 053: Add session_id to orders
 *
 * Adds a first-class session_id column for guest/bot order tracking,
 * backfills from legacy metadata->>'session_id', and indexes it.
 */
const { query } = require('../config/database');

async function up() {
    console.log('[Migration 053] Adding session_id to orders...');

    await query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS session_id VARCHAR(255);
    `);

    await query(`
        UPDATE orders
        SET session_id = metadata->>'session_id'
        WHERE session_id IS NULL
          AND metadata ? 'session_id'
          AND COALESCE(metadata->>'session_id', '') <> '';
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_orders_session_id
        ON orders(session_id);
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_orders_tenant_session
        ON orders(tenant_id, session_id);
    `);

    console.log('[Migration 053] Done.');
}

async function down() {
    console.log('[Migration 053] Rolling back session_id from orders...');
    await query(`DROP INDEX IF EXISTS idx_orders_tenant_session;`);
    await query(`DROP INDEX IF EXISTS idx_orders_session_id;`);
    await query(`ALTER TABLE orders DROP COLUMN IF EXISTS session_id;`);
    console.log('[Migration 053] Rollback complete.');
}

module.exports = { up, down };
