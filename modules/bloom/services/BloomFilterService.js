/**
 * Bloom Filter Service
 * 
 * Manages tenant-scoped Bloom filters in Redis for fast token-level
 * existence checks. Supports:
 *   - Global (storewide) filter: products, categories, collections, pages, branded search pages
 *   - Per-category filters: products within a specific category (including descendants)
 * 
 * PRINCIPLE: Fail-open — if Redis is down, all tokens "pass" to avoid blocking searches.
 */

const BloomFilter = require('./BloomFilter');
const { query } = require('../../../config/database');
const redis = require('../../../config/redis');

// Redis key patterns
const GLOBAL_KEY = (tenantId) => `tenant:${tenantId}:bloom:global`;
const CATEGORY_KEY = (tenantId, catId) => `tenant:${tenantId}:bloom:cat:${catId}`;
const META_KEY = (tenantId) => `tenant:${tenantId}:bloom:meta`;

// Default Bloom parameters
const DEFAULT_EXPECTED_ITEMS = 50000;
const DEFAULT_FPR = 0.01;

class BloomFilterService {
    constructor() {
        this.slugify = (text) => (text || '')
            .toString().toLowerCase().trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, '')
            .replace(/--+/g, '-');
    }

    // ═══════════════════════════════════════════════
    // TOKENIZER
    // ═══════════════════════════════════════════════

    /**
     * Tokenize a string into searchable tokens.
     * "Dell XPS 13 2-in-1" → ["dell", "xps", "13", "2-in-1"]
     * @param {string} text
     * @returns {string[]}
     */
    tokenize(text) {
        if (!text || typeof text !== 'string') return [];
        return text
            .toLowerCase()
            .split(/\s+/)
            .map(t => t.trim())
            .filter(t => t.length > 0);
    }

    /**
     * Tokenize a product record into all searchable tokens.
     * Extracts from: name, tags, category names, attribute values.
     * @param {object} product
     * @param {string[]} [categoryNames]
     * @returns {string[]}
     */
    tokenizeProduct(product, categoryNames = []) {
        const tokens = new Set();

        // Product name tokens
        this.tokenize(product.name).forEach(t => tokens.add(t));

        // SKU
        if (product.sku) tokens.add(product.sku.toLowerCase());

        // Tags (vendor names, etc.)
        if (Array.isArray(product.tags)) {
            product.tags.forEach(tag => {
                if (tag) this.tokenize(tag).forEach(t => tokens.add(t));
            });
        }

        // Category names
        categoryNames.forEach(name => {
            this.tokenize(name).forEach(t => tokens.add(t));
        });

        // Attribute values
        if (product.attributes && typeof product.attributes === 'object') {
            Object.values(product.attributes).forEach(val => {
                if (typeof val === 'string') this.tokenize(val).forEach(t => tokens.add(t));
                if (Array.isArray(val)) val.forEach(v => this.tokenize(String(v)).forEach(t => tokens.add(t)));
            });
        }

        return Array.from(tokens);
    }

    // ═══════════════════════════════════════════════
    // REDIS I/O
    // ═══════════════════════════════════════════════

    /**
     * Save a BloomFilter to Redis as a base64-encoded string.
     * No TTL — Bloom filters persist until explicitly rebuilt.
     * @param {string} key
     * @param {BloomFilter} filter
     */
    async _saveFilter(key, filter) {
        if (!redis.isRedisHealthy()) return;

        try {
            const buf = filter.serialize();
            const encoded = buf.toString('base64');
            const client = redis.redisClient;
            const isUpstash = !!process.env.UPSTASH_REDIS_REST_URL;

            if (isUpstash) {
                await client.set(key, encoded);
            } else {
                await client.set(key, encoded);
            }
        } catch (e) {
            console.warn(`[Bloom] Redis save skipped (fail-open): ${e.message}`);
        }
    }

    /**
     * Load a BloomFilter from Redis.
     * @param {string} key
     * @returns {BloomFilter|null}
     */
    async _loadFilter(key) {
        if (!redis.isRedisHealthy()) return null;

        try {
            const client = redis.redisClient;
            const encoded = await client.get(key);
            if (!encoded) return null;

            const buf = Buffer.from(encoded, 'base64');
            return BloomFilter.deserialize(buf);
        } catch (e) {
            console.error(`[Bloom] Failed to load filter at ${key}:`, e.message);
            return null;
        }
    }

    /**
     * Delete a key from Redis.
     * @param {string} key
     */
    async _deleteFilter(key) {
        if (!redis.isRedisHealthy()) return;
        try {
            await redis.redisClient.del(key);
        } catch (e) {
            console.warn(`[Bloom] Redis delete skipped: ${e.message}`);
        }
    }

    /**
     * Save metadata to Redis.
     * @param {string} key
     * @param {object} data
     */
    async _saveMeta(key, data) {
        if (!redis.isRedisHealthy()) return;
        try {
            const client = redis.redisClient;
            const val = JSON.stringify(data);
            const isUpstash = !!process.env.UPSTASH_REDIS_REST_URL;

            if (isUpstash) {
                await client.set(key, val);
            } else {
                await client.set(key, val);
            }
        } catch (e) {
            console.warn(`[Bloom] Redis meta save skipped: ${e.message}`);
        }
    }

    /**
     * Load metadata from Redis.
     * @param {string} key
     * @returns {object|null}
     */
    async _loadMeta(key) {
        if (!redis.isRedisHealthy()) return null;
        try {
            const raw = await redis.redisClient.get(key);
            if (!raw) return null;
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) {
            console.warn(`[Bloom] Redis meta load skipped: ${e.message}`);
            return null;
        }
    }

    // ═══════════════════════════════════════════════
    // BUILD — GLOBAL FILTER
    // ═══════════════════════════════════════════════

    /**
     * Build the global (storewide) Bloom filter for a tenant.
     * Indexes: products, categories, collections, pages, branded search page slugs.
     * @param {string} tenantId
     * @returns {object} stats
     */
    async buildGlobalFilter(tenantId) {
        console.log(`[Bloom] Building global filter for tenant ${tenantId}...`);
        const startTime = Date.now();
        const filter = new BloomFilter(DEFAULT_EXPECTED_ITEMS, DEFAULT_FPR);

        let productCount = 0;
        let categoryCount = 0;
        let collectionCount = 0;
        let pageCount = 0;
        let brandedPageCount = 0;

        // 1. Products (name, sku, tags, attributes)
        try {
            const productsRes = await query(
                `SELECT p.id, p.name, p.sku, p.tags, p.attributes
                 FROM products p
                 WHERE p.tenant_id = $1 AND p.status = 'active' AND p.deleted_at IS NULL AND p.is_variant = false`,
                [tenantId]
            );

            for (const product of productsRes.rows) {
                // Fetch category names for this product
                const catRes = await query(
                    `SELECT c.name FROM categories c
                     JOIN product_categories pc ON c.id = pc.category_id
                     WHERE pc.product_id = $1`,
                    [product.id]
                );
                const catNames = catRes.rows.map(r => r.name);
                const tokens = this.tokenizeProduct(product, catNames);
                tokens.forEach(t => filter.add(t));
                productCount++;
            }
        } catch (e) {
            console.error('[Bloom] Error indexing products:', e.message);
        }

        // 2. Categories (name, slug)
        try {
            const catsRes = await query(
                `SELECT name, slug FROM categories WHERE tenant_id = $1 AND is_active = true`,
                [tenantId]
            );

            for (const cat of catsRes.rows) {
                this.tokenize(cat.name).forEach(t => filter.add(t));
                if (cat.slug) this.tokenize(cat.slug.replace(/-/g, ' ')).forEach(t => filter.add(t));
                categoryCount++;
            }
        } catch (e) {
            console.error('[Bloom] Error indexing categories:', e.message);
        }

        // 3. Collections (name, slug)
        try {
            const colRes = await query(
                `SELECT name, slug FROM collections WHERE tenant_id = $1`,
                [tenantId]
            );

            for (const col of colRes.rows) {
                this.tokenize(col.name).forEach(t => filter.add(t));
                if (col.slug) this.tokenize(col.slug.replace(/-/g, ' ')).forEach(t => filter.add(t));
                collectionCount++;
            }
        } catch (e) {
            console.error('[Bloom] Error indexing collections:', e.message);
        }

        // 4. Pages (title)
        try {
            const pagesRes = await query(
                `SELECT title FROM pages WHERE tenant_id = $1 AND is_published = true`,
                [tenantId]
            );

            for (const page of pagesRes.rows) {
                this.tokenize(page.title).forEach(t => filter.add(t));
                pageCount++;
            }
        } catch (e) {
            // Pages table may not exist
        }

        // 5. Branded Search Pages (via SlugResolver logic, respecting exclusions)
        try {
            const attrsRes = await query(
                `SELECT code, clauses FROM attributes WHERE tenant_id = $1 AND clauses IS NOT NULL`,
                [tenantId]
            );
            const catsRes = await query(
                `SELECT id, name, slug FROM categories WHERE tenant_id = $1 AND is_active = true`,
                [tenantId]
            );

            for (const attr of attrsRes.rows) {
                const clauses = (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : attr.clauses) || [];

                for (const clause of clauses) {
                    const prefix = (clause.prefix || '').trim();
                    const suffix = (clause.suffix || '').trim();
                    if (!prefix && !suffix) continue; // No branded page possible

                    for (const cat of catsRes.rows) {
                        // Generate the branded slug using the same logic as SlugResolver
                        const brandedSlug = this.slugify(`${prefix}${cat.slug || ''}${suffix}`);
                        if (!brandedSlug) continue;

                        // Tokenize the branded slug and the human-readable title
                        const title = `${prefix ? `${prefix} ` : ''}${cat.name}${suffix ? ` ${suffix}` : ''}`.trim();
                        this.tokenize(title).forEach(t => filter.add(t));
                        this.tokenize(brandedSlug.replace(/-/g, ' ')).forEach(t => filter.add(t));
                        brandedPageCount++;
                    }
                }
            }
        } catch (e) {
            console.error('[Bloom] Error indexing branded pages:', e.message);
        }

        // Save to Redis
        await this._saveFilter(GLOBAL_KEY(tenantId), filter);

        // Save metadata
        const meta = {
            lastRebuild: new Date().toISOString(),
            duration: `${Date.now() - startTime}ms`,
            stats: filter.stats(),
            sources: { productCount, categoryCount, collectionCount, pageCount, brandedPageCount }
        };

        await this._saveMeta(META_KEY(tenantId), meta);

        console.log(`[Bloom] Global filter built in ${meta.duration}: ${filter.itemCount} tokens, ${filter.stats().byteSize} bytes`);
        return meta;
    }

    // ═══════════════════════════════════════════════
    // BUILD — CATEGORY FILTER
    // ═══════════════════════════════════════════════

    /**
     * Build a per-category Bloom filter (products only, includes descendants).
     * @param {string} tenantId
     * @param {string} categoryId
     * @returns {object} stats
     */
    async buildCategoryFilter(tenantId, categoryId) {
        const startTime = Date.now();

        // Get all descendant category IDs (recursive)
        const descendantRes = await query(
            `WITH RECURSIVE cat_tree AS (
                SELECT id FROM categories WHERE id = $1 AND tenant_id = $2
                UNION ALL
                SELECT c.id FROM categories c
                INNER JOIN cat_tree ct ON c.parent_id = ct.id
                WHERE c.tenant_id = $2
            )
            SELECT id FROM cat_tree`,
            [categoryId, tenantId]
        );

        const allCatIds = descendantRes.rows.map(r => r.id);

        // Fetch all products in these categories
        const productsRes = await query(
            `SELECT DISTINCT p.id, p.name, p.sku, p.tags, p.attributes
             FROM products p
             JOIN product_categories pc ON p.id = pc.product_id
             WHERE pc.category_id = ANY($1)
             AND p.tenant_id = $2
             AND p.status = 'active'
             AND p.deleted_at IS NULL
             AND p.is_variant = false`,
            [allCatIds, tenantId]
        );

        const filter = new BloomFilter(Math.max(productsRes.rows.length * 10, 1000), DEFAULT_FPR);

        for (const product of productsRes.rows) {
            const tokens = this.tokenizeProduct(product);
            tokens.forEach(t => filter.add(t));
        }

        await this._saveFilter(CATEGORY_KEY(tenantId, categoryId), filter);

        const duration = `${Date.now() - startTime}ms`;
        console.log(`[Bloom] Category filter ${categoryId} built in ${duration}: ${filter.itemCount} tokens, ${productsRes.rows.length} products`);

        return { categoryId, duration, stats: filter.stats(), productCount: productsRes.rows.length };
    }

    // ═══════════════════════════════════════════════
    // REBUILD ALL
    // ═══════════════════════════════════════════════

    /**
     * Full rebuild: global + all leaf/active category filters.
     * @param {string} tenantId
     * @returns {object}
     */
    async rebuildAll(tenantId) {
        const globalMeta = await this.buildGlobalFilter(tenantId);

        // Build category filters for all active categories
        const catsRes = await query(
            `SELECT id FROM categories WHERE tenant_id = $1 AND is_active = true`,
            [tenantId]
        );

        const categoryResults = [];
        for (const cat of catsRes.rows) {
            try {
                const result = await this.buildCategoryFilter(tenantId, cat.id);
                categoryResults.push(result);
            } catch (e) {
                console.error(`[Bloom] Failed to build category filter ${cat.id}:`, e.message);
                categoryResults.push({ categoryId: cat.id, error: e.message });
            }
        }

        return { global: globalMeta, categories: categoryResults };
    }

    // ═══════════════════════════════════════════════
    // TEST — QUERY FILTERS
    // ═══════════════════════════════════════════════

    /**
     * Test tokens against the global filter.
     * @param {string} tenantId
     * @param {string[]} tokens
     * @returns {{ passed: boolean, hits: string[], misses: string[] }}
     */
    async testGlobal(tenantId, tokens) {
        const filter = await this._loadFilter(GLOBAL_KEY(tenantId));
        if (!filter) {
            // Fail-open: if no filter exists, assume all pass
            console.warn(`[Bloom] No global filter for tenant ${tenantId}, fail-open.`);
            return { passed: true, hits: tokens, misses: [], source: 'fail-open' };
        }

        return { ...filter.testMultiple(tokens), source: 'bloom' };
    }

    /**
     * Test tokens against a category filter.
     * @param {string} tenantId
     * @param {string} categoryId
     * @param {string[]} tokens
     * @returns {{ passed: boolean, hits: string[], misses: string[] }}
     */
    async testCategory(tenantId, categoryId, tokens) {
        const filter = await this._loadFilter(CATEGORY_KEY(tenantId, categoryId));
        if (!filter) {
            console.warn(`[Bloom] No category filter for ${categoryId}, fail-open.`);
            return { passed: true, hits: tokens, misses: [], source: 'fail-open' };
        }

        return { ...filter.testMultiple(tokens), source: 'bloom' };
    }

    /**
     * Batch check: test tokens against global + multiple category candidates.
     * Used by the AI pipeline's Step 1 + Step 2.
     * @param {string} tenantId
     * @param {string[]} tokens
     * @param {string[]} [candidateCategoryIds]
     * @returns {object}
     */
    async batchCheck(tenantId, tokens, candidateCategoryIds = []) {
        const normalizedTokens = tokens.map(t => String(t).toLowerCase().trim()).filter(Boolean);

        const globalResult = await this.testGlobal(tenantId, normalizedTokens);

        const categoryResults = {};
        for (const catId of candidateCategoryIds) {
            categoryResults[catId] = await this.testCategory(tenantId, catId, normalizedTokens);
        }

        return {
            global: globalResult,
            categories: categoryResults
        };
    }

    // ═══════════════════════════════════════════════
    // INCREMENTAL UPDATES
    // ═══════════════════════════════════════════════

    /**
     * Add tokens to the global filter incrementally (on product create/update).
     * @param {string} tenantId
     * @param {string[]} tokens
     * @param {string[]} [categoryIds] - Also update these category filters
     */
    async addTokens(tenantId, tokens, categoryIds = []) {
        // Global filter
        const globalFilter = await this._loadFilter(GLOBAL_KEY(tenantId));
        if (globalFilter) {
            tokens.forEach(t => globalFilter.add(t));
            await this._saveFilter(GLOBAL_KEY(tenantId), globalFilter);
        }

        // Category filters
        for (const catId of categoryIds) {
            const catFilter = await this._loadFilter(CATEGORY_KEY(tenantId, catId));
            if (catFilter) {
                tokens.forEach(t => catFilter.add(t));
                await this._saveFilter(CATEGORY_KEY(tenantId, catId), catFilter);
            }
        }
    }

    /**
     * On product deletion, rebuild affected category filters.
     * (Bloom filters don't support removal, so rebuild is necessary.)
     * @param {string} tenantId
     * @param {string[]} categoryIds
     */
    async onProductDeleted(tenantId, categoryIds) {
        for (const catId of categoryIds) {
            try {
                await this.buildCategoryFilter(tenantId, catId);
            } catch (e) {
                console.error(`[Bloom] Failed to rebuild category filter ${catId} after deletion:`, e.message);
            }
        }
    }

    // ═══════════════════════════════════════════════
    // HEALTH & DIAGNOSTICS
    // ═══════════════════════════════════════════════

    /**
     * Get health/stats for a tenant's filters.
     * @param {string} tenantId
     * @returns {object}
     */
    async getHealth(tenantId) {
        const meta = await this._loadMeta(META_KEY(tenantId));

        const globalFilter = await this._loadFilter(GLOBAL_KEY(tenantId));
        const globalStats = globalFilter ? globalFilter.stats() : null;

        return {
            tenantId,
            hasGlobalFilter: !!globalFilter,
            globalStats,
            lastRebuild: meta?.lastRebuild || null,
            sources: meta?.sources || null
        };
    }

    // ═══════════════════════════════════════════════
    // SCANNER — Periodic background health check
    // ═══════════════════════════════════════════════

    /**
     * Scan all active tenants for missing or stale Bloom filters.
     * Automatically rebuilds any that are missing or older than maxAge.
     * 
     * Called on module boot and then periodically.
     * @param {object} [options]
     * @param {number} [options.maxAgeMs] - Max filter age before considered stale (default: 24h)
     */
    async scan(options = {}) {
        const maxAgeMs = options.maxAgeMs || 24 * 60 * 60 * 1000; // 24 hours

        console.log('[Bloom:Scanner] Starting scan for missing/stale filters...');
        const startTime = Date.now();

        try {
            // Get all active tenants
            const tenantsRes = await query(
                `SELECT id, name FROM tenants WHERE status = 'active'`
            );

            let rebuiltCount = 0;
            let skippedCount = 0;

            for (const tenant of tenantsRes.rows) {
                try {
                    // Check if global filter exists and is fresh
                    const meta = await this._loadMeta(META_KEY(tenant.id));

                    const needsRebuild = !meta
                        || !meta.lastRebuild
                        || (Date.now() - new Date(meta.lastRebuild).getTime()) > maxAgeMs;

                    if (!needsRebuild) {
                        // Also verify the actual filter key exists (Redis could have evicted it)
                        const filterExists = await this._loadFilter(GLOBAL_KEY(tenant.id));
                        if (filterExists) {
                            skippedCount++;
                            continue;
                        }
                    }

                    console.log(`[Bloom:Scanner] Rebuilding filters for tenant "${tenant.name}" (${tenant.id})`);
                    await this.rebuildAll(tenant.id);
                    rebuiltCount++;
                } catch (e) {
                    console.error(`[Bloom:Scanner] Failed to process tenant ${tenant.id}:`, e.message);
                }
            }

            const duration = Date.now() - startTime;
            console.log(`[Bloom:Scanner] Scan complete in ${duration}ms — rebuilt: ${rebuiltCount}, skipped: ${skippedCount}`);

            return { rebuiltCount, skippedCount, duration: `${duration}ms` };
        } catch (e) {
            console.error('[Bloom:Scanner] Scan failed:', e.message);
            return { error: e.message };
        }
    }

    /**
     * Start the periodic scanner.
     * @param {number} [intervalMs] - Scan interval (default: 6 hours)
     */
    startScanner(intervalMs = 6 * 60 * 60 * 1000) {
        if (this._scannerInterval) {
            console.warn('[Bloom:Scanner] Scanner already running.');
            return;
        }

        // Run initial scan after a short delay (let other modules boot first)
        this._bootTimeout = setTimeout(async () => {
            await this.scan();
        }, 10_000); // 10s after boot

        // Schedule periodic scans
        this._scannerInterval = setInterval(async () => {
            await this.scan();
        }, intervalMs);

        console.log(`[Bloom:Scanner] Scheduled every ${(intervalMs / 3600000).toFixed(1)}h`);
    }

    /**
     * Stop the periodic scanner.
     */
    stopScanner() {
        if (this._bootTimeout) clearTimeout(this._bootTimeout);
        if (this._scannerInterval) clearInterval(this._scannerInterval);
        this._bootTimeout = null;
        this._scannerInterval = null;
        console.log('[Bloom:Scanner] Stopped.');
    }
}

module.exports = BloomFilterService;

