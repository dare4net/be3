/**
 * Rate Limiter Middleware
 * Per-tenant rate limiting using Redis
 *
 * PRINCIPLE: Multi-tenant by default - rate limiting is per-tenant
 * - Key: req.tenantId (when set by tenantIsolation) or req.ip for public routes
 * - Skip: super admin (req.user.isSuperAdmin), tenants with rate_limit_exempt=true
 *
 * NOTE: Must run after tenantIsolation so req.tenantId is set for tenant-scoped routes.
 */

const { rateLimit } = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const { redisClient } = require('../config/redis');
const { query } = require('../config/database');

/**
 * Create rate limiter for tenant-scoped requests
 */
function createTenantRateLimiter(options = {}) {
    const windowMs = options.windowMs || parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000; // 15 minutes
    const max = options.max || parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000;

    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,

        // Use Redis store with tenant-specific keys
        store: new RedisStore({
            client: redisClient,
            prefix: 'rate-limit:',
            // Use tenant ID as part of the key
            sendCommand: (...args) => redisClient.sendCommand(args),
        }),

        // Custom key generator - use tenant ID
        keyGenerator: (req) => {
            return req.tenantId || req.ip;
        },

        handler: (req, res) => {
            res.status(429).json({
                error: 'TooManyRequests',
                message: 'Rate limit exceeded. Please try again later.',
                retryAfter: Math.ceil(windowMs / 1000),
            });
        },

        skip: async (req) => {
            if (req.user && req.user.isSuperAdmin) return true;
            if (!req.tenantId) return false;
            try {
                const r = await query('SELECT rate_limit_exempt FROM tenants WHERE id = $1', [req.tenantId]);
                return r.rows[0]?.rate_limit_exempt === true;
            } catch {
                return false;
            }
        },
    });
}

/**
 * Strict rate limiter for sensitive operations (auth, payments)
 */
function createStrictRateLimiter() {
    return createTenantRateLimiter({
        windowMs: 900000, // 15 minutes
        max: 10, // Only 10 requests per 15 minutes
    });
}

module.exports = {
    createTenantRateLimiter,
    createStrictRateLimiter,
};
