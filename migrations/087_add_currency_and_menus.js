/**
 * Migration 087: Add currency support to tenants & ensure menus schema
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 087_add_currency_and_menus.js');

    // 1. Add currency and currency_symbol to tenants
    await query(`
        ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD',
        ADD COLUMN IF NOT EXISTS currency_symbol VARCHAR(10) DEFAULT '$';
    `);

    // Backfill any nulls
    await query(`
        UPDATE tenants SET currency = 'USD' WHERE currency IS NULL;
        UPDATE tenants SET currency_symbol = '$' WHERE currency_symbol IS NULL;
    `);

    // 2. Ensure menus table exists
    await query(`
        CREATE TABLE IF NOT EXISTS menus (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            location VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT unique_tenant_menu_location UNIQUE(tenant_id, location)
        );
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_menus_tenant ON menus(tenant_id);
    `);

    // 3. Ensure menu_items table exists
    await query(`
        CREATE TABLE IF NOT EXISTS menu_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            menu_id UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
            parent_id UUID REFERENCES menu_items(id) ON DELETE CASCADE,
            label VARCHAR(255) NOT NULL,
            url VARCHAR(500),
            type VARCHAR(50) DEFAULT 'custom',
            reference_id UUID,
            target VARCHAR(20) DEFAULT '_self',
            position INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);

    await query(`
        ALTER TABLE menu_items
        ADD COLUMN IF NOT EXISTS target VARCHAR(20) DEFAULT '_self';
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_menu_items_menu ON menu_items(menu_id);
        CREATE INDEX IF NOT EXISTS idx_menu_items_parent ON menu_items(parent_id);
    `);

    console.log('  ✓ Added currency & currency_symbol columns to tenants');
    console.log('  ✓ Verified menus and menu_items tables');
    console.log('Migration complete: 087_add_currency_and_menus.js');
}

async function down() {
    await query(`ALTER TABLE tenants DROP COLUMN IF EXISTS currency, DROP COLUMN IF EXISTS currency_symbol;`);
    console.log('Rolled back: 087_add_currency_and_menus.js');
}

module.exports = { up, down };
