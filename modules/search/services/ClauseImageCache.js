/**
 * Clause Image Cache
 * 
 * Assigns a random product image to a clause/category pair and caches it in Redis.
 * Used by ClauseTraversalService (for widget cards) and SlugResolver (for branded search OG).
 * 
 * Cache key pattern: clause_img:{tenantId}:{categoryId}:{attributeCode}:{clauseValue}
 * Default TTL: 15 minutes (configurable, planned upgrade to 2 weeks)
 */

const { query } = require('../../../config/database');
const { redisClient, isRedisHealthy } = require('../../../config/redis');

const isUpstash = !!process.env.UPSTASH_REDIS_REST_URL;
const DEFAULT_TTL = 900; // 15 minutes in seconds

class ClauseImageCache {
    /**
     * Build the Redis key for a clause/category image
     */
    getCacheKey(tenantId, categoryId, attributeCode, clauseValue) {
        // Normalize clauseValue to string for consistent keys
        const normalizedValue = String(clauseValue || '').toLowerCase().trim();
        return `clause_img:${tenantId}:${categoryId}:${attributeCode}:${normalizedValue}`;
    }

    /**
     * Get (or resolve + cache) a product image for a clause/category pair.
     * 
     * @param {string} tenantId
     * @param {string} categoryId - The category to scope products to
     * @param {string} attributeCode - The attribute code (e.g., 'brand')
     * @param {string|number} clauseValue - The clause value to match (e.g., 'Apple')
     * @param {string} [operator='='] - The comparison operator
     * @param {number} [ttl=DEFAULT_TTL] - Cache TTL in seconds
     * @returns {Promise<string|null>} Product image URL or null
     */
    async getClauseImage(tenantId, categoryId, attributeCode, clauseValue, operator = '=', ttl = DEFAULT_TTL) {
        const cacheKey = this.getCacheKey(tenantId, categoryId, attributeCode, clauseValue);

        // 1. Try Redis cache
        try {
            if (isRedisHealthy()) {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    // Handle "null" sentinel — we cached a miss to avoid repeated DB queries
                    if (cached === '__NULL__') return null;
                    return typeof cached === 'string' ? cached : String(cached);
                }
            }
        } catch (err) {
            console.warn('[ClauseImageCache] Redis read failed (continuing to SQL):', err.message);
        }

        // 2. Cache miss — resolve from database
        const imageUrl = await this.resolveImageFromDB(tenantId, categoryId, attributeCode, clauseValue, operator);

        // 3. Store in Redis (even null results to prevent repeated misses)
        try {
            if (isRedisHealthy()) {
                const val = imageUrl || '__NULL__';
                if (isUpstash) {
                    await redisClient.set(cacheKey, val, { ex: ttl });
                } else {
                    await redisClient.setEx(cacheKey, ttl, val);
                }
            }
        } catch (err) {
            console.warn('[ClauseImageCache] Redis write failed:', err.message);
        }

        return imageUrl;
    }

    /**
     * Query a random product image from products matching the clause/category pair.
     * Uses the search_indexes table for fast, indexed lookups.
     */
    async resolveImageFromDB(tenantId, categoryId, attributeCode, clauseValue, operator = '=') {
        try {
            const normalizedValue = String(clauseValue || '').toLowerCase().trim();

            // Build attribute match condition based on operator
            let attributeCondition;
            if (operator === '=' || !operator) {
                attributeCondition = `LOWER(si.metadata->'attributes'->>$3) = LOWER($4)`;
            } else if (operator === '<=' || operator === '>=' || operator === '<' || operator === '>') {
                const attrVal = `si.metadata->'attributes'->>$3`;
                const safeCast = `(CASE WHEN ${attrVal} ~ '^-?[0-9.]+$' THEN (${attrVal})::numeric ELSE NULL END)`;
                attributeCondition = `${safeCast} ${operator} $4::numeric`;
            } else {
                // Fallback to exact match for any other operator
                attributeCondition = `LOWER(si.metadata->'attributes'->>$3) = LOWER($4)`;
            }

            const res = await query(
                `SELECT si.metadata->>'image_url' AS image_url
                 FROM search_indexes si
                 WHERE si.tenant_id = $1
                   AND si.is_active = true
                   AND si.content_type = 'product'
                   AND si.metadata->'category_ids' ? $2
                   AND ${attributeCondition}
                   AND si.metadata->>'image_url' IS NOT NULL
                   AND si.metadata->>'image_url' != ''
                 ORDER BY RANDOM()
                 LIMIT 1`,
                [tenantId, String(categoryId), attributeCode, normalizedValue]
            );

            return res.rows[0]?.image_url || null;
        } catch (err) {
            console.error('[ClauseImageCache] DB resolution failed:', err.message);
            return null;
        }
    }

    /**
     * Bulk-resolve images for multiple clause/category pairs in parallel.
     * Used by ClauseTraversalService to efficiently populate all cards at once.
     * 
     * @param {string} tenantId
     * @param {Array<{categoryId, attributeCode, clauseValue, operator}>} pairs
     * @returns {Promise<Map<string, string|null>>} Map of cacheKey -> imageUrl
     */
    async getBulkClauseImages(tenantId, pairs, ttl = DEFAULT_TTL) {
        const results = new Map();

        // Resolve all in parallel
        await Promise.all(pairs.map(async (pair) => {
            const imageUrl = await this.getClauseImage(
                tenantId,
                pair.categoryId,
                pair.attributeCode,
                pair.clauseValue,
                pair.operator || '=',
                ttl
            );
            const key = this.getCacheKey(tenantId, pair.categoryId, pair.attributeCode, pair.clauseValue);
            results.set(key, imageUrl);
        }));

        return results;
    }
}

module.exports = new ClauseImageCache();
