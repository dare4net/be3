/**
 * Migration 091 - POS Cashier Roles & Vendor-Cashier Linking
 *
 * 1. Seeds `pos.access` permission.
 * 2. Seeds the `Cashier` system role across all tenants.
 * 3. Assigns `pos.access` to the `Cashier`, `Vendor`, and `Admin` roles.
 * 4. Creates `vendor_cashiers` table for vendor->cashier delegation.
 * 5. Adds `operating_hours` JSONB column to `pos_registers`.
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 091_pos_cashier_roles_and_linking.js');

    // 1. Seed pos.access permission
    await query(`
        INSERT INTO permissions (name, module, description)
        VALUES ('pos.access', 'pos', 'Open and operate POS terminal (register shifts, checkout, etc.)')
        ON CONFLICT (name) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description
    `);
    console.log('  v pos.access permission seeded');

    // 2. Seed Cashier role for every existing tenant
    await query(`
        INSERT INTO roles (name, tenant_id, description, is_system)
        SELECT 'Cashier', id, 'POS Cashier - point-of-sale access only', true
        FROM tenants
        ON CONFLICT (name, tenant_id) DO NOTHING
    `);
    console.log('  v Cashier role seeded across all tenants');

    // 3. Assign pos.access to Cashier, Vendor, and Admin roles
    await query(`
        INSERT INTO role_permissions (role_id, permission_id, tenant_id)
        SELECT r.id, p.id, r.tenant_id
        FROM roles r CROSS JOIN permissions p
        WHERE r.name IN ('Cashier', 'Vendor', 'Admin')
          AND p.name = 'pos.access'
        ON CONFLICT DO NOTHING
    `);
    console.log('  v pos.access assigned to Cashier, Vendor, and Admin roles');

    // Ensure Cashier role gets products.view and orders.view so it can load the POS
    await query(`
        INSERT INTO role_permissions (role_id, permission_id, tenant_id)
        SELECT r.id, p.id, r.tenant_id
        FROM roles r CROSS JOIN permissions p
        WHERE r.name = 'Cashier'
          AND p.name IN ('products.view', 'orders.view')
        ON CONFLICT DO NOTHING
    `);
    console.log('  v products.view and orders.view assigned to Cashier role');

    // 4. Create vendor_cashiers table
    await query(`
        CREATE TABLE IF NOT EXISTS vendor_cashiers (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id        UUID NOT NULL,
            vendor_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            cashier_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status           VARCHAR(16) NOT NULL DEFAULT 'active',
            last_shift_at    TIMESTAMPTZ DEFAULT NULL,
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            updated_at       TIMESTAMPTZ DEFAULT NOW(),
            CONSTRAINT vc_status_check CHECK (status IN ('active', 'expired', 'revoked'))
        );
    `);

    // Only one active link per cashier per tenant (cashier can only serve one vendor at a time)
    await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_cashiers_active_unique
        ON vendor_cashiers (tenant_id, cashier_user_id)
        WHERE status = 'active';
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_vendor_cashiers_vendor ON vendor_cashiers (tenant_id, vendor_id);`);
    console.log('  v vendor_cashiers table created');

    // 5. Add operating_hours to pos_registers
    await query(`
        ALTER TABLE pos_registers
        ADD COLUMN IF NOT EXISTS operating_hours JSONB DEFAULT NULL;
    `);
    // Schema: { "enabled": true, "open": "08:00", "close": "21:00", "days": [1,2,3,4,5,6] }
    // days array uses JS getDay() convention: 0=Sunday ... 6=Saturday
    console.log('  v operating_hours column added to pos_registers');

    console.log('Migration complete: 091_pos_cashier_roles_and_linking.js');
}

async function down() {
    await query(`ALTER TABLE pos_registers DROP COLUMN IF EXISTS operating_hours;`);
    await query(`DROP TABLE IF EXISTS vendor_cashiers CASCADE;`);
    await query(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE name = 'pos.access')`);
    await query(`DELETE FROM roles WHERE name = 'Cashier'`);
    await query(`DELETE FROM permissions WHERE name = 'pos.access'`);
    console.log('Rolled back: 091_pos_cashier_roles_and_linking.js');
}

module.exports = { up, down };
