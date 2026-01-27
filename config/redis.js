const { createClient } = require('redis');
const { Redis: UpstashRedis } = require('@upstash/redis');
require('dotenv').config();

/**
 * PRODUCTION-SAFE REDIS LAYER
 * Designed for: Render, Neon, Upstash, and Local Dev
 * 
 * PRINCIPLES:
 * 1. Fatal Resistance: Redis failures must NEVER crash the process.
 * 2. Graceful Degradation: If Redis is slow/down, the app continues via cache-miss.
 * 3. Protocol Agility: Detects Upstash HTTP vs Standard TCP automatically.
 */

const isUpstash = !!process.env.UPSTASH_REDIS_REST_URL;
const redisUrl = process.env.REDIS_URL;
let redisClient = null;
let isConnecting = false;
let isReady = false;

// 1. Initialize Clients Only Once
if (isUpstash) {
    try {
        console.log('📡 Redis: Using Upstash HTTP (Serverless-Optimized)');
        redisClient = new UpstashRedis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        isReady = true; // HTTP is stateless/always ready
    } catch (err) {
        console.error('❌ Redis: Initial Upstash HTTP setup failed!', err.message);
    }
} else {
    try {
        const redisConfig = redisUrl
            ? { url: redisUrl }
            : {
                socket: {
                    host: process.env.REDIS_HOST || 'localhost',
                    port: process.env.REDIS_PORT || 6379,
                    reconnectStrategy: (retries) => {
                        // Exponential backoff with a cap of 10 seconds
                        // First few retries are fast, then it slows down to avoid log spam/CPU load
                        const delay = Math.min(retries * 500, 10000);
                        return delay;
                    }
                },
                password: process.env.REDIS_PASSWORD || undefined,
                database: process.env.REDIS_DB || 0,
            };

        // Secure TCP (Neon/Upstash TCP)
        if (redisUrl && redisUrl.startsWith('rediss://')) {
            if (!redisConfig.socket) redisConfig.socket = {};
            redisConfig.socket.tls = true;
            redisConfig.socket.rejectUnauthorized = false;
        }

        console.log('🔌 Redis: Using TCP Client (node-redis)');
        redisClient = createClient(redisConfig);

        // THROTTLED LOGGING: Don't flood the console with the same error
        let lastError = null;
        let errorCount = 0;

        redisClient.on('error', (err) => {
            isReady = false;
            // ANTI-SPAM: Only log at specific intervals to keep the terminal clean
            const shouldLog = errorCount === 0 || errorCount === 10 || errorCount === 100 || errorCount % 1000 === 0;

            if (err.message !== lastError || shouldLog) {
                console.warn(`⚠️ Redis: ${err.message} ${errorCount > 0 ? `(retry count: ${errorCount})` : ''}`);
                lastError = err.message;
            }
            errorCount++;
        });

        redisClient.on('ready', () => {
            isReady = true;
            isConnecting = false;
            errorCount = 0;
            lastError = null;
            console.log('✓ Redis Client Ready');
        });

        redisClient.on('end', () => {
            isReady = false;
            console.warn('⚠️ Redis Connection Closed');
        });

        // Initialize connection asynchronously without blocking boot
        if (!isConnecting) {
            isConnecting = true;
            redisClient.connect().catch(err => {
                isConnecting = false;
                // No need to log here, the 'error' listener handles it
            });
        }
    } catch (err) {
        console.error('❌ Redis: Initial TCP setup failed!', err.message);
    }
}

/**
 * Check if Redis is currently healthy and ready to accept commands
 */
function isRedisHealthy() {
    if (isUpstash) return true; // HTTP is stateless
    return !!(redisClient && isReady && redisClient.isOpen);
}

/**
 * Safe Call Wrapper
 * The ONLY way to access Redis. Wraps everything in try/catch and ready checks.
 */
async function safeCall(operation, defaultValue = null) {
    try {
        if (!isRedisHealthy()) {
            return defaultValue;
        }

        return await operation();
    } catch (error) {
        // Prevent unhandled promise rejections
        console.warn('🕒 Redis Operation Skipped (Fail-Open):', error.message);
        return defaultValue;
    }
}

/**
 * API IMPLEMENTATION
 */

function getTenantKey(tenantId, key) {
    return `tenant:${tenantId}:${key}`;
}

async function getSubscriptionCache(tenantId) {
    return safeCall(async () => {
        const key = getTenantKey(tenantId, 'subscription');
        const cached = await redisClient.get(key);
        if (!cached) return null;
        return typeof cached === 'string' ? JSON.parse(cached) : cached;
    });
}

async function setSubscriptionCache(tenantId, data, expirySeconds = 3600) {
    return safeCall(async () => {
        const key = getTenantKey(tenantId, 'subscription');
        const val = JSON.stringify(data);
        if (isUpstash) {
            await redisClient.set(key, val, { ex: expirySeconds });
        } else {
            await redisClient.setEx(key, expirySeconds, val);
        }
    });
}

async function clearSubscriptionCache(tenantId) {
    return safeCall(async () => {
        const key = getTenantKey(tenantId, 'subscription');
        await redisClient.del(key);
    });
}

async function getModuleAccessCache(tenantId, moduleName) {
    return safeCall(async () => {
        const key = getTenantKey(tenantId, `module:${moduleName}`);
        const cached = await redisClient.get(key);
        return String(cached) === 'true';
    }, false);
}

async function setModuleAccessCache(tenantId, moduleName, hasAccess, expirySeconds = 3600) {
    return safeCall(async () => {
        const key = getTenantKey(tenantId, `module:${moduleName}`);
        const val = hasAccess ? 'true' : 'false';
        if (isUpstash) {
            await redisClient.set(key, val, { ex: expirySeconds });
        } else {
            await redisClient.setEx(key, expirySeconds, val);
        }
    });
}

async function clearTenantCache(tenantId) {
    return safeCall(async () => {
        const pattern = `tenant:${tenantId}:*`;
        const keys = await redisClient.keys(pattern);
        if (keys && keys.length > 0) {
            if (isUpstash) {
                await redisClient.del(...keys);
            } else {
                await redisClient.del(keys);
            }
        }
    });
}

async function clearRateLimitForTenant(tenantId) {
    return safeCall(async () => {
        const pattern = `rate-limit:${tenantId}*`;
        const keys = await redisClient.keys(pattern);
        if (keys && keys.length > 0) {
            if (isUpstash) {
                await redisClient.del(...keys);
            } else {
                await redisClient.del(keys);
            }
        }
        return keys ? keys.length : 0;
    }, 0);
}

module.exports = {
    redisClient,
    isRedisHealthy,
    getTenantKey,
    getSubscriptionCache,
    setSubscriptionCache,
    clearSubscriptionCache,
    getModuleAccessCache,
    setModuleAccessCache,
    clearTenantCache,
    clearRateLimitForTenant,
};
