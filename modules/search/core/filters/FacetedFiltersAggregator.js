/**
 * Faceted Filters Aggregator
 * Calculates intelligent, context-aware filter counts and metadata from search results
 * Enhanced for hierarchical navigation (Back/Sideways/Drill-down)
 */

const { query } = require('../../../../config/database');

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
     * @returns {Object}
     */
    async getFacetedFilters(tenantId, searchQuery, contentTypes, currentFilters, contextCategoryId = null) {
        // Step 1: Execute the result set query to find which IDs exist in the current search scope
        // IMPORTANT: To allow "sideways" navigation, we calculate category counts WITHOUT the category filter
        const filtersForCategoryFacet = { ...currentFilters };
        delete filtersForCategoryFacet.category_id;
        delete filtersForCategoryFacet.category_ids;

        const getBaseSQL = (filtersToApply) => {
            let sql = `
                SELECT 
                    si.metadata
                FROM search_indexes si
                WHERE si.tenant_id = $1
                AND si.is_active = true
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

            return { sql, params, nextIndex: pi };
        };

        // Get results with Category Filter (for attributes, tags, price)
        const filteredBase = getBaseSQL(currentFilters);
        const filteredRes = await this.filterSQLBuilder.buildFilterSQL(tenantId, currentFilters, filteredBase.params, filteredBase.nextIndex);
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
                meta.tags.forEach(tag => facets.tags[tag] = (facets.tags[tag] || 0) + 1);
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

        if (catIdsFound.length > 0) {
            if (contextCategoryId) {
                // Fetch Parent for "Back" navigation
                const parentRes = await query(
                    `SELECT p.id, p.name, p.slug FROM categories c 
                     JOIN categories p ON c.parent_id = p.id 
                     WHERE c.id = $1 AND c.tenant_id = $2`,
                    [contextCategoryId, tenantId]
                );
                if (parentRes.rows[0]) parentCategory = parentRes.rows[0];

                // Fetch Siblings (Sideways) + Children (Drill-down)
                // Navigation Strategy: 
                // 1. If we are in Category X, show its children.
                // 2. ALSO show it's siblings so user can switch "sideways".
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
            const attrMetaRes = await query(`SELECT id, code, label, type, clauses FROM attributes WHERE tenant_id = $1 AND code = ANY($2)`, [tenantId, attrCodesFound]);
            enrichedAttributes = attrMetaRes.rows.map(attr => {
                const metaValues = facets.attributes[attr.code] || {};
                const clauses = (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : attr.clauses) || [];
                const activeClauses = clauses.map(c => {
                    const count = (Array.isArray(c.value) ? c.value : [c.value]).reduce((sum, v) => sum + (metaValues[v] || 0), 0);
                    return count > 0 ? { ...c, count } : null;
                }).filter(Boolean);
                return { ...attr, options: Object.entries(metaValues).map(([value, count]) => ({ value, count })), clauses: activeClauses };
            });
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
