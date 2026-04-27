const { query } = require('../config/database');

async function up() {
    console.log('Migrating vendor_category_ledger to ID-based tracking...');

    try {
        // 1. Add vendor_id column
        await query(`
            ALTER TABLE vendor_category_ledger 
            ADD COLUMN IF NOT EXISTS vendor_id UUID;
        `);

        // 2. Backfill vendor_id from users table using business_name
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

        // 3. Create a unique constraint on (tenant_id, vendor_id, category_id)
        // This ensures the ledger stays clean and optimized for ID lookups.
        console.log('Creating unique constraint for vendor_id...');
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
