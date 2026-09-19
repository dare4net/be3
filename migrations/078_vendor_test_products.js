/**
 * Migration 078 — Vendor Test Products Staging Table
 *
 * Separate staging table for the 5 test products vendors upload during onboarding.
 * Cleared after the test passes.
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 078_vendor_test_products.js');

    await query(`
        CREATE TABLE IF NOT EXISTS vendor_test_products (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            application_id  UUID        NOT NULL REFERENCES vendor_applications(id) ON DELETE CASCADE,
            tenant_id       UUID        NOT NULL,
            user_id         UUID        NOT NULL,

            title           VARCHAR(500) NOT NULL,
            description     TEXT,
            price           NUMERIC(10, 2),
            compare_price   NUMERIC(10, 2),
            sku             VARCHAR(100),
            images          JSONB,
            category_id     UUID,
            attributes      JSONB,
            whats_included  TEXT,

            review_status   VARCHAR(20) NOT NULL DEFAULT 'pending',
            review_notes    TEXT,
            reviewed_by     UUID,
            reviewed_at     TIMESTAMPTZ,

            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT chk_test_product_review_status CHECK (review_status IN ('pending','passed','failed'))
        )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_vendor_test_products_application ON vendor_test_products(application_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_vendor_test_products_tenant_user ON vendor_test_products(tenant_id, user_id)`);

    console.log('✓ vendor_test_products staging table created');
    console.log('Migration complete: 078_vendor_test_products.js');
}

async function down() {
    await query(`DROP TABLE IF EXISTS vendor_test_products CASCADE`);
}

module.exports = { up, down };
