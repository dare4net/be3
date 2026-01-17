const { query } = require('../config/database');
const Role = require('../platform/core/roles/models/Role');
const Permission = require('../platform/core/roles/models/Permission');

async function seed() {
    console.log('Starting Tenant Role Seeding...');

    // 1. Get All Tenants
    console.log('DB Config:', { host: process.env.DB_HOST, db: process.env.DB_NAME });
    const tenants = await query('SELECT * FROM tenants');
    console.log(`Found ${tenants.rows.length} total tenants.`);
    tenants.rows.forEach(t => console.log(` - ${t.name} (${t.status})`));

    // 2. Get All Permissions (to map by name)
    const allPerms = await Permission.findAll();
    const permMap = {};
    allPerms.forEach(p => permMap[p.name] = p.id);

    const rolesDef = [
        {
            name: 'Admin',
            description: 'Full Access',
            perms: Object.keys(permMap) // All perms
        },
        {
            name: 'Moderator',
            description: 'Manage Orders and Products',
            perms: ['orders.manage', 'orders.view', 'products.manage', 'products.view', 'customers.view', 'roles.view']
        },
        {
            name: 'Auditor',
            description: 'View Access Only',
            perms: allPerms.filter(p => p.name.endsWith('.view')).map(p => p.name)
        },
        {
            name: 'Customer',
            description: 'Storefront Access Only',
            perms: [] // No admin perms
        }
    ];

    for (const tenant of tenants.rows) {
        console.log(`Processing Tenant: ${tenant.name} (${tenant.subdomain})`);

        for (const def of rolesDef) {
            // Find or Create Role
            let role = await Role.findByName(tenant.id, def.name);
            if (!role) {
                role = await Role.create(tenant.id, { name: def.name, description: def.description });
                console.log(`  Created Role: ${def.name}`);
            }

            // Assign Permissions (Idempotent usually, but assignPermission is INSERT usually)
            // Role.assignPermission usually handles duplicates or we catch error
            if (def.perms.length > 0) {
                for (const pName of def.perms) {
                    const pId = permMap[pName];
                    if (pId) {
                        try {
                            await Role.assignPermission(tenant.id, role.id, pId);
                        } catch (e) {
                            // Ignore duplicate key errors if already assigned
                        }
                    }
                }
            }
        }
        console.log(`  Roles & Permissions configured.`);

        // 3. Assign Admin Role to First User (Owner)
        const users = await query('SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1', [tenant.id]);
        if (users.rows.length > 0) {
            const owner = users.rows[0];
            const adminRole = await Role.findByName(tenant.id, 'Admin');
            if (adminRole) {
                try {
                    await Role.assignToUser(tenant.id, owner.id, adminRole.id);
                    console.log(`  Assigned 'Admin' role to user: ${owner.email}`);
                } catch (e) {
                    // Ignore if already assigned
                }
            }
        }
    }

    console.log('Role Seeding Complete.');
    process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
