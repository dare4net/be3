const { query } = require('../config/database');
async function check() {
    try {
        const email = 'admin_market@example.com';
        const res = await query(`
            SELECT ur.user_id, ur.tenant_id, r.name as role_name, p.name as permission_name
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            JOIN role_permissions rp ON r.id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE u.email = $1
        `, [email]);
        console.log(`Roles/Permissions for ${email}:`);
        console.table(res.rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
