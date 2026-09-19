const { query } = require('../config/database');
const ProvisioningService = require('../modules/page_builder/services/ProvisioningService');

async function up() {
    const targetTenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713'; // Be3 Tenant
    console.log(`Migrating Storefront Templates for tenant: ${targetTenantId}`);

    try {
        process.stdout.write(`  Processing tenant: ${targetTenantId}... `);
        await ProvisioningService.provisionDefaults(targetTenantId);
        process.stdout.write('✓\n');

        console.log('\nMigration 065 complete for target tenant.');
    } catch (e) {
        console.error(`✗ Migration 065 failed for tenant ${targetTenantId}:`, e);
        throw e;
    }
}

module.exports = { up };

