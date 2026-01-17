const { query } = require('../config/database');
const Permission = require('../platform/core/roles/models/Permission');
const Role = require('../platform/core/roles/models/Role');

async function verify() {
    console.log('Verifying Permissions...');

    // 1. Find a Tenant and User
    const usersRes = await query(`
        SELECT u.id, u.email, u.tenant_id, t.name as tenant_name 
        FROM users u 
        JOIN tenants t ON u.tenant_id = t.id 
        LIMIT 1
    `);

    if (usersRes.rows.length === 0) {
        console.log('No users found.');
        return;
    }

    const user = usersRes.rows[0];
    console.log(`Checking User: ${user.email} (Tenant: ${user.tenant_name})`);

    // 2. Check Roles
    const roles = await Role.getUserRoles(user.tenant_id, user.id);
    console.log('Assigned Roles:', roles.map(r => r.name).join(', '));

    // 3. Check Specific Permissions
    const checkPerms = ['users.view', 'users.manage', 'orders.view', 'admin.access'];
    for (const p of checkPerms) {
        const has = await Permission.userHasPermission(user.tenant_id, user.id, p);
        console.log(` - Has ${p}? ${has}`);
    }

    // 4. List All Permissions
    const allPerms = await Permission.getUserPermissions(user.tenant_id, user.id);
    console.log('All Permissions:', allPerms.join(', '));

    const rolePermissions = await Role.getPermissions(user.tenant_id, roles[0].id);
    console.log('Permissions for Role', roles[0].name, ':', rolePermissions.map(p => p.name).join(', '));

    process.exit(0);
}

verify().catch(e => console.error(e));
