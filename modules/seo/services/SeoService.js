const { pool } = require('../../../config/database');
const { redisClient, isRedisHealthy } = require('../../../config/redis');

class SeoService {
    /**
     * Generate or retrieve cached sitemap XML
     */
    static async getSitemap(tenantId, baseUrl) {
        const cacheKey = `tenant:${tenantId}:seo:sitemap`;

        // 1. Try Cache
        if (isRedisHealthy()) {
            try {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    return cached;
                }
            } catch (err) {
                console.warn('Redis read failed for sitemap, falling back to DB generation', err);
            }
        }

        // 2. Generate XML
        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

        // Add Home Page
        xml += this._createUrlNode(baseUrl, new Date().toISOString(), '1.0', 'daily');

        // Products
        const products = await pool.query(`
            SELECT handle, updated_at FROM products 
            WHERE tenant_id = $1 AND status = 'active'
        `, [tenantId]);
        products.rows.forEach(p => {
            xml += this._createUrlNode(`${baseUrl}/${p.handle}`, p.updated_at, '0.9', 'weekly');
        });

        // Categories
        const categories = await pool.query(`
            SELECT id, slug, updated_at FROM categories 
            WHERE tenant_id = $1 AND is_active = true
        `, [tenantId]);
        categories.rows.forEach(c => {
            xml += this._createUrlNode(`${baseUrl}/categories/${c.slug}`, c.updated_at, '0.8', 'weekly');
        });

        // Collections
        const collections = await pool.query(`
            SELECT slug, updated_at FROM collections 
            WHERE tenant_id = $1 AND is_active = true
        `, [tenantId]);
        collections.rows.forEach(c => {
            xml += this._createUrlNode(`${baseUrl}/collections/${c.slug}`, c.updated_at, '0.8', 'weekly');
        });

        // Pages
        const pages = await pool.query(`
            SELECT slug, updated_at FROM pages 
            WHERE tenant_id = $1 AND is_published = true
        `, [tenantId]);
        pages.rows.forEach(p => {
            // Adjust based on your frontend routing for pages
            xml += this._createUrlNode(`${baseUrl}/pages/${p.slug}`, p.updated_at, '0.6', 'monthly');
        });

        // Branded Search Pages (Clauses)
        const slugify = (text) => (text || '').toString().toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-');
        
        // Build a memory set of existing category/attribute combinations from search_indexes
        // This avoids doing thousands of individual DB queries
        const existingCombos = new Set();
        const existingRanges = [];
        const validCategoryAttributes = new Set();

        try {
            // 1. Fetch products inventory combinations
            const activeAttrsRes = await pool.query(`
                SELECT 
                    jsonb_array_elements_text(si.metadata->'category_ids') as cat_id,
                    key as attr_code,
                    LOWER(value) as attr_val
                FROM search_indexes si,
                jsonb_each_text(si.metadata->'attributes')
                WHERE si.tenant_id = $1 AND si.is_active = true AND si.content_type = 'product'
            `, [tenantId]);

            activeAttrsRes.rows.forEach(row => {
                existingCombos.add(`${row.cat_id}:${row.attr_code}:${row.attr_val}`);
                const numVal = Number(row.attr_val);
                if (!isNaN(numVal)) {
                    existingRanges.push({
                        cat_id: row.cat_id,
                        attr_code: row.attr_code,
                        val: numVal
                    });
                }
            });

            // 2. Fetch official Category <-> Attribute linkages (including inherited)
            const linkedAttrsRes = await pool.query(`
                WITH RECURSIVE effective_attrs AS (
                    SELECT category_id, attribute_id, tenant_id
                    FROM category_attributes
                    WHERE tenant_id = $1
                    UNION ALL
                    SELECT c.id as category_id, ea.attribute_id, c.tenant_id
                    FROM categories c
                    JOIN effective_attrs ea ON c.parent_id = ea.category_id
                    WHERE c.tenant_id = ea.tenant_id
                )
                SELECT DISTINCT ea.category_id, a.code as attribute_code
                FROM effective_attrs ea
                JOIN attributes a ON a.id = ea.attribute_id AND a.tenant_id = ea.tenant_id
                WHERE ea.tenant_id = $1
            `, [tenantId]);

            linkedAttrsRes.rows.forEach(row => {
                validCategoryAttributes.add(`${row.category_id}:${row.attribute_code}`);
            });

        } catch (e) {
            console.error('[SeoService] Warning: Failed to pre-fetch data for sitemap inventory check', e);
        }

