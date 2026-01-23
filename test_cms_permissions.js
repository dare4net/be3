const RoleService = require('./platform/core/roles/services/RoleService');

async function testPermissionSeeding() {
    console.log('=== Testing CMS Permission Seeding ===\n');

    // Use a test tenant ID
    const testTenantId = '129d825e-9483-4899-89d6-c4552e0e5938';

    try {
        console.log(`Seeding roles for tenant: ${testTenantId}`);
        const roles = await RoleService.seedDefaultRoles(testTenantId);

        console.log('\n✅ Successfully seeded roles:');
        Object.keys(roles).forEach(roleName => {
            console.log(`  - ${roleName} (ID: ${roles[roleName].id})`);
        });

        // Query to check permissions
        const { query } = require('./config/database');

        console.log('\n📋 Checking seeded CMS permissions:');
        const perms = await query(
            `SELECT name, module, description FROM permissions WHERE module = 'cms' ORDER BY name`,
            []
        );

        console.log(`\nFound ${perms.rows.length} CMS permissions:`);
        perms.rows.forEach(p => {
            console.log(`  - ${p.name}: ${p.description}`);
        });

        // Check Content Editor role permissions
        console.log('\n👤 Content Editor Role Permissions:');
        const editorPerms = await query(`
            SELECT p.name, p.description
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            JOIN roles r ON rp.role_id = r.id
            WHERE r.name = 'Content Editor' AND r.tenant_id = $1
            ORDER BY p.name
        `, [testTenantId]);

        console.log(`Content Editor has ${editorPerms.rows.length} permissions:`);
        editorPerms.rows.forEach(p => {
            console.log(`  ✓ ${p.name}`);
        });

        console.log('\n✅ Permission seeding test completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

testPermissionSeeding();
