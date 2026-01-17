const Role = require('../models/Role');
const Permission = require('../models/Permission');

class RoleService {
    /**
     * Seed default roles for a new tenant
     * @param {string} tenantId 
     */
    static async seedDefaultRoles(tenantId) {
        console.log(`[RoleService] Seeding default roles for tenant: ${tenantId}`);

        // Define Role Definitions based on reference implementation
        const ROLE_DEFINITIONS = [
            {
                name: 'Admin',
                description: 'Full Access',
                is_system: true,
                permissions: ['*'] // Wildcard for all permissions
            },
            {
                name: 'Moderator',
                description: 'Manage Orders and Products',
                is_system: false,
                permissions: [
                    'orders.view', 'orders.manage',
                    'products.view', 'products.manage', 'products.create', 'products.delete',
                    'customers.view'
                ]
            },
            {
                name: 'Auditor',
                description: 'View Access Only',
                is_system: false,
                permissions: [
                    'orders.view',
                    'products.view',
                    'customers.view',
                    'analytics.view'
                ]
            },
            {
                name: 'Customer',
                description: 'Storefront Access Only',
                is_system: false,
                permissions: ['storefront.access']
            }
        ];

        // 1. Ensure all Permissions exist
        // Note: In a real system, we'd have a global permissions matrix. 
        // For now, we lazily create permissions if they don't exist to ensure the script works.
        const allPermissions = new Set();
        ROLE_DEFINITIONS.forEach(def => {
            if (def.permissions[0] !== '*') {
                def.permissions.forEach(p => allPermissions.add(p));
            }
        });

        // Always ensure admin.access exists for legacy/backup reasons
        allPermissions.add('admin.access');

        for (const permSlug of allPermissions) {
            let perm = await Permission.findByName(permSlug);
            if (!perm) {
                await Permission.create({
                    name: permSlug, // Using slug as name based on previous findings
                    module: permSlug.split('.')[0] || 'system',
                    description: `Permission for ${permSlug}`
                });
            }
        }

        // 2. Create Roles and Assign Permissions
        const createdRoles = {};

        for (const def of ROLE_DEFINITIONS) {
            // Create Role
            let role = await Role.findByName(tenantId, def.name);
            if (!role) {
                role = await Role.create(tenantId, {
                    name: def.name,
                    description: def.description,
                    is_system: def.is_system
                });
            }
            createdRoles[def.name] = role;

            // Assign Permissions
            if (def.permissions[0] === '*') {
                // For Admin, assign ALL permissions currently in system
                // Or use a special wildcard logic. For explicit RBAC, we assign all known permissions.
                const allPermsInDb = await Permission.findAll();
                for (const p of allPermsInDb) {
                    await Role.assignPermission(tenantId, role.id, p.id);
                }
            } else {
                for (const permSlug of def.permissions) {
                    const perm = await Permission.findByName(permSlug);
                    if (perm) {
                        await Role.assignPermission(tenantId, role.id, perm.id);
                    }
                }
            }
            console.log(`[RoleService] Seeded role: ${def.name}`);
        }

        return createdRoles;
    }

    /**
     * Assign a named role to a user
     * @param {string} tenantId 
     * @param {string} userId 
     * @param {string} roleName 
     */
    static async assignRoleToUser(tenantId, userId, roleName) {
        const role = await Role.findByName(tenantId, roleName);
        if (!role) {
            throw new Error(`Role '${roleName}' not found`);
        }
        await Role.assignToUser(tenantId, userId, role.id);
        console.log(`[RoleService] Assigned '${roleName}' role to user ${userId}`);
    }
}

module.exports = RoleService;
