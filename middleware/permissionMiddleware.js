/**
 * Permission Middleware
 * Middleware for protecting routes based on user permissions
 */

const PermissionService = require('../platform/core/roles/services/PermissionService');

/**
 * Middleware to require a specific permission
 * @param {string} permissionName - The permission required to access the route
 */
function requirePermission(permissionName) {
    return async (req, res, next) => {
        try {
            const tenantId = req.tenantId;
            const userId = req.user?.id;

            if (!tenantId || !userId) {
                return res.status(401).json({ error: 'Unauthorized - No user context' });
            }

            const hasPermission = await PermissionService.checkPermission(tenantId, userId, permissionName);

            if (!hasPermission) {
                return res.status(403).json({
                    error: 'Forbidden - Insufficient permissions',
                    required: permissionName
                });
            }

            next();
        } catch (error) {
            console.error('[PermissionMiddleware] Error checking permission:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}

/**
 * Middleware to require ANY of the specified permissions
 * @param {string[]} permissionNames - Array of permissions (user needs at least one)
 */
function requireAnyPermission(permissionNames) {
    return async (req, res, next) => {
        try {
            const { tenantId, userId } = req.user;

            if (!tenantId || !userId) {
                return res.status(401).json({ error: 'Unauthorized - No user context' });
            }

            const hasPermission = await PermissionService.hasAnyPermission(tenantId, userId, permissionNames);

            if (!hasPermission) {
                return res.status(403).json({
                    error: 'Forbidden - Insufficient permissions',
                    required: `Any of: ${permissionNames.join(', ')}`
                });
            }

            next();
        } catch (error) {
            console.error('[PermissionMiddleware] Error checking permissions:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}

/**
 * Middleware to require ALL of the specified permissions
 * @param {string[]} permissionNames - Array of permissions (user needs all of them)
 */
function requireAllPermissions(permissionNames) {
    return async (req, res, next) => {
        try {
            const { tenantId, userId } = req.user;

            if (!tenantId || !userId) {
                return res.status(401).json({ error: 'Unauthorized - No user context' });
            }

            const hasPermissions = await PermissionService.hasAllPermissions(tenantId, userId, permissionNames);

            if (!hasPermissions) {
                return res.status(403).json({
                    error: 'Forbidden - Insufficient permissions',
                    required: `All of: ${permissionNames.join(', ')}`
                });
            }

            next();
        } catch (error) {
            console.error('[PermissionMiddleware] Error checking permissions:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}

/**
 * Middleware to attach user permissions to request object
 * Useful for routes that need to check permissions dynamically
 */
async function attachPermissions(req, res, next) {
    try {
        const tenantId = req.tenantId;
        const userId = req.user?.id;

        if (!tenantId || !userId) {
            return next();
        }

        const permissionContext = await PermissionService.getUserPermissionContext(tenantId, userId);

        req.userPermissions = permissionContext.permissions;
        req.userRoles = permissionContext.roles;
        req.categoryAccess = permissionContext.categoryAccess;

        next();
    } catch (error) {
        console.error('[PermissionMiddleware] Error attaching permissions:', error);
        next(); // Continue even if permission attachment fails
    }
}

/**
 * Middleware to check category access
 * @param {string} categoryIdParam - Name of the route parameter containing category ID (default: 'categoryId')
 */
function requireCategoryAccess(categoryIdParam = 'categoryId') {
    return async (req, res, next) => {
        try {
            const tenantId = req.tenantId;
            const userId = req.user?.id;
            const categoryId = req.params[categoryIdParam] || req.body[categoryIdParam] || req.query[categoryIdParam];

            if (!tenantId || !userId) {
                return res.status(401).json({ error: 'Unauthorized - No user context' });
            }

            if (!categoryId) {
                return res.status(400).json({ error: 'Bad Request - No category ID provided' });
            }

            const canAccess = await PermissionService.canAccessCategory(tenantId, userId, categoryId);

            if (!canAccess) {
                return res.status(403).json({
                    error: 'Forbidden - No access to this category'
                });
            }

            next();
        } catch (error) {
            console.error('[PermissionMiddleware] Error checking category access:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}

module.exports = {
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
    attachPermissions,
    requireCategoryAccess
};
