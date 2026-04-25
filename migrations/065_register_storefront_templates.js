const { query } = require('../config/database');
const ProvisioningService = require('../modules/page_builder/services/ProvisioningService');

async function run() {
    console.log('Migrating Storefront Templates for all tenants...');

    try {
        // 1. Get all active tenants
        const tenantsRes = await query('SELECT id, name FROM tenants WHERE status != \'deleted\'');
        const tenants = tenantsRes.rows;

        console.log(`Found ${tenants.length} tenants to update.`);

        for (const tenant of tenants) {
            try {
                process.stdout.write(`  Processing tenant: ${tenant.name} (${tenant.id})... `);
                await ProvisioningService.provisionDefaults(tenant.id);
                process.stdout.write('✓\n');
            } catch (err) {
                process.stdout.write('✗\n');
                console.error(`    Failed for tenant ${tenant.id}:`, err.message);
            }
        }

        console.log('\nMigration complete.');
        process.exit(0);
    } catch (e) {
        console.error('✗ Migration failed:', e);
        process.exit(1);
    }
}

run();
