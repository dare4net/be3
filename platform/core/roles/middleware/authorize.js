/**
 * Authorization Middleware
 * PRINCIPLE: All feature access is subscription-gated (via permissions)
 */

const Permission = require('../models/Permission');

/**
 * Create middleware to check if user has required permission
 * @param {string} permissionName - Permission to check (e.g., 'products.create')
 */
function authorize(permissionName) {
    return async (req, res, next) => {
        const { user, tenantId } = req;

        if (!user || !tenantId) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required',
            });
        }

        try {
            const hasPermission = await Permission.userHasPermission(tenantId, user.id, permissionName);

            if (!hasPermission) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: `You do not have permission to ${permissionName}`,
                    requiredPermission: permissionName,
                });
            }

            next();
        } catch (error) {
            console.error('[Authorize] Error:', error);
            return res.status(500).json({
                error: 'AuthorizationError',
                message: 'Failed to check permissions',
            });
        }
    };
}

module.exports = authorize;
