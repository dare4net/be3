/**
 * Faceted Filters Aggregator
 * Calculates filter counts and ranges from search results
 */

const { query } = require('../../../../config/database');

class FacetedFiltersAggregator {
    constructor(categoryResolver, filterSQLBuilder) {
        this.categoryResolver = categoryResolver;
        this.filterSQLBuilder = filterSQLBuilder;
    }

    /**
     * Get faceted filter counts
     * @param {string} tenantId
     * @param {string} searchQuery - Search query string
     * @param {Array} contentTypes
     * @param {Object} currentFilters
     * @returns {Object}
     */
    async getFacetedFilters(tenantId, searchQuery, contentTypes, currentFilters) {
        let targetCategoryIds = currentFilters.category_ids || [];
        if (currentFilters.category_id) {
            const allCategoryIds = await this.categoryResolver.getDescendantCategoryIds(tenantId, currentFilters.category_id);
            targetCategoryIds = allCategoryIds;
        }

        let sql = `
            SELECT 
                si.metadata
            FROM search_indexes si
            WHERE si.tenant_id = $1
            AND si.is_active = true
        `;

        const queryParams = [tenantId];
        let paramIndex = 2;

        // Apply content type filter
        if (contentTypes && contentTypes.length > 0) {
            sql += ` AND si.content_type = ANY($${paramIndex})`;
            queryParams.push(contentTypes);
            paramIndex++;
        }

        // Apply text search if searchQuery exists
        if (searchQuery && searchQuery.trim() !== '') {
            sql += ` AND si.search_vector @@ to_tsquery('english', $${paramIndex})`;
            queryParams.push(searchQuery);
            paramIndex++;
        }

        // Apply current filters (except the one we're counting)
        const filterSQL = await this.filterSQLBuilder.buildFilterSQL(tenantId, currentFilters, queryParams, paramIndex);
        sql += filterSQL.sql;

        const results = await query(sql, queryParams);

        // Calculate facets
        const facets = {
            price: { min: null, max: null },
            categories: {},
            statuses: {},
            tags: {},
            attributes: {}
        };

        results.rows.forEach(row => {
            const meta = row.metadata || {};

            // Price range
            if (meta.price) {
                const price = parseFloat(meta.price);
                if (facets.price.min === null || price < facets.price.min) {
                    facets.price.min = price;
                }
                if (facets.price.max === null || price > facets.price.max) {
                    facets.price.max = price;
                }
            }

            // Categories
            if (meta.category_ids && Array.isArray(meta.category_ids)) {
                meta.category_ids.forEach(catId => {
                    facets.categories[catId] = (facets.categories[catId] || 0) + 1;
                });
            }

            // Status
            if (meta.status) {
                facets.statuses[meta.status] = (facets.statuses[meta.status] || 0) + 1;
            }

            // Tags
            if (meta.tags && Array.isArray(meta.tags)) {
                meta.tags.forEach(tag => {
                    facets.tags[tag] = (facets.tags[tag] || 0) + 1;
                });
            }

            // Attributes
            if (meta.attributes && typeof meta.attributes === 'object') {
                Object.keys(meta.attributes).forEach(attrKey => {
                    if (!facets.attributes[attrKey]) {
                        facets.attributes[attrKey] = {};
                    }
                    const attrValue = meta.attributes[attrKey];
                    facets.attributes[attrKey][attrValue] =
                        (facets.attributes[attrKey][attrValue] || 0) + 1;
                });
            }
        });

        // Filter out attributes that are ignored or not relevant for the current category context
        if (targetCategoryIds && targetCategoryIds.length > 0) {
            const primaryCatId = targetCategoryIds[0];
            const validAttrsRes = await query(`
                WITH RECURSIVE category_tree AS (
                    SELECT id, parent_id, 0 as depth FROM categories WHERE id = $1 AND tenant_id = $2
                    UNION ALL
                    SELECT c.id, c.parent_id, ct.depth + 1 FROM categories c
                    JOIN category_tree ct ON c.id = ct.parent_id WHERE c.tenant_id = $2
                ),
                attrs AS (
                    SELECT DISTINCT ON (a.code) a.code, ca.is_ignored FROM category_tree ct
                    JOIN category_attributes ca ON ca.category_id = ct.id
                    JOIN attributes a ON a.id = ca.attribute_id
                    ORDER BY a.code, ct.depth ASC
                )
                SELECT code FROM attrs WHERE is_ignored = false`, [primaryCatId, tenantId]);

            const validCodes = new Set(validAttrsRes.rows.map(r => r.code));

            // Remove any attributes from facets that are not in validCodes
            Object.keys(facets.attributes).forEach(attrKey => {
                if (!validCodes.has(attrKey)) {
                    delete facets.attributes[attrKey];
                }
            });
        }

        return facets;
    }
}

module.exports = FacetedFiltersAggregator;
