const { query } = require('../config/database');

async function run() {
    console.log('Creating vendor_category_ledger table...');

    try {
        // 1. Create the table
        await query(`
            CREATE TABLE IF NOT EXISTS vendor_category_ledger (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                vendor_name VARCHAR(255) NOT NULL,
                category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                product_count INTEGER NOT NULL DEFAULT 0,
                first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
                last_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_vendor_category UNIQUE (tenant_id, vendor_name, category_id)
            );
        `);
        console.log('  ✓ Table created');

        await query(`
            CREATE INDEX IF NOT EXISTS idx_vcl_vendor 
            ON vendor_category_ledger (tenant_id, vendor_name);
        `);
        console.log('  ✓ Index created');

        // 2. Backfill from existing non-deleted products
        console.log('  Backfilling from existing products...');

        const backfillRes = await query(`
            INSERT INTO vendor_category_ledger (tenant_id, vendor_name, category_id, product_count)
            SELECT
                p.tenant_id,
                p.attributes->>'vendor' AS vendor_name,
                pc.category_id,
                COUNT(DISTINCT p.id)::int AS product_count
            FROM products p
            JOIN product_categories pc ON pc.product_id = p.id
            WHERE p.deleted_at IS NULL
              AND p.attributes->>'vendor' IS NOT NULL
              AND p.attributes->>'vendor' != ''
            GROUP BY p.tenant_id, vendor_name, pc.category_id
            ON CONFLICT (tenant_id, vendor_name, category_id)
            DO UPDATE SET
                product_count = EXCLUDED.product_count,
                last_updated_at = NOW()
            RETURNING vendor_name;
        `);
        console.log(`  ✓ Backfilled ${backfillRes.rowCount} vendor-category entries`);

        console.log('\nMigration complete.');
        process.exit(0);
    } catch (e) {
        console.error('✗ Migration failed:', e);
        process.exit(1);
    }
}

run();
