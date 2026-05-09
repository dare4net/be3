/**
 * Migration 079 — Vendor Management Permissions
 *
 * Seeds vendor-specific permissions and assigns them to the Admin role.
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 079_vendor_permissions.js');

    const permissions = [
        { name: 'vendors.view',                module: 'vendor', description: 'View vendor list, applications, and KYC/KYB queues' },
        { name: 'vendors.manage',              module: 'vendor', description: 'Full vendor management' },
        { name: 'vendors.applications.review', module: 'vendor', description: 'Review and action vendor applications' },
        { name: 'vendors.kyc.review',          module: 'vendor', description: 'Approve or reject KYC submissions' },
        { name: 'vendors.kyb.review',          module: 'vendor', description: 'Approve or reject KYB submissions' },
        { name: 'vendors.test_products.review',module: 'vendor', description: 'Review vendor test product submissions' },
        { name: 'vendors.terminate',           module: 'vendor', description: 'Suspend or terminate vendor accounts' },
    ];

    for (const perm of permissions) {
        await query(
            `INSERT INTO permissions (name, module, description)
             VALUES ($1, $2, $3)
             ON CONFLICT (name) DO UPDATE SET module=EXCLUDED.module, description=EXCLUDED.description`,
            [perm.name, perm.module, perm.description]
        );
    }

    console.log('✓ Vendor permissions seeded');

    // Assign all vendor permissions to every Admin role (include tenant_id from roles row)
    for (const perm of permissions) {
        await query(
            `INSERT INTO role_permissions (role_id, permission_id, tenant_id)
             SELECT r.id, p.id, r.tenant_id
             FROM roles r CROSS JOIN permissions p
             WHERE r.name = 'Admin' AND p.name = $1
             ON CONFLICT DO NOTHING`,
            [perm.name]
        );
    }

    console.log('✓ Vendor permissions assigned to Admin role');
    console.log('Migration complete: 079_vendor_permissions.js');
}

async function down() {
    const names = [
        'vendors.view','vendors.manage','vendors.applications.review',
        'vendors.kyc.review','vendors.kyb.review','vendors.test_products.review','vendors.terminate'
    ];
    await query(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE name = ANY($1))`, [names]);
    await query(`DELETE FROM permissions WHERE name = ANY($1)`, [names]);
}

module.exports = { up, down };
