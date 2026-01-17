const { pool } = require('./config/database');
const RoleService = require('./platform/core/roles/services/RoleService');

async function repairRoles() {
    console.log('--- Repairing Roles for Demo Store ---');
    try {
        const demoTenantRes = await pool.query("SELECT id FROM tenants WHERE subdomain = 'demo'");
        const tenantId = demoTenantRes.rows[0].id;

        const userRes = await pool.query("SELECT id FROM users WHERE email = 'admin@demo.com'");
        const userId = userRes.rows[0].id;

        // 1. Seed Roles
        await RoleService.seedDefaultRoles(tenantId);

        // 2. Assign Admin Role
        await RoleService.assignRoleToUser(tenantId, userId, 'Admin');

        console.log('✓ Repair Complete');
    } catch (err) {
        console.error('Repair failed:', err);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

repairRoles();
