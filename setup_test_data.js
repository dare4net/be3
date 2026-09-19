const { query } = require('./config/database');

const TENANT_ID = '3d5a4944-595d-4444-9333-333333333333';

async function setup() {
    try {
        console.log(`Setting up test tenant ${TENANT_ID}...`);

        // 1. Create Tenant
        // Using upsert to be safe
        await query(`
            INSERT INTO tenants (id, name, subdomain, status)
            VALUES ($1, 'Phase 3 Test Tenant', 'phase-3-test', 'active')
            ON CONFLICT (id) DO NOTHING;
        `, [TENANT_ID]);
        console.log('✅ Tenant created.');

        // 2. Enable Analytics Module
        await query(`
            INSERT INTO tenant_modules (tenant_id, module_name, is_enabled)
            VALUES ($1, 'analytics', true)
            ON CONFLICT (tenant_id, module_name) DO UPDATE SET is_enabled = true;
        `, [TENANT_ID]);
        console.log('✅ Analytics enabled.');

    } catch (e) {
        console.error('Error setting up:', e);
    }
    process.exit(0);
}

setup();
