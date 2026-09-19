const { query } = require('../config/database');
const ProvisioningService = require('../modules/page_builder/services/ProvisioningService');

const TARGET_TENANT = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function runFix() {
    console.log(`Starting precision fix for tenant: ${TARGET_TENANT}`);

    try {
        // 1. Double check tenant exists
        const tenantRes = await query('SELECT id, name, status FROM tenants WHERE id = $1', [TARGET_TENANT]);
        if (tenantRes.rows.length === 0) {
            console.error('✗ ERROR: Tenant ID not found in database.');
            process.exit(1);
        }
        
        const tenant = tenantRes.rows[0];
        console.log(`  Found Tenant: ${tenant.name} (Status: ${tenant.status})`);

        // 2. Run Provisioning
        console.log('  Provisioning pages and widgets...');
        await ProvisioningService.provisionDefaults(TARGET_TENANT);

        console.log('\n✓ SUCCESS: Search templates and widgets registered.');
        console.log('You should now see "Collection Page", etc. in your admin dashboard.');
        
        process.exit(0);
    } catch (err) {
        console.error('\n✗ FIX FAILED:', err.message);
        process.exit(1);
    }
}

runFix();
