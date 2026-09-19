const { query } = require('./config/database');
const PermissionService = require('./platform/core/roles/services/PermissionService');

async function debug() {
    try {
        const users = await query('SELECT id, email FROM users');
        for (const user of users.rows) {
            console.log(`\n=== Checking: ${user.email} ===`);
            const context = await PermissionService.getUserPermissionContext('cbe1df05-45ed-455a-9ce6-156b0bd45713', user.id);
            console.log(`Roles:`, context.roles.map(r => r.name || r.role_name));
            console.log(`isVendor: ${context.isVendor}`);
            console.log(`Unrestricted: ${context.categoryAccess.hasUnrestrictedAccess}`);
            console.log(`Permissions (first 5):`, context.permissions.slice(0, 5));
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

debug();