        const attrsRes = await pool.query(
            `SELECT code, clauses FROM attributes WHERE tenant_id = $1 AND clauses IS NOT NULL`,
            [tenantId]
        );

        for (const attr of attrsRes.rows) {
            const clauses = (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : attr.clauses) || [];
            for (const clause of clauses) {
                const prefix = (clause.prefix || '').trim();
                const suffix = (clause.suffix || '').trim();
                const excluded = Array.isArray(clause.excluded_category_ids) ? clause.excluded_category_ids.map(String) : [];
                
                const clauseValue = Array.isArray(clause.value) ? clause.value[0] : (clause.value ?? '1');
                const normalizedValue = String(clauseValue).toLowerCase().trim();
                const operator = clause.operator || '=';
                const numClauseVal = Number(normalizedValue);

                for (const cat of categories.rows) {
                    if (excluded.includes(String(cat.id))) continue;

                    // Ensure this attribute is officially linked to this category (or inherited)
                    if (!validCategoryAttributes.has(`${cat.id}:${attr.code}`)) continue;
                    
                    // Check if products exist for this combination
                    let hasProducts = false;
                    if (operator === '=') {
                        hasProducts = existingCombos.has(`${cat.id}:${attr.code}:${normalizedValue}`);
                    } else if (!isNaN(numClauseVal)) {
                        hasProducts = existingRanges.some(r => 
                            r.cat_id === String(cat.id) && 
                            r.attr_code === attr.code && 
                            ((operator === '<=' && r.val <= numClauseVal) ||
                             (operator === '>=' && r.val >= numClauseVal) ||
                             (operator === '<' && r.val < numClauseVal) ||
                             (operator === '>' && r.val > numClauseVal))
                        );
                    }

                    if (!hasProducts) continue;
                    
                    const generatedSlug = slugify(`${prefix}${cat.slug || ''}${suffix}`);
                    if (generatedSlug && generatedSlug !== cat.slug) {
                        xml += this._createUrlNode(`${baseUrl}/${generatedSlug}`, cat.updated_at, '0.7', 'weekly');
                    }
                }
            }
        }

        xml += `</urlset>`;

        // 3. Save to Cache (cache for 4 hours)
        if (isRedisHealthy()) {
            try {
                // Determine if we are using Upstash (which takes options object) or native node-redis
                const isUpstash = !!process.env.UPSTASH_REDIS_REST_URL;
                if (isUpstash) {
                    await redisClient.set(cacheKey, xml, { ex: 14400 });
                } else {
                    await redisClient.setEx(cacheKey, 14400, xml);
                }
            } catch (err) {
                console.warn('Redis write failed for sitemap', err);
            }
        }

        return xml;
    }

    static _createUrlNode(loc, lastmod, priority, changefreq) {
        const date = lastmod ? new Date(lastmod).toISOString() : new Date().toISOString();
        return `
    <url>
        <loc>${loc}</loc>
        <lastmod>${date}</lastmod>
        <changefreq>${changefreq}</changefreq>
        <priority>${priority}</priority>
    </url>`;
    }

    /**
     * Invalidate Sitemap Cache
     */
    static async invalidateSitemapCache(tenantId) {
        if (!isRedisHealthy()) return;
        const cacheKey = `tenant:${tenantId}:seo:sitemap`;
        try {
            await redisClient.del(cacheKey);
            console.log(`[SEO Service] Invalidated sitemap cache for tenant: ${tenantId}`);
        } catch (err) {
            console.warn('[SEO Service] Failed to invalidate sitemap cache', err);
        }
    }

    /**
     * Get SEO Presets
     */
    static async getPresets(tenantId) {
        const result = await pool.query('SELECT * FROM seo_presets WHERE tenant_id = $1 LIMIT 1', [tenantId]);
        return result.rows[0] || {};
    }
}

module.exports = SeoService;
