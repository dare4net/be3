/**
 * Rate Limiter Middleware - Production Hardened
 * Per-tenant rate limiting using Redis (TCP) or Memory (Cloud/HTTP)
 *
 * PRINCIPLES:
 * 1. Fatal Resistance: Rate limiter failing must NEVER take down the request.
 * 2. Fail-Open: If Redis fails, use Memory. If Memory fails (unlikely), continue.
 * 3. Environment Aware: Upstash HTTP shouldn't be used for Rate Limiting (too slow per request).
 */

const { rateLimit } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redisClient, isRedisHealthy } = require('../config/redis');
const { query } = require('../config/database');

/**
 * Create rate limiter for tenant-scoped requests
 */
function createTenantRateLimiter(options = {}) {
    const windowMs = options.windowMs || parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000;
    const max = options.max || parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000;

    const isUpstash = !!process.env.UPSTASH_REDIS_REST_URL;
    let store = undefined;

    /**
     * Store Strategy:
     * - If Upstash HTTP is used: Use Memory (much faster for per-request limiting).
     * - If Local/TCP Redis is used: Use Redis Store with fail-safe initialization.
     */
    try {
        if (!isUpstash && redisClient && typeof redisClient.sendCommand === 'function') {
            store = new RedisStore({
                client: redisClient,
                prefix: 'rate-limit:',
                // Wrap sendCommand to catch disconnect errors mid-request
                sendCommand: async (...args) => {
                    try {
                        // CRITICAL: Check health before calling to avoid TypeError in rate-limit-redis
                        // We return [1, windowMs] to satisfy the expected array format [current, ttl]
                        if (!isRedisHealthy()) return [1, windowMs];

                        return await redisClient.sendCommand(args);
                    } catch (err) {
                        // PRINCIPLE: Never re-throw here. Re-throwing creates UnhandledPromiseRejections.
                        // We return [1, windowMs] to simulate a successfully reset counter (fail-open)
                        return [1, windowMs];
                    }
                },
            });
        }
    } catch (err) {
        console.warn('⚠️ Redis RateLimit initialization failed (Using Memory Store):', err.message);
    }

    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        store: store, // Defaults to MemoryStore if undefined or null

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
            // Priority: Super Admin first (fastest)
            if (req.user && req.user.isSuperAdmin) return true;
            if (!req.tenantId) return false;

            // Database-backed exemption
            try {
                const r = await query('SELECT rate_limit_exempt FROM tenants WHERE id = $1', [req.tenantId]);
                return r.rows[0]?.rate_limit_exempt === true;
            } catch (err) {
                console.error('⚠️ RateLimit skip-check failed:', err.message);
                return false; // Safest default is to rate limit
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
        max: 10,
    });
}

module.exports = {
    createTenantRateLimiter,
    createStrictRateLimiter,
};
