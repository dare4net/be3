const { query } = require('../config/database');

async function up() {
    console.log('Migrating vendor_category_ledger to ID-based tracking...');

    try {
        // 1. Add vendor_id column
        await query(`
            ALTER TABLE vendor_category_ledger 
            ADD COLUMN IF NOT EXISTS vendor_id UUID;
        `);

        // 2. Drop existing index to allow backfill updates without collision errors
        console.log('Temporarily dropping unique index...');
        await query('DROP INDEX IF EXISTS idx_vcl_tenant_vendor_category;');

        // 3. Backfill vendor_id from users table using business_name
        const targetTenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713'; // Be3 Tenant
        console.log(`Backfilling vendor_id for tenant: ${targetTenantId}...`);
        await query(`
            UPDATE vendor_category_ledger vcl
            SET vendor_id = u.id
            FROM users u
            WHERE LOWER(u.business_name) = LOWER(vcl.vendor_name)
              AND u.tenant_id = vcl.tenant_id
              AND vcl.tenant_id = $1
              AND vcl.vendor_id IS NULL;
        `, [targetTenantId]);

        // 4. Deduplicate before index re-creation
        // If there are rows that would violate the unique constraint, delete the older ones.
        console.log('Deduplicating vendor_category_ledger...');
        await query(`
            DELETE FROM vendor_category_ledger vcl1
            USING vendor_category_ledger vcl2
            WHERE vcl1.id < vcl2.id
              AND vcl1.tenant_id = vcl2.tenant_id
              AND vcl1.vendor_id = vcl2.vendor_id
              AND vcl1.category_id = vcl2.category_id;
        `);

        // 5. Create a unique constraint on (tenant_id, vendor_id, category_id)
        console.log('Re-creating unique constraint for vendor_id...');
        await query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_vcl_tenant_vendor_category 
            ON vendor_category_ledger (tenant_id, vendor_id, category_id);
        `);

        console.log('Migration 067 complete: vendor_category_ledger now supports ID tracking.');
    } catch (error) {
        console.error('Migration 067 failed:', error);
        throw error;
    }
}

async function down() {
    console.log('Rolling back ID-based tracking for vendor_category_ledger...');
    await query('DROP INDEX IF EXISTS idx_vcl_tenant_vendor_category;');
    await query('ALTER TABLE vendor_category_ledger DROP COLUMN IF EXISTS vendor_id;');
}

module.exports = { up, down };
