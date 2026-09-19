const Role = require('../models/Role');
const Permission = require('../models/Permission');

class RoleService {
    /**
     * Seed default roles for a new tenant
     * @param {string} tenantId 
     */
    static async seedDefaultRoles(tenantId) {
        console.log(`[RoleService] Seeding default roles for tenant: ${tenantId}`);

        // Import comprehensive permissions
        const ALL_PERMISSIONS = require('../seeds/all-permissions');

        // Flatten all permission categories into a single array
        const allPermissionsList = [
            ...ALL_PERMISSIONS.CATALOG,
            ...ALL_PERMISSIONS.SALES,
            ...ALL_PERMISSIONS.STOREFRONT,
            ...ALL_PERMISSIONS.SETTINGS,
            ...ALL_PERMISSIONS.ANALYTICS,
            ...ALL_PERMISSIONS.MARKETING,
            ...ALL_PERMISSIONS.SYSTEM,
            ...(ALL_PERMISSIONS.CHAT || []),
            ...(ALL_PERMISSIONS.LOCATION || []),
            ...(ALL_PERMISSIONS.NOTIFICATIONS || []),
        ];


        // Define Role Definitions with comprehensive permissions
        const ROLE_DEFINITIONS = [
            {
                name: 'Admin',
                description: 'Full Access to Everything',
                is_system: true,
                permissions: ['*'] // Wildcard for all permissions
            },
            {
                name: 'Store Manager',
                description: 'Manage Catalog, Sales, and Storefront',
                is_system: false,
                permissions: [
                    // Catalog - Full access
                    'products.view', 'products.create', 'products.edit', 'products.delete', 'products.manage',
                    'categories.view', 'categories.create', 'categories.edit', 'categories.delete', 'categories.manage',
                    'collections.view', 'collections.create', 'collections.edit', 'collections.delete', 'collections.manage',
                    'attributes.view', 'attributes.create', 'attributes.edit', 'attributes.delete', 'attributes.manage',
                    // Sales - Full access
                    'orders.view', 'orders.edit', 'orders.fulfill', 'orders.cancel', 'orders.refund', 'orders.manage',
                    'customers.view', 'customers.create', 'customers.edit', 'customers.delete', 'customers.manage',
                    // Storefront - Full access
                    'pagebuilder.view', 'pagebuilder.edit', 'pagebuilder.publish', 'pagebuilder.manage',
                    'pages.view', 'pages.create', 'pages.edit', 'pages.delete', 'pages.publish', 'pages.manage',
                    'layouts.view', 'layouts.create', 'layouts.edit', 'layouts.delete', 'layouts.manage',
                    'themes.view', 'themes.edit', 'themes.activate', 'themes.manage',
                    'banners.view', 'banners.create', 'banners.edit', 'banners.delete', 'banners.manage',
                    'menus.view', 'menus.edit', 'menus.manage',
                    'search.view', 'search.edit', 'search.synonyms', 'search.reindex', 'search.analytics', 'search.manage',
                    // Analytics
                    'analytics.view', 'analytics.export', 'analytics.manage',
                    // Marketing
                    'marketing.view', 'marketing.campaigns', 'marketing.discounts', 'marketing.manage',
                    // Admin access
                    'admin.access'
                ]
            },
            {
                name: 'Content Editor',
                description: 'Manage Storefront Content Only',
                is_system: false,
                permissions: [
                    'pagebuilder.view', 'pagebuilder.edit', 'pagebuilder.publish', 'pagebuilder.manage',
                    'pages.view', 'pages.create', 'pages.edit', 'pages.delete', 'pages.publish', 'pages.manage',
                    'layouts.view', 'layouts.create', 'layouts.edit', 'layouts.delete', 'layouts.manage',
                    'themes.view', 'themes.edit', 'themes.manage',
                    'banners.view', 'banners.create', 'banners.edit', 'banners.delete', 'banners.manage',
                    'menus.view', 'menus.edit', 'menus.manage',
                    'admin.access'
                ]
            },
            {
                name: 'Order Manager',
                description: 'Manage Orders and Customers Only',
                is_system: false,
                permissions: [
                    'orders.view', 'orders.edit', 'orders.fulfill', 'orders.cancel', 'orders.refund', 'orders.manage',
                    'customers.view', 'customers.create', 'customers.edit', 'customers.manage',
                    'admin.access'
                ]
            },
            {
                name: 'Auditor',
                description: 'View-Only Access to All Sections',
                is_system: false,
                permissions: [
                    // View-only permissions
                    'products.view', 'categories.view', 'collections.view', 'attributes.view',
                    'orders.view', 'customers.view',
                    'pagebuilder.view', 'pages.view', 'layouts.view', 'themes.view', 'banners.view', 'menus.view', 'search.view',
                    'analytics.view', 'marketing.view',
                    'settings.view', 'users.view', 'roles.view',
                    'admin.access'
                ]
            },
            {
                name: 'Vendor',
                description: 'Manage individual vendor products and sales',
                is_system: false,
                permissions: [
                    'products.view', 'products.create', 'products.edit', 'products.delete', 'products.manage',
                    'orders.view', 'orders.edit', 'orders.fulfill', 'orders.manage',
                    'admin.access'
                ]
            },
            {
                name: 'Customer',
                description: 'Storefront Access Only (No Admin)',
                is_system: false,
                permissions: ['storefront.access']
            }
        ];

        // 1. Ensure all Permissions exist
        const allPermissions = new Set();

        // Add role-based permissions
        ROLE_DEFINITIONS.forEach(def => {
            if (def.permissions[0] !== '*') {
                def.permissions.forEach(p => allPermissions.add(p));
            }
        });

        // Add ALL comprehensive permissions from our permission definitions
        allPermissionsList.forEach(perm => allPermissions.add(perm.name));

        // Always ensure admin.access exists for legacy/backup reasons
        allPermissions.add('admin.access');

        for (const permSlug of allPermissions) {
            let perm = await Permission.findByName(permSlug);
            if (!perm) {
                // Find permission metadata from comprehensive list
                const permDef = allPermissionsList.find(p => p.name === permSlug);
                await Permission.create({
                    name: permSlug,
                    module: permDef ? permDef.module : (permSlug.split('.')[0] || 'system'),
                    description: permDef ? permDef.description : `Permission for ${permSlug}`
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
        return this.assignRoleIdToUser(tenantId, userId, role.id);
    }

    /**
     * Assign a role by ID to a user
     * @param {string} tenantId 
     * @param {string} userId 
     * @param {string} roleId 
     */
    static async assignRoleIdToUser(tenantId, userId, roleId) {
        const role = await Role.findById(tenantId, roleId);
        if (!role) {
            throw new Error(`Role with ID '${roleId}' not found`);
        }
        await Role.assignToUser(tenantId, userId, role.id);
        console.log(`[RoleService] Assigned role ID '${roleId}' (${role.name}) to user ${userId}`);

        // PRINCIPLE: Use events for inter-module communication
        const eventBus = require('../../../events/EventBus');
        eventBus.emitEvent('role.assigned', {
            tenantId,
            userId,
            roleName: role.name,
            roleId: role.id
        });
    }
    /**
     * Remove a role from a user by name
     * @param {string} tenantId 
     * @param {string} userId 
     * @param {string} roleName 
     */
    static async removeRoleFromUser(tenantId, userId, roleName) {
        const role = await Role.findByName(tenantId, roleName);
        if (!role) {
            throw new Error(`Role '${roleName}' not found`);
        }
        return this.removeRoleIdFromUser(tenantId, userId, role.id);
    }

    /**
     * Remove a role by ID from a user
     * @param {string} tenantId 
     * @param {string} userId 
     * @param {string} roleId 
     */
    static async removeRoleIdFromUser(tenantId, userId, roleId) {
        const role = await Role.findById(tenantId, roleId);
        if (!role) {
            throw new Error(`Role with ID '${roleId}' not found`);
        }
        await Role.removeFromUser(tenantId, userId, role.id);
        console.log(`[RoleService] Removed role ID '${roleId}' (${role.name}) from user ${userId}`);

        // PRINCIPLE: Use events for inter-module communication
        const eventBus = require('../../../events/EventBus');
        eventBus.emitEvent('role.removed', {
            tenantId,
            userId,
            roleName: role.name,
            roleId: role.id
        });
    }
}

module.exports = RoleService;
