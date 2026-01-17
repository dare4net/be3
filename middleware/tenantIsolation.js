/**
 * Tenant Identification Middleware
 * 
 * PRINCIPLE: Multi-tenant by default
 * 
 * Extracts tenant from subdomain, X-Tenant-ID header, or JWT token
 * and attaches to req.tenantId for all subsequent middleware/handlers
 */

const { query } = require('../config/database');

async function tenantIdentifier(req, res, next) {
    try {
        // Public routes that don't need tenant context
        const publicRoutes = [
            '/health',
            '/tenants', // Allow all tenant routes (lookup, details, creation)
            '/tenants/check-subdomain',
            '/tenants/lookup',
            '/admin', // Super admin routes
            '/modules', // Global module registry
            '/products/admin', // Super admin product management
            '/auth/signup', // Public signup (creates tenant + user)
            '/auth/refresh', // Token refresh (uses token for context)
        ];

        // Check if this is a public route
        const isPublicRoute = publicRoutes.some(route => req.path.startsWith(route));

        // Log for debugging
        if (req.path.includes('admin')) {
            console.log('[TenantIsolation] Admin route check:', req.path, 'isPublic:', isPublicRoute);
        }

        if (isPublicRoute) {
            return next();
        }

        let tenantId = null;

        // Method 1: Check X-Tenant-ID header (for API clients)
        if (req.headers['x-tenant-id']) {
            tenantId = req.headers['x-tenant-id'];
        }

        // Method 2: Extract from subdomain (e.g., acme.platform.com -> acme)
        else if (req.headers.host) {
            const hostname = req.headers.host.split(':')[0]; // Remove port
            const parts = hostname.split('.');

            // If subdomain exists and isn't 'www' or 'api'
            if (parts.length > 2 && !['www', 'api'].includes(parts[0])) {
                const subdomain = parts[0];

                // Look up tenant by subdomain
                const result = await query(
                    'SELECT id FROM tenants WHERE subdomain = $1 AND status = $2',
                    [subdomain, 'active']
                );

                if (result.rows.length > 0) {
                    tenantId = result.rows[0].id;
                }
            }
        }

        // Method 3: Extract from JWT token (for authenticated Admin Dashboard requests)
        if (!tenantId) {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                try {
                    const jwt = require('jsonwebtoken');
                    const token = authHeader.substring(7);
                    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
                    if (decoded.tenantId) {
                        tenantId = decoded.tenantId;
                    }
                } catch (err) {
                    // Invalid/expired token - let authenticate middleware handle it
                }
            }
        }

        if (!tenantId) {
            return res.status(400).json({
                error: 'TenantRequired',
                message: 'Please provide X-Tenant-ID header or use tenant subdomain',
            });
        }

        // Attach tenant ID to request for downstream handlers
        req.tenantId = tenantId;
        next();
    } catch (error) {
        console.error('[TenantIdentifier] Error:', error);
        return res.status(500).json({
            error: 'TenantIdentificationFailed',
            message: 'Failed to identify tenant context',
        });
    }
}

module.exports = tenantIdentifier;
