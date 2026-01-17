/**
 * Rate Limiter Middleware
 * Per-tenant rate limiting using Redis
 * 
 * PRINCIPLE: Multi-tenant by default - rate limiting is per-tenant
 */

const { rateLimit } = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const { redisClient } = require('../config/redis');

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

        skip: (req) => {
            // Skip rate limiting for super admin
            return req.user && req.user.isSuperAdmin;
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
