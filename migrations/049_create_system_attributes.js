/**
 * Migration 049: Create global system_attributes table
 * 
 * System attributes are platform-wide definitions managed by the super-admin.
 * They are automatically available for ALL tenants without needing to be
 * created per-tenant. They cannot be modified or deleted from the admin dashboard.
 */

const { query } = require('../config/database');

async function up() {
    console.log('[Migration 049] Creating system_attributes table...');

    await query(`
        CREATE TABLE IF NOT EXISTS system_attributes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code VARCHAR(100) NOT NULL UNIQUE,
            label VARCHAR(255) NOT NULL,
            type VARCHAR(50) NOT NULL CHECK (type IN ('text', 'number', 'select', 'multiselect', 'boolean')),
            options JSONB DEFAULT '[]'::jsonb,
            is_filterable BOOLEAN DEFAULT false,
            is_searchable BOOLEAN DEFAULT true,
            description TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_system_attributes_code ON system_attributes(code)`);

    console.log('[Migration 049] Done.');
}

async function down() {
    await query(`DROP TABLE IF EXISTS system_attributes`);
}

module.exports = { up, down };
