/**
 * Migration 048: Add is_system flag to attributes table
 * 
 * System attributes are managed exclusively by the super-admin
 * and cannot be modified or deleted from the tenant admin dashboard.
 */

const { query } = require('../config/database');

async function up() {
    console.log('[Migration 048] Adding is_system column to attributes...');

    await query(`
        ALTER TABLE attributes 
        ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false
    `);

    // Index for fast filtering of system vs non-system attributes
    await query(`
        CREATE INDEX IF NOT EXISTS idx_attributes_is_system 
        ON attributes(tenant_id, is_system)
    `);

    console.log('[Migration 048] Done.');
}

async function down() {
    await query(`ALTER TABLE attributes DROP COLUMN IF EXISTS is_system`);
    await query(`DROP INDEX IF EXISTS idx_attributes_is_system`);
}

module.exports = { up, down };
