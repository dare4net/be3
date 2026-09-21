/**
 * Migration 090: Inventory Management, POS, and Tax Management
 *
 * New Tables:
 *   - inventory_ledger      — full audit trail of every stock movement
 *   - pos_registers         — physical cash register terminals
 *   - pos_sessions          — cashier shift tracking per register
 *   - pos_local_customers   — vendor's own unregistered local customer book
 *   - tax_rates             — tenant-wide and vendor-level tax rates
 *
 * Modified Tables:
 *   - products              — inventory tracking fields
 *   - orders                — channel, POS session, tax breakdown
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 090_inventory_pos_tax_tables.js');

    // ── 1. Products: Add inventory + marketplace columns ──────────────────────
    await query(`
        ALTER TABLE products
            ADD COLUMN IF NOT EXISTS track_inventory         BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS inventory_quantity      INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS low_stock_threshold     INTEGER DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS is_pos_visible          BOOLEAN DEFAULT true,
            ADD COLUMN IF NOT EXISTS is_marketplace_published BOOLEAN DEFAULT true,
            ADD COLUMN IF NOT EXISTS tax_class               VARCHAR(32) DEFAULT NULL;

        UPDATE products SET track_inventory = false WHERE track_inventory IS NULL;
        UPDATE products SET inventory_quantity = 0 WHERE inventory_quantity IS NULL;
        UPDATE products SET is_pos_visible = true WHERE is_pos_visible IS NULL;
        UPDATE products SET is_marketplace_published = true WHERE is_marketplace_published IS NULL;
    `);
    console.log('  ✓ Added inventory fields to products table');

    // ── 2. Orders: Add POS + channel + tax columns ────────────────────────────
    await query(`
        ALTER TABLE orders
            ADD COLUMN IF NOT EXISTS channel             VARCHAR(32) DEFAULT 'storefront',
            ADD COLUMN IF NOT EXISTS customer_type       VARCHAR(32) DEFAULT 'customer',
            ADD COLUMN IF NOT EXISTS pos_session_id      UUID DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS pos_register_id     UUID DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS cash_tendered       NUMERIC(12,2) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS change_due          NUMERIC(12,2) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS tax_amount          NUMERIC(12,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS tax_breakdown       JSONB DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS local_customer_id   UUID DEFAULT NULL;
    `);
    console.log('  ✓ Added channel, POS, and tax fields to orders table');

    // ── 3. Inventory Ledger ───────────────────────────────────────────────────
    await query(`
        CREATE TABLE IF NOT EXISTS inventory_ledger (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id         UUID NOT NULL,
            product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            variant_id        UUID DEFAULT NULL,
            vendor_id         UUID DEFAULT NULL,
            change_quantity   INTEGER NOT NULL,
            previous_quantity INTEGER NOT NULL,
            new_quantity      INTEGER NOT NULL,
            reason            VARCHAR(64) NOT NULL,
            reference_id      UUID DEFAULT NULL,
            created_by        UUID NOT NULL,
            notes             TEXT DEFAULT NULL,
            created_at        TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_inv_ledger_tenant_product ON inventory_ledger (tenant_id, product_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_inv_ledger_vendor ON inventory_ledger (tenant_id, vendor_id);`);
    console.log('  ✓ Created inventory_ledger table');

    // ── 4. POS Registers ──────────────────────────────────────────────────────
    await query(`
        CREATE TABLE IF NOT EXISTS pos_registers (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL,
            vendor_id   UUID DEFAULT NULL,
            name        VARCHAR(128) NOT NULL,
            location    VARCHAR(256) DEFAULT NULL,
            is_active   BOOLEAN DEFAULT true,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_pos_registers_tenant_vendor ON pos_registers (tenant_id, vendor_id);`);
    console.log('  ✓ Created pos_registers table');

    // ── 5. POS Sessions (Cashier Shifts) ──────────────────────────────────────
    await query(`
        CREATE TABLE IF NOT EXISTS pos_sessions (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL,
            register_id     UUID NOT NULL REFERENCES pos_registers(id),
            cashier_id      UUID NOT NULL,
            opening_cash    NUMERIC(12,2) DEFAULT 0,
            closing_cash    NUMERIC(12,2) DEFAULT NULL,
            expected_cash   NUMERIC(12,2) DEFAULT NULL,
            cash_sales      NUMERIC(12,2) DEFAULT 0,
            card_sales      NUMERIC(12,2) DEFAULT 0,
            transfer_sales  NUMERIC(12,2) DEFAULT 0,
            total_sales     NUMERIC(12,2) DEFAULT 0,
            total_orders    INTEGER DEFAULT 0,
            status          VARCHAR(16) DEFAULT 'open',
            opened_at       TIMESTAMPTZ DEFAULT NOW(),
            closed_at       TIMESTAMPTZ DEFAULT NULL,
            notes           TEXT DEFAULT NULL
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_pos_sessions_tenant_register ON pos_sessions (tenant_id, register_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pos_sessions_cashier ON pos_sessions (tenant_id, cashier_id, status);`);
    console.log('  ✓ Created pos_sessions table');

    // ── 6. POS Local Customers ────────────────────────────────────────────────
    await query(`
        CREATE TABLE IF NOT EXISTS pos_local_customers (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID NOT NULL,
            vendor_id    UUID NOT NULL,
            name         VARCHAR(256) NOT NULL,
            phone        VARCHAR(32) DEFAULT NULL,
            email        VARCHAR(256) DEFAULT NULL,
            notes        TEXT DEFAULT NULL,
            total_spend  NUMERIC(12,2) DEFAULT 0,
            visit_count  INTEGER DEFAULT 0,
            created_at   TIMESTAMPTZ DEFAULT NOW(),
            updated_at   TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_pos_local_customers_vendor ON pos_local_customers (tenant_id, vendor_id);`);
    console.log('  ✓ Created pos_local_customers table');

    // ── 7. Tax Rates ──────────────────────────────────────────────────────────
    await query(`
        CREATE TABLE IF NOT EXISTS tax_rates (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL,
            vendor_id       UUID DEFAULT NULL,
            name            VARCHAR(128) NOT NULL,
            rate            NUMERIC(5,2) NOT NULL,
            applies_to      VARCHAR(32) DEFAULT 'all',
            applicable_ids  UUID[] DEFAULT '{}',
            is_compound     BOOLEAN DEFAULT false,
            is_active       BOOLEAN DEFAULT true,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_tax_rates_tenant_vendor ON tax_rates (tenant_id, vendor_id);`);
    console.log('  ✓ Created tax_rates table');

    console.log('Migration complete: 090_inventory_pos_tax_tables.js');
}

async function down() {
    await query(`DROP TABLE IF EXISTS tax_rates CASCADE;`);
    await query(`DROP TABLE IF EXISTS pos_local_customers CASCADE;`);
    await query(`DROP TABLE IF EXISTS pos_sessions CASCADE;`);
    await query(`DROP TABLE IF EXISTS pos_registers CASCADE;`);
    await query(`DROP TABLE IF EXISTS inventory_ledger CASCADE;`);

    // Revert orders columns
    await query(`
        ALTER TABLE orders
            DROP COLUMN IF EXISTS channel,
            DROP COLUMN IF EXISTS customer_type,
            DROP COLUMN IF EXISTS pos_session_id,
            DROP COLUMN IF EXISTS pos_register_id,
            DROP COLUMN IF EXISTS cash_tendered,
            DROP COLUMN IF EXISTS change_due,
            DROP COLUMN IF EXISTS tax_amount,
            DROP COLUMN IF EXISTS tax_breakdown,
            DROP COLUMN IF EXISTS local_customer_id;
    `);

    // Revert products columns
    await query(`
        ALTER TABLE products
            DROP COLUMN IF EXISTS track_inventory,
            DROP COLUMN IF EXISTS inventory_quantity,
            DROP COLUMN IF EXISTS low_stock_threshold,
            DROP COLUMN IF EXISTS is_pos_visible,
            DROP COLUMN IF EXISTS is_marketplace_published,
            DROP COLUMN IF EXISTS tax_class;
    `);

    console.log('Rolled back: 090_inventory_pos_tax_tables.js');
}

module.exports = { up, down };
