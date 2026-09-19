/**
 * Authentication Middleware
 * Verifies JWT access token and attaches user to request
 * 
 * PRINCIPLE: Multi-tenant by default - extracts tenant from token
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware to verify JWT token
 */
async function authenticate(req, res, next) {
    try {
        // Get token from Authorization header or cookies
        let token;
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.cookies && req.cookies.accessToken) {
            token = req.cookies.accessToken;
        }

        if (!token) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'No token provided',
            });
        }

        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({
                    error: 'TokenExpired',
                    message: 'Access token has expired',
                });
            }
            return res.status(401).json({
                error: 'InvalidToken',
                message: 'Invalid access token',
            });
        }

        // Get user from database (to check if still active)
        const user = await User.findById(decoded.tenantId, decoded.userId);

        if (!user) {
            return res.status(401).json({
                error: 'UserNotFound',
                message: 'User no longer exists',
            });
        }

        if (user.status !== 'active') {
            return res.status(401).json({
                error: 'UserInactive',
                message: 'User account is not active',
            });
        }

        // Cross-Tenant Validation
        // Ensure the token's tenant matches the request's tenant context
        if (req.tenantId && String(req.tenantId) !== String(decoded.tenantId)) {
            console.warn(`[Authenticate] Cross-Tenant Access Attempt! Request Tenant: ${req.tenantId}, Token Tenant: ${decoded.tenantId}`);
            return res.status(403).json({
                error: 'CrossTenantAccessForbidden',
                message: 'Access denied: Token belongs to a different store'
            });
        }

        // Attach user and tenant to request
        req.user = user;
        req.tenantId = decoded.tenantId; // Safe to set/confirm

        next();
    } catch (error) {
        console.error('[Authenticate] Error:', error);
        return res.status(500).json({
            error: 'AuthenticationError',
            message: 'Failed to authenticate token',
        });
    }
}

/**
 * Optional authentication - doesn't fail if no token
 */
async function optionalAuth(req, res, next) {
    try {
        let token;
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.cookies && req.cookies.accessToken) {
            token = req.cookies.accessToken;
        }

        if (!token) {
            return next();
        }

        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

        // Cross-Tenant Check for Optional Auth
        // If tenants mismatch, valid token for A is NOT valid for B. Treat as unauthenticated.
        if (req.tenantId && req.tenantId !== decoded.tenantId) {
            console.warn(`[OptionalAuth] Ignoring token from different tenant. Request: ${req.tenantId}, Token: ${decoded.tenantId}`);
            return next();
        }

        const user = await User.findById(decoded.tenantId, decoded.userId);

        if (user && user.status === 'active') {
            req.user = {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
            };
            req.tenantId = decoded.tenantId;
        }

        next();
    } catch (error) {
        // Silently fail for optional auth
        next();
    }
}

module.exports = {
    authenticate,
    optionalAuth,
};
