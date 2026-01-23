/**
 * Seed Search Permissions for an existing tenant and assign to Admin role.
 *
 * Usage:
 *   TENANT_ID=<tenant-id> node seed_search_permissions.js
 *
 * Requires: DB connection env vars already set (same as app).
 */

const Permission = require('./platform/core/roles/models/Permission');
const Role = require('./platform/core/roles/models/Role');
const SEARCH_PERMISSIONS = require('./modules/search/permissions');

async function run() {
    const tenantId = process.env.TENANT_ID;
    if (!tenantId) {
        console.error('❌ TENANT_ID env var is required');
        process.exit(1);
    }

    console.log(`🔐 Seeding search permissions for tenant: ${tenantId}`);

    // Ensure permissions exist globally
    for (const perm of SEARCH_PERMISSIONS) {
        const existing = await Permission.findByName(perm.name);
        if (!existing) {
            await Permission.create(perm);
            console.log(`✓ Created permission ${perm.name}`);
        } else {
            console.log(`• Permission ${perm.name} already exists`);
        }
    }

    // Assign to Admin role
    const adminRole = await Role.findByName(tenantId, 'Admin');
    if (!adminRole) {
        console.error('❌ Admin role not found for tenant. Seed default roles first.');
        process.exit(1);
    }

    for (const perm of SEARCH_PERMISSIONS) {
        const permRecord = await Permission.findByName(perm.name);
        if (permRecord) {
            await Role.assignPermission(tenantId, adminRole.id, permRecord.id);
            console.log(`✓ Assigned ${perm.name} to Admin`);
        }
    }

    console.log('✅ Done. Admin role now has search permissions.');
}

run().catch(err => {
    console.error('❌ Failed:', err);
    process.exit(1);
});
