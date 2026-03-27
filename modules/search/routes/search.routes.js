/**
 * Main Search Routes
 * Core search functionality and autocomplete
 */

const { query } = require('../../../config/database');
const { optionalAuth } = require('../../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../../middleware/errorHandler');
const SearchService = require('../services/SearchService');
const AutocompleteService = require('../services/AutocompleteService');
const SearchAnalyticsService = require('../services/SearchAnalyticsService');
const FilterService = require('../services/FilterService');
const RandomizationService = require('../services/RandomizationService');
const { generateSearchSEO } = require('../../../lib/searchSEO');

function registerSearchRoutes(router) {
    // Main search endpoint
    router.get('/', optionalAuth, asyncHandler(async (req, res) => {
        const searchService = new SearchService();
        const analyticsService = new SearchAnalyticsService();

        const {
            q: searchQuery = '',
            type: contentTypes,
            page = 1,
            per_page = 20,
            sort = 'relevance',
            price_min,
            price_max,
            category_id,
            category_ids,
            collection_id,
            collection_slug,
            status,
            is_featured,
            id,
            tag,
            tags,
            mode,
            similar_to: similarTo
        } = req.query;

        // Parse content types
        let contentTypeArray = null;
        if (contentTypes) {
            contentTypeArray = Array.isArray(contentTypes)
                ? contentTypes
                : contentTypes.split(',').map(t => t.trim());
        }

        // Build filters object
        const filters = {};
        if (id) filters.id = id;
        if (price_min) filters.price_min = price_min;
        if (price_max) filters.price_max = price_max;
        if (category_id) filters.category_id = category_id;
        if (category_ids) {
            filters.category_ids = Array.isArray(category_ids)
                ? category_ids
                : category_ids.split(',').map(id => id.trim());
        }
        if (status) filters.status = status;
        if (is_featured !== undefined) filters.is_featured = is_featured === 'true';
        if (collection_id) filters.collection_id = collection_id;
        if (collection_slug) filters.collection_slug = collection_slug;
        if (tag) filters.tag = tag;
        if (tags) {
            filters.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
        }

        // Parse attribute filters (e.g., attribute.color=red)
        Object.keys(req.query).forEach(key => {
            if (key.startsWith('attribute.')) {
                filters[key] = req.query[key];
            }
        });

        // Perform search
        const searchResults = await searchService.search(req.tenantId, {
            query: searchQuery,
            contentTypes: contentTypeArray,
            filters,
            sort,
            page: parseInt(page),
            perPage: parseInt(per_page),
            mode,
            similar_to: similarTo
        });

        // Track search analytics
        try {
            await analyticsService.trackSearch(req.tenantId, {
                query: searchQuery,
                filters,
                resultCount: searchResults.pagination.total,
                sessionId: req.query.session_id || null,
                userId: req.user?.id || null
            });
        } catch (error) {
            console.error('[Search] Error tracking analytics:', error);
            // Don't fail the request if analytics fails
        }

        // Generate SEO metadata
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const seo = generateSearchSEO(
            searchQuery,
            filters,
            searchResults.results,
            searchResults.pagination,
            baseUrl
        );

        res.json({
            success: true,
            query: searchQuery,
            results: searchResults.results,
            facets: searchResults.facets,
            pagination: searchResults.pagination,
            category: searchResults.category,
            collection: searchResults.collection,
            attribute: searchResults.attribute,
            clause: searchResults.clause,
            mode: searchResults.mode,
            is_relaxed: searchResults.is_relaxed,
            seo
        });
    }));

    /**
     * Specialized Product Search
     * Forces content_type = 'product' and supports category slugs
     */
    router.get('/products', optionalAuth, asyncHandler(async (req, res) => {
        const searchService = new SearchService();
        const {
            q: searchQuery = '',
            category, // Supports slug or ID
            page = 1,
            per_page = 20,
            sort = 'relevance',
            price_min,
            price_max,
            vendor,
            tag,
            tags,
            mode,
            similar_to: similarTo
        } = req.query;

        const filters = {};
        if (price_min) filters.price_min = price_min;
        if (price_max) filters.price_max = price_max;
        if (category) filters.category_id = category; // SearchService.search resolves slug via CategoryResolver
        if (vendor) filters['attribute.vendor'] = vendor;
        if (tag) filters.tag = tag;
        if (tags) {
            filters.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
        }

        // Perform search forced to 'product' type
        const searchResults = await searchService.search(req.tenantId, {
            query: searchQuery,
            contentTypes: ['product'],
            filters,
            sort,
            page: parseInt(page),
            perPage: parseInt(per_page),
            mode,
            similar_to: similarTo
        });

        res.json({
            success: true,
            products: searchResults.results,
            total: searchResults.pagination.total,
            pagination: searchResults.pagination,
            category: searchResults.category,
            collection: searchResults.collection,
            attribute: searchResults.attribute,
            clause: searchResults.clause,
            mode: searchResults.mode,
            is_relaxed: searchResults.is_relaxed
        });
    }));


    // Autocomplete endpoint
    router.get('/autocomplete', asyncHandler(async (req, res) => {
        const autocompleteService = new AutocompleteService();
        const { q: partialQuery = '', limit = 10 } = req.query;

        if (partialQuery.length < 2) {
            return res.json({ success: true, suggestions: [] });
        }

        const suggestions = await autocompleteService.getSuggestions(
            req.tenantId,
            partialQuery,
            parseInt(limit)
        );

        res.json({ success: true, suggestions });
    }));

    // Get available filters
    router.get('/filters', asyncHandler(async (req, res) => {
        const filterService = new FilterService();
        const filters = await filterService.getFilters(req.tenantId);
        res.json({ success: true, filters });
    }));

    // Resolve branded slug endpoint
    router.get('/resolve-slug/:slug', asyncHandler(async (req, res) => {
        const searchService = new SearchService();
        const { slug } = req.params;

        const resolution = await searchService.resolveBrandedSlug(req.tenantId, slug);

        if (!resolution) {
            return res.status(404).json({ success: false, error: 'Slug not found' });
        }

        res.json({ success: true, ...resolution });
    }));

    // Attribute clause random category endpoint (for widgets)
    router.get('/attribute-clause/random-category', optionalAuth, asyncHandler(async (req, res) => {
        const searchService = new SearchService();

        const attributeCode = String(req.query.attribute_code || '').trim();
        const clauseName = String(req.query.clause || '').trim();
        const perPage = Math.max(1, Math.min(48, parseInt(req.query.per_page || '12', 10)));
        const sort = String(req.query.sort || 'relevance');

        if (!attributeCode || !clauseName) {
            return res.status(400).json({
                success: false,
                error: 'attribute_code and clause are required'
            });
        }

        const attrRes = await query(
            `SELECT id, code, label, type, clauses FROM attributes WHERE tenant_id = $1 AND code = $2`,
            [req.tenantId, attributeCode]
        );

        const attr = attrRes.rows[0];
        if (!attr) {
            return res.status(404).json({ success: false, error: 'Attribute not found' });
        }

        const clauses = (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : (attr.clauses || [])) || [];
        const clause = clauses.find(c => c && c.name === clauseName);
        if (!clause) {
            return res.status(404).json({ success: false, error: 'Clause not found on attribute' });
        }

        // Get all eligible categories
        const eligibleCatsRes = await query(
            `
            WITH RECURSIVE effective_attrs AS (
                -- Anchor: direct category->attribute links
                SELECT category_id, attribute_id, tenant_id
                FROM category_attributes
                WHERE tenant_id = $1

                UNION ALL

                -- Recursive: descendants inherit from parent
                SELECT c.id as category_id, ea.attribute_id, c.tenant_id
                FROM categories c
                JOIN effective_attrs ea ON c.parent_id = ea.category_id
                WHERE c.tenant_id = ea.tenant_id
            )
            SELECT DISTINCT c.id, c.name, c.slug, c.image_url
            FROM effective_attrs ea
            JOIN attributes a ON a.id = ea.attribute_id AND a.tenant_id = ea.tenant_id
            JOIN categories c ON c.id = ea.category_id AND c.tenant_id = ea.tenant_id
            WHERE ea.tenant_id = $1
            AND a.code = $2
            AND c.is_active = true
            `,
            [req.tenantId, attributeCode]
        );

        const excluded = Array.isArray(clause.excluded_category_ids) ? clause.excluded_category_ids.map(String) : [];
        const eligible = eligibleCatsRes.rows.filter(c => !excluded.includes(String(c.id)));

        if (eligible.length === 0) {
            return res.status(404).json({ success: false, error: 'No eligible categories for this clause' });
        }

        const picked = eligible[Math.floor(Math.random() * eligible.length)];

        const slugify = (text) => (text || '')
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, '')
            .replace(/--+/g, '-');

        const prefix = (clause.prefix || '').trim();
        const suffix = (clause.suffix || '').trim();

        const title = (prefix || suffix)
            ? `${prefix ? `${prefix} ` : ''}${picked.name}${suffix ? ` ${suffix}` : ''}`.trim()
            : (clause.label || clause.name);

        const prettySlug = slugify(`${prefix}${picked.slug || ''}${suffix}`);
        const prettyUrl = `/${prettySlug}`;

        const filterKey = `attribute.${attributeCode}:${clause.name}`;
        const filterValue = clause.value ?? 1;

        const results = await searchService.search(req.tenantId, {
            query: '',
            contentTypes: ['product'],
            filters: {
                category_id: picked.id,
                [filterKey]: filterValue
            },
            sort,
            page: 1,
            perPage
        });

        res.json({
            success: true,
            attribute: { code: attr.code, label: attr.label, type: attr.type },
            clause,
            category: picked,
            title,
            pretty_slug: prettySlug,
            pretty_url: prettyUrl,
            filter: `category_id=${picked.id}&${filterKey}=${encodeURIComponent(String(filterValue))}`,
            results: results.results,
            pagination: results.pagination
        });
    }));

    // Master Plan Randomization Resolver
    router.post('/randomization/resolve', optionalAuth, asyncHandler(async (req, res) => {
        const { widgets, pageHandle = 'home' } = req.body;

        if (!widgets || !Array.isArray(widgets)) {
            return res.status(400).json({
                success: false,
                error: 'widgets array is required'
            });
        }

        const results = await RandomizationService.getSnapshotPlan(req.tenantId, pageHandle, widgets);

        res.json({
            success: true,
            results
        });
    }));

    /**
     * Batch Product Resolution API
     * Executes parallel searches for multiple randomized widgets in one call
     */
    router.post('/randomization/batch-products', optionalAuth, asyncHandler(async (req, res) => {
        const { widgets } = req.body; // Array of { widgetId, filter, sort, perPage }
        const searchService = new SearchService();

        if (!widgets || !Array.isArray(widgets)) {
            return res.status(400).json({ success: false, error: 'widgets array is required' });
        }

        const results = {};
        const searchPromises = widgets.map(async (w) => {
            try {
                const filters = {};
                // Parse "category_id=123&attribute.color=red" string into filters object
                if (w.filter) {
                    const params = new URLSearchParams(w.filter);
                    for (const [key, value] of params.entries()) {
                        filters[key] = value;
                    }
                }

                // Merge enriched filters object if provided
                if (w.filters && typeof w.filters === 'object') {
                    Object.assign(filters, w.filters);
                }

                const searchRes = await searchService.search(req.tenantId, {
                    query: '',
                    contentTypes: ['product'],
                    filters,
                    sort: filters.sort || w.sort || 'relevance',
                    page: 1,
                    perPage: parseInt(filters.limit) || parseInt(w.perPage) || 12
                });

                results[w.widgetId] = {
                    results: searchRes.results,
                    pagination: searchRes.pagination
                };
            } catch (err) {
                console.error(`[Search] Batch resolution failed for widget ${w.widgetId}:`, err);
                results[w.widgetId] = { error: 'Failed to resolve products', results: [] };
            }
        });

        await Promise.all(searchPromises);

        // --- ENRICHMENT STEP: Fetch Stats ---
        try {
            // 1. Collect all product IDs across all widgets
            const allProductIds = new Set();
            Object.values(results).forEach(widgetData => {
                if (widgetData.results && Array.isArray(widgetData.results)) {
                    widgetData.results.forEach(p => allProductIds.add(p.id));
                }
            });

            if (allProductIds.size > 0) {
                const productIdList = Array.from(allProductIds);

                // 2. Query Analytics (Impressions)
                // Assuming analytics_events table structure from prior context
                // Count 'view_item' events for 'product' type
                const analyticsRes = await query(`
                    SELECT entity_id, COUNT(*) as count
                    FROM analytics_events
                    WHERE tenant_id = $1
                    AND event_type = 'impression'
                    AND entity_type = 'product'
                    AND entity_id = ANY($2)
                    GROUP BY entity_id
                `, [req.tenantId, productIdList]);

                // 3. Query Wishlists
                const wishlistRes = await query(`
                    SELECT product_id, COUNT(*) as count
                    FROM wishlists
                    WHERE tenant_id = $1
                    AND product_id = ANY($2)
                    GROUP BY product_id
                `, [req.tenantId, productIdList]);

                // 4. Map stats
                const statsMap = {}; // { productId: { impressions, wishlist_count } }

                analyticsRes.rows.forEach(row => {
                    if (!statsMap[row.entity_id]) statsMap[row.entity_id] = { impressions: 0, wishlist_count: 0 };
                    statsMap[row.entity_id].impressions = parseInt(row.count);
                });

                wishlistRes.rows.forEach(row => {
                    if (!statsMap[row.product_id]) statsMap[row.product_id] = { impressions: 0, wishlist_count: 0 };
                    statsMap[row.product_id].wishlist_count = parseInt(row.count);
                });

                // 5. Inject back into results
                Object.values(results).forEach(widgetData => {
                    if (widgetData.results && Array.isArray(widgetData.results)) {
                        widgetData.results.forEach(p => {
                            p.stats = statsMap[p.id] || { impressions: 0, wishlist_count: 0 };
                        });
                    }
                });
            }
        } catch (err) {
            console.error('[Search] Failed to enrich batch results with stats:', err);
            // Don't fail the request, just log error. Stats will be missing/undefined.
        }
        // ------------------------------------

        res.json({
            success: true,
            results
        });
    }));

    // Get search suggestions (popular/trending)
    router.get('/suggestions', asyncHandler(async (req, res) => {
        const autocompleteService = new AutocompleteService();
        const { type = 'popular', limit = 10 } = req.query;

        let suggestions = [];
        if (type === 'trending') {
            suggestions = await autocompleteService.getTrendingSearches(
                req.tenantId,
                parseInt(limit)
            );
        } else {
            suggestions = await autocompleteService.getPopularSearches(
                req.tenantId,
                parseInt(limit)
            );
        }

        res.json({ success: true, suggestions });
    }));

    // Filter schema for storefront search UI
    router.get('/filter-schema', asyncHandler(async (req, res) => {
        const { category_id } = req.query;

        // 1) Categories (for category filter UI)
        const categoriesRes = await query(
            `SELECT id, name, slug FROM categories WHERE tenant_id = $1 AND is_active = true ORDER BY name ASC`,
            [req.tenantId]
        );

        // 2) Attribute definitions (optionally scoped by category)
        let attrCodes = null;
        if (category_id) {
            const codesRes = await query(
                `SELECT a.code
                 FROM category_attributes ca
                 JOIN attributes a ON a.id = ca.attribute_id AND a.tenant_id = ca.tenant_id
                 WHERE ca.tenant_id = $1 AND ca.category_id = $2
                 ORDER BY ca.display_order ASC`,
                [req.tenantId, category_id]
            );
            attrCodes = codesRes.rows.map(r => r.code).filter(Boolean);
        }

        const attrsRes = attrCodes
            ? await query(
                `SELECT id, code, label, type, options, clauses
                 FROM attributes
                 WHERE tenant_id = $1 AND code = ANY($2)
                 ORDER BY label ASC`,
                [req.tenantId, attrCodes]
            )
            : await query(
                `SELECT id, code, label, type, options, clauses
                 FROM attributes
                 WHERE tenant_id = $1
                 ORDER BY label ASC`,
                [req.tenantId]
            );

        res.json({
            success: true,
            categories: categoriesRes.rows,
            attributes: attrsRes.rows.map(a => ({
                id: a.id,
                code: a.code,
                label: a.label,
                type: a.type,
                options: a.options || null,
                clauses: a.clauses || []
            })),
            supportedFilters: {
                price: true,
                status: true,
                is_featured: true,
                category: true,
                attributes: true
            },
            supportedSorts: ['relevance', 'price_asc', 'price_desc', 'date_desc', 'date_asc'],
            supportedContentTypes: ['product', 'category', 'page']
        });
    }));
}

module.exports = { registerSearchRoutes };
