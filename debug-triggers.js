const { query } = require('./config/database');
const RoleService = require('./platform/core/roles/services/RoleService');
const AuthService = require('./platform/core/auth/services/AuthService');
const eventBus = require('./platform/events/EventBus');
const { bootstrap } = require('./modules/vendor/index');

async function debug() {
    try {
        await bootstrap({ eventBus, app: {} });

        const email = 'dare@gmail.com';
        const userRes = await query('SELECT id, tenant_id, email FROM users WHERE email = $1', [email]);
        if (!userRes.rows[0]) {
            console.log(`User ${email} not found`);
            process.exit(1);
        }
        const user = userRes.rows[0];
        const tid = user.tenant_id;

        console.log(`Testing with user: ${user.email} (ID: ${user.id}, Tenant: ${tid})`);

        // 1. Assign Vendor Role (Trigger Event)
        console.log('--- Triggering Role Assignment ---');
        await RoleService.assignRoleToUser(tid, user.id, 'Vendor');

        // wait for event
        await new Promise(r => setTimeout(r, 2000));

        // 2. Comprehensive check
        console.log('--- Comprehensive Collection Check ---');
        const allCols = await query('SELECT id, name, tenant_id, created_by FROM collections');
        console.log('Total Collections in DB:', allCols.rows.length);

        const myCols = allCols.rows.filter(c => c.created_by === user.id);
        console.log('Collections owned by test user:', JSON.stringify(myCols, null, 2));

        const tenantCols = allCols.rows.filter(c => c.tenant_id === tid);
        console.log(`Collections in tenant ${tid}:`, tenantCols.length);

        if (myCols.length > 0) {
            console.log('✓ SUCCESS: Vendor collection verified');
        } else {
            console.log('✗ FAILURE: Vendor collection still not found in memory-filtered list');
        }

        process.exit(0);
    } catch (e) {
        console.error('Debug script failed:', e);
        process.exit(1);
    }
}

debug();
