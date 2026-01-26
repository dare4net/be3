const { createClient } = require('redis');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL;

const redisConfig = redisUrl
    ? { url: redisUrl }
    : {
        socket: {
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
        },
        password: process.env.REDIS_PASSWORD || undefined,
        database: process.env.REDIS_DB || 0,
    };

// Handle TLS for production/Upstash if REDIS_URL is rediss://
if (redisUrl && redisUrl.startsWith('rediss://')) {
    if (!redisConfig.socket) redisConfig.socket = {};
    redisConfig.socket.tls = true;
    redisConfig.socket.rejectUnauthorized = false; // often needed for serverless redis
}

const redisClient = createClient(redisConfig);

redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
    console.log('✓ Redis connected');
});

// Initialize connection
(async () => {
    try {
        await redisClient.connect();
    } catch (error) {
        console.error('Failed to connect to Redis:', error);
    }
})();

/**
 * Get cache key with tenant prefix
 * PRINCIPLE: Multi-tenant by default - all cache keys are tenant-scoped
 */
function getTenantKey(tenantId, key) {
    return `tenant:${tenantId}:${key}`;
}

/**
 * Get subscription cache for a tenant
 */
async function getSubscriptionCache(tenantId) {
    const key = getTenantKey(tenantId, 'subscription');
    const cached = await redisClient.get(key);
    return cached ? JSON.parse(cached) : null;
}

/**
 * Set subscription cache for a tenant
 */
async function setSubscriptionCache(tenantId, data, expirySeconds = 3600) {
    const key = getTenantKey(tenantId, 'subscription');
    await redisClient.setEx(key, expirySeconds, JSON.stringify(data));
}

/**
 * Clear subscription cache for a tenant
 */
async function clearSubscriptionCache(tenantId) {
    const key = getTenantKey(tenantId, 'subscription');
    await redisClient.del(key);
}

/**
 * Get module access cache
 */
async function getModuleAccessCache(tenantId, moduleName) {
    const key = getTenantKey(tenantId, `module:${moduleName}`);
    const cached = await redisClient.get(key);
    return cached === 'true';
}

/**
 * Set module access cache
 */
async function setModuleAccessCache(tenantId, moduleName, hasAccess, expirySeconds = 3600) {
    const key = getTenantKey(tenantId, `module:${moduleName}`);
    await redisClient.setEx(key, expirySeconds, hasAccess ? 'true' : 'false');
}

/**
 * Clear all cache for a tenant
 */
async function clearTenantCache(tenantId) {
    const pattern = `tenant:${tenantId}:*`;
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
        await redisClient.del(keys);
    }
}

/**
 * Clear rate-limit counters for a tenant (express-rate-limit + rate-limit-redis).
 * Keys are prefix:rate-limit: + key from keyGenerator (tenantId or ip).
 * Pattern: rate-limit:${tenantId} or rate-limit:${tenantId}*
 */
async function clearRateLimitForTenant(tenantId) {
    const pattern = `rate-limit:${tenantId}*`;
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
        await redisClient.del(keys);
    }
    return keys.length;
}

module.exports = {
    redisClient,
    getTenantKey,
    getSubscriptionCache,
    setSubscriptionCache,
    clearSubscriptionCache,
    getModuleAccessCache,
    setModuleAccessCache,
    clearTenantCache,
    clearRateLimitForTenant,
};
