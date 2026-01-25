const Role = require('../models/Role');
const Permission = require('../models/Permission');

class RoleService {
    /**
     * Seed default roles for a new tenant
     * @param {string} tenantId 
     */
    static async seedDefaultRoles(tenantId) {
        console.log(`[RoleService] Seeding default roles for tenant: ${tenantId}`);

        // Import CMS permissions
        const { CMS_PERMISSIONS } = require('../seeds/cms-permissions');
        // Import Search module permissions so new tenants get them by default
        const SEARCH_PERMISSIONS = require('../../../../modules/search/permissions');

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
                    'customers.view',
                    // Add CMS permissions for Moderators
                    'pages.view', 'pages.edit', 'pages.publish',
                    'widgets.view', 'widgets.create', 'widgets.edit', 'widgets.reorder'
                ]
            },
            {
                name: 'Content Editor',
                description: 'Manage Content Only',
                is_system: false,
                permissions: [
                    'pages.view', 'pages.create', 'pages.edit', 'pages.publish',
                    'widgets.view', 'widgets.create', 'widgets.edit', 'widgets.delete', 'widgets.reorder',
                    'themes.view'
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
                    'analytics.view',
                    'pages.view',
                    'widgets.view',
                    'themes.view',
                    'layouts.view'
                ]
            },
            {
                name: 'Customer',
                description: 'Storefront Access Only',
                is_system: false,
                permissions: ['storefront.access']
            }
        ];

        // 1. Ensure all Permissions exist (including CMS permissions)
        const allPermissions = new Set();

        // Add role-based permissions
        ROLE_DEFINITIONS.forEach(def => {
            if (def.permissions[0] !== '*') {
                def.permissions.forEach(p => allPermissions.add(p));
            }
        });

        // Add CMS permissions explicitly
        CMS_PERMISSIONS.forEach(perm => allPermissions.add(perm.name));
        // Add Search module permissions explicitly
        SEARCH_PERMISSIONS.forEach(perm => allPermissions.add(perm.name));

        // Always ensure admin.access exists for legacy/backup reasons
        allPermissions.add('admin.access');

        for (const permSlug of allPermissions) {
            let perm = await Permission.findByName(permSlug);
            if (!perm) {
                // Check if permission is in CMS_PERMISSIONS for proper metadata
                const cmsPerm = CMS_PERMISSIONS.find(p => p.name === permSlug);
                await Permission.create({
                    name: permSlug,
                    module: cmsPerm ? cmsPerm.module : (permSlug.split('.')[0] || 'system'),
                    description: cmsPerm ? cmsPerm.description : `Permission for ${permSlug}`
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
