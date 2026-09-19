/**
 * Faceted Filters Aggregator
 * Calculates intelligent, context-aware filter counts and metadata from search results
 * Enhanced for hierarchical navigation (Back/Sideways/Drill-down)
 */

const { query } = require('../../../../config/database');
const ProductService = require('../../../products/services/ProductService');

class FacetedFiltersAggregator {
    constructor(categoryResolver, filterSQLBuilder) {
        this.categoryResolver = categoryResolver;
        this.filterSQLBuilder = filterSQLBuilder;
    }

    /**
     * Get faceted filter counts with metadata
     * @param {string} tenantId
     * @param {string} searchQuery - Search query string
     * @param {Array} contentTypes
     * @param {Object} currentFilters
     * @param {string} contextCategoryId - The category context we are currently in (from URL/Page)
     * @param {string} userId - Current user context (optional)
     * @returns {Object}
     */
    async getFacetedFilters(tenantId, searchQuery, contentTypes, currentFilters, contextCategoryId = null, userId = null, vectorContext = null) {
        // Step 1: Execute the result set query to find which IDs exist in the current search scope
        // IMPORTANT: To allow "sideways" navigation, we calculate category counts WITHOUT the category filter
        const filtersForCategoryFacet = {
            ...currentFilters,
            deleted_at: null,
            is_variant: false
        };
        delete filtersForCategoryFacet.category_id;
        delete filtersForCategoryFacet.category_ids;

        const currentFiltersWithExclusions = {
            ...currentFilters,
            deleted_at: null,
            is_variant: false
        };

        const getBaseSQL = (filtersToApply) => {
            let sql = `
                SELECT 
                    si.metadata
                FROM search_indexes si
                JOIN products p ON si.content_id = p.id AND si.content_type = 'product'
                WHERE si.tenant_id = $1
                AND si.is_active = true
                AND p.deleted_at IS NULL
                AND p.is_variant = false
            `;
            const params = [tenantId];
            let pi = 2;

            if (contentTypes && contentTypes.length > 0) {
                sql += ` AND si.content_type = ANY($${pi})`;
                params.push(contentTypes);
                pi++;
            }

            if (searchQuery && searchQuery.trim() !== '') {
                sql += ` AND si.search_vector @@ to_tsquery('english', $${pi})`;
                params.push(searchQuery);
                pi++;
            }

            if (vectorContext && vectorContext.vector) {
                const vectorStr = `[${vectorContext.vector.join(',')}]`;
                sql += ` AND p.${vectorContext.column} <=> $${pi}::vector <= $${pi + 1}`;
                params.push(vectorStr, 1 - (vectorContext.threshold || 0.7));
                pi += 2;
            }

            return { sql, params, nextIndex: pi };
        };

        // Get results with Category Filter (for attributes, tags, price)
        const filteredBase = getBaseSQL(currentFiltersWithExclusions);
        const filteredRes = await this.filterSQLBuilder.buildFilterSQL(tenantId, currentFiltersWithExclusions, filteredBase.params, filteredBase.nextIndex);
        const filteredResults = await query(filteredBase.sql + filteredRes.sql, filteredBase.params);

        // Get results WITHOUT Category Filter (for category navigation)
        const catBase = getBaseSQL(filtersForCategoryFacet);
        const catRes = await this.filterSQLBuilder.buildFilterSQL(tenantId, filtersForCategoryFacet, catBase.params, catBase.nextIndex);
        const catResults = await query(catBase.sql + catRes.sql, catBase.params);

        // Calculate counts
        const facets = {
            price: { min: null, max: 0 },
            categories: {},
            tags: {},
            attributes: {}
        };

        // 1. Process standard facets (filtered by everything)
        // Extract unique raw tags for batch resolution
        const rawTags = new Set();
        filteredResults.rows.forEach(row => {
            if (row.metadata?.tags) row.metadata.tags.forEach(t => rawTags.add(String(t)));
        });

        // Resolve tags (handles [BUSINESS_NAME] etc.)
        const tagMap = {};
        if (rawTags.size > 0) {
            for (const tag of rawTags) {
                // We resolve each tag individually against the registry (batching happens inside resolve if needed)
                // Using a simpler resolution for facets: pass context to resolve
                const resolved = await ProductService.resolve(tenantId, userId, { tags: [tag], created_by: userId });
                tagMap[tag] = resolved.tags[0];
            }
        }

        filteredResults.rows.forEach(row => {
            const meta = row.metadata || {};
            // Price
            if (meta.price !== undefined) {
                const p = parseFloat(meta.price);
                if (p > facets.price.max) facets.price.max = p;
                if (facets.price.min === null || p < facets.price.min) facets.price.min = p;
            }
            // Tags
            if (meta.tags && Array.isArray(meta.tags)) {
                meta.tags.forEach(tag => {
                    const resolvedTag = tagMap[String(tag)] || tag;
                    facets.tags[resolvedTag] = (facets.tags[resolvedTag] || 0) + 1;
                });
            }
            // Attributes
            if (meta.attributes && typeof meta.attributes === 'object') {
                Object.entries(meta.attributes).forEach(([key, val]) => {
                    if (!facets.attributes[key]) facets.attributes[key] = {};
                    facets.attributes[key][val] = (facets.attributes[key][val] || 0) + 1;
                });
            }
        });

        // 2. Process Categories (filtered by everything EXCEPT category)
        catResults.rows.forEach(row => {
            const meta = row.metadata || {};
            if (meta.category_ids && Array.isArray(meta.category_ids)) {
                meta.category_ids.forEach(id => facets.categories[id] = (facets.categories[id] || 0) + 1);
            }
        });

        // --- INTELLIGENT HIERARCHY ENRICHMENT ---
        const catIdsFound = Object.keys(facets.categories);
        let enrichedCategories = [];
        let parentCategory = null;
        let ancestryPath = [];

        if (catIdsFound.length > 0) {
            if (contextCategoryId) {
                // Fetch Parent + Ancestry for "Back" navigation and Clause Exclusion
                const pathRes = await query(
                    `WITH RECURSIVE category_path AS (
                        SELECT id, name, slug, parent_id, 0 as level
                        FROM categories
                        WHERE id = $1 AND tenant_id = $2
                        UNION ALL
                        SELECT c.id, c.name, c.slug, c.parent_id, cp.level + 1
                        FROM categories c
                        INNER JOIN category_path cp ON c.id = cp.parent_id
                        WHERE c.tenant_id = $2
                    )
                    SELECT id, name, slug, parent_id FROM category_path ORDER BY level ASC`,
                    [contextCategoryId, tenantId]
                );

                ancestryPath = pathRes.rows.map(r => String(r.id));
                if (pathRes.rows[1]) parentCategory = pathRes.rows[1]; // Level 1 is parent

                // Fetch Siblings (Sideways) + Children (Drill-down)
                const navRes = await query(
                    `SELECT id, name, slug, parent_id FROM categories 
                     WHERE (parent_id = $1 OR parent_id = (SELECT parent_id FROM categories WHERE id = $1))
                     AND id = ANY($2) AND is_active = true
                     ORDER BY name ASC`,
                    [contextCategoryId, catIdsFound]
                );
                enrichedCategories = navRes.rows.map(c => ({ ...c, count: facets.categories[c.id] }));
            } else {
                // Top-level only for generic search
                const topRes = await query(
                    `SELECT id, name, slug FROM categories 
                     WHERE parent_id IS NULL AND id = ANY($1) AND is_active = true
                     ORDER BY name ASC`,
                    [catIdsFound]
                );
                enrichedCategories = topRes.rows.map(c => ({ ...c, count: facets.categories[c.id] }));
            }
        }

        // 3. Attribute Enrichment
        const attrCodesFound = Object.keys(facets.attributes);
        let enrichedAttributes = [];
        if (attrCodesFound.length > 0) {
            // Fetch both tenant attributes and global system attributes
            const attrMetaRes = await query(`
                SELECT id, code, label, type, clauses FROM attributes WHERE tenant_id = $1 AND code = ANY($2)
                UNION ALL
                SELECT id, code, label, type, '[]'::jsonb as clauses FROM system_attributes WHERE code = ANY($2)
            `, [tenantId, attrCodesFound]);
            enrichedAttributes = await Promise.all(attrMetaRes.rows.map(async attr => {
                const metaValues = facets.attributes[attr.code] || {};
                const clauses = (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : attr.clauses) || [];

                const activeClausesPromises = clauses.map(async c => {
                    // Check Hierarchical Exclusion (Hide clause entirely if context is forbidden)
                    const excludedIds = Array.isArray(c.excluded_category_ids) ? c.excluded_category_ids.map(String) : [];
                    const isContextExcluded = ancestryPath.some(id => excludedIds.includes(String(id)));
                    if (isContextExcluded) return null;

                    // Hierarchical Product Exclusion (Don't count products in forbidden subcategories)
                    let forbiddenPool = new Set(excludedIds);
                    if (excludedIds.length > 0) {
                        const forbiddenDesRes = await query(
                            `WITH RECURSIVE forbidden_tree AS (
                                SELECT id FROM categories WHERE id = ANY($1::uuid[]) AND tenant_id = $2
                                UNION ALL
                                SELECT c.id FROM categories c 
                                INNER JOIN forbidden_tree ft ON c.parent_id = ft.id
                                WHERE c.tenant_id = $2
                            )
                            SELECT id FROM forbidden_tree`,
                            [excludedIds, tenantId]
                        );
                        forbiddenDesRes.rows.forEach(r => forbiddenPool.add(String(r.id)));
                    }

                    // Calculate refined count
                    let count = 0;
                    const valuesToMatch = Array.isArray(c.value) ? c.value.map(v => String(v).toLowerCase()) : [String(c.value).toLowerCase()];

                    filteredResults.rows.forEach(row => {
                        const meta = row.metadata || {};
                        const productCats = Array.isArray(meta.category_ids) ? meta.category_ids.map(String) : [];

                        // EXCLUSION CHECK: If product is in ANY forbidden sub-category, skip it for this clause
                        const isProductForbidden = productCats.some(id => forbiddenPool.has(id));
                        if (isProductForbidden) return;

                        const attrVal = String(meta.attributes?.[attr.code] || '').toLowerCase();
                        if (valuesToMatch.includes(attrVal)) {
                            count++;
                        }
                    });

                    return count > 0 ? { ...c, count } : null;
                });

                return {
                    ...attr,
                    options: Object.entries(metaValues).map(([value, count]) => ({ value, count })),
                    clauses: (await Promise.all(activeClausesPromises)).filter(Boolean)
                };
            }));
        }

        return {
            price: facets.price,
            categories: enrichedCategories,
            parent_category: parentCategory,
            tags: Object.entries(facets.tags).map(([name, count]) => ({ name, count })),
            attributes: enrichedAttributes,
            context: { category_id: contextCategoryId }
        };
    }
}

module.exports = FacetedFiltersAggregator;
