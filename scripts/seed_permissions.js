const { query } = require('../config/database');
const Permission = require('../platform/core/roles/models/Permission');

const permissions = [
    // Admin Dashboard Access
    { name: 'admin.access', module: 'admin', description: 'Access Admin Dashboard' },

    // Orders
    { name: 'orders.view', module: 'orders', description: 'View orders' },
    { name: 'orders.manage', module: 'orders', description: 'Create/Edit/Delete orders' },

    // Products
    { name: 'products.view', module: 'products', description: 'View products' },
    { name: 'products.manage', module: 'products', description: 'Create/Edit/Delete products' },

    // Customers
    { name: 'customers.view', module: 'customers', description: 'View customers' },
    { name: 'customers.manage', module: 'customers', description: 'Manage customers' },

    // Users (Internal/Admin)
    { name: 'users.view', module: 'users', description: 'View users' },
    { name: 'users.manage', module: 'users', description: 'Manage users' },

    // Settings & Roles
    { name: 'settings.manage', module: 'settings', description: 'Manage store settings' },
    { name: 'roles.view', module: 'roles', description: 'View roles' },
    { name: 'roles.manage', module: 'roles', description: 'Manage roles and permissions' },
    { name: 'roles.assign', module: 'roles', description: 'Assign roles to users' },

    // Search
    { name: 'search.view', module: 'search', description: 'View search results' },
    { name: 'search.manage', module: 'search', description: 'Manage search settings (synonyms, filters)' },
    { name: 'search.analytics', module: 'search', description: 'View search analytics' },
    { name: 'search.index', module: 'search', description: 'Rebuild search index' },
];

async function seed() {
    console.log('Seeding Permissions...');
    for (const perm of permissions) {
        const existing = await Permission.findByName(perm.name);
        if (!existing) {
            await Permission.create(perm);
            console.log(`Created permission: ${perm.name}`);
        } else {
            console.log(`Permission exists: ${perm.name}`);
        }
    }
    console.log('Permissions seeded.');
    process.exit(0);
}

seed().catch(err => {
    console.error(err);
    process.exit(1);
});
