/**
 * Permission Service
 * Centralized service for all permission-related operations
 */

const Permission = require('../models/Permission');
const Role = require('../models/Role');
const User = require('../../auth/models/User');

class PermissionService {
    /**
     * Check if user has a specific permission
     * @param {string} tenantId 
     * @param {string} userId 
     * @param {string} permissionName 
     * @returns {Promise<boolean>}
     */
    static async checkPermission(tenantId, userId, permissionName) {
        const permissions = await this.getUserPermissions(tenantId, userId);

        // Check for wildcard (admin has all permissions)
        if (permissions.includes('*')) {
            return true;
        }

        return permissions.includes(permissionName);
    }

    /**
     * Check if user has ANY of the specified permissions
     * @param {string} tenantId 
     * @param {string} userId 
     * @param {string[]} permissionNames 
     * @returns {Promise<boolean>}
     */
    static async hasAnyPermission(tenantId, userId, permissionNames) {
        const permissions = await this.getUserPermissions(tenantId, userId);

        // Check for wildcard
        if (permissions.includes('*')) {
            return true;
        }

        return permissionNames.some(perm => permissions.includes(perm));
    }

    /**
     * Check if user has ALL of the specified permissions
     * @param {string} tenantId 
     * @param {string} userId 
     * @param {string[]} permissionNames 
     * @returns {Promise<boolean>}
     */
    static async hasAllPermissions(tenantId, userId, permissionNames) {
        const permissions = await this.getUserPermissions(tenantId, userId);

        // Check for wildcard
        if (permissions.includes('*')) {
            return true;
        }

        return permissionNames.every(perm => permissions.includes(perm));
    }

    /**
     * Get all permissions for a user
     * @param {string} tenantId 
     * @param {string} userId 
     * @returns {Promise<string[]>}
     */
    static async getUserPermissions(tenantId, userId) {
        return await Permission.getUserPermissions(tenantId, userId);
    }

    /**
     * Get user's category access information
     * @param {string} tenantId 
     * @param {string} userId 
     * @returns {Promise<{hasUnrestrictedAccess: boolean, allowedCategories: string[]}>}
     */
    static async getUserCategoryAccess(tenantId, userId) {
        // 1. Check for Super-Admin bypass (Wildcard permission)
        const permissions = await this.getUserPermissions(tenantId, userId);
        if (permissions.includes('*')) {
            return {
                hasUnrestrictedAccess: true,
                allowedCategories: []
            };
        }

        // 2. Check for Super-Admin bypass (Email pattern)
        try {
            const user = await User.findById(tenantId, userId);
            if (user && user.email && user.email.toLowerCase().startsWith('admin@')) {
                return {
                    hasUnrestrictedAccess: true,
                    allowedCategories: []
                };
            }
        } catch (e) {
            console.error('Error checking user email for bypass:', e);
        }

        // 3. Fallback to database restrictions
        const hasUnrestrictedAccess = await Permission.hasUnrestrictedCategoryAccess(tenantId, userId);
        const allowedCategories = hasUnrestrictedAccess
            ? []
            : await Permission.getUserAllowedCategories(tenantId, userId);

        return {
            hasUnrestrictedAccess,
            allowedCategories
        };
    }

    /**
     * Filter categories based on user's access
     * @param {string} tenantId 
     * @param {string} userId 
     * @param {Array} categories - Array of category objects with 'id' property
     * @returns {Promise<Array>}
     */
    static async filterCategoriesByAccess(tenantId, userId, categories) {
        const { hasUnrestrictedAccess, allowedCategories } = await this.getUserCategoryAccess(tenantId, userId);

        // If user has unrestricted access, return all categories
        if (hasUnrestrictedAccess) {
            return categories;
        }

        // Filter to only allowed categories
        return categories.filter(cat => allowedCategories.includes(cat.id));
    }

    /**
     * Check if user can access a specific category
     * @param {string} tenantId 
     * @param {string} userId 
     * @param {string} categoryId 
     * @returns {Promise<boolean>}
     */
    static async canAccessCategory(tenantId, userId, categoryId) {
        const { hasUnrestrictedAccess, allowedCategories } = await this.getUserCategoryAccess(tenantId, userId);

        if (hasUnrestrictedAccess) {
            return true;
        }

        return allowedCategories.includes(categoryId);
    }

    /**
     * Assign categories to a user
     * @param {string} tenantId 
     * @param {string} userId 
     * @param {string[]} categoryIds - Array of category IDs, or empty array for unrestricted access
     */
    static async assignCategoriesToUser(tenantId, userId, categoryIds) {
        if (!categoryIds || categoryIds.length === 0) {
            // Empty array means unrestricted access - remove all restrictions
            await Permission.removeUserCategoryPermissions(tenantId, userId);
        } else {
            await Permission.assignCategoriesToUser(tenantId, userId, categoryIds);
        }
    }

    /**
     * Get user's roles
     * @param {string} tenantId 
     * @param {string} userId 
     * @returns {Promise<Array>}
     */
    static async getUserRoles(tenantId, userId) {
        return await Role.getUserRoles(tenantId, userId);
    }

    /**
     * Get full permission context for a user (for login response)
     * @param {string} tenantId 
     * @param {string} userId 
     * @returns {Promise<{permissions: string[], roles: Array, categoryAccess: object}>}
     */
    static async getUserPermissionContext(tenantId, userId) {
        const [permissions, roles, categoryAccess] = await Promise.all([
            this.getUserPermissions(tenantId, userId),
            this.getUserRoles(tenantId, userId),
            this.getUserCategoryAccess(tenantId, userId)
        ]);

        const context = {
            permissions,
            roles,
            categoryAccess,
            isVendor: roles.some(r => r.name === 'Vendor'),
            vendorName: null
        };

        if (context.isVendor) {
            try {
                const user = await User.findById(tenantId, userId);
                context.vendorName = user.business_name || `${user.first_name || ''} ${user.last_name || ''}`.trim();
            } catch (e) {
                console.error('Error fetching user for vendor context:', e);
            }
        }

        return context;
    }
}

module.exports = PermissionService;
