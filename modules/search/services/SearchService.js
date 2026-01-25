/**
 * Search Service
 * Core search logic with PostgreSQL full-text search
 * Refactored to use modular core components
 */

const { query } = require('../../../config/database');
const SearchSynonym = require('../models/SearchSynonym'); // Kept if needed, but QueryProcessor handles synonyms now
const CategoryResolver = require('../core/resolvers/CategoryResolver');
const SlugResolver = require('../core/resolvers/SlugResolver');
const FilterSQLBuilder = require('../core/filters/FilterSQLBuilder');
const SortSQLBuilder = require('../core/builders/SortSQLBuilder');
const QueryPreprocessor = require('../core/query/QueryPreprocessor');
const QueryProcessor = require('../core/query/QueryProcessor');
const FacetedFiltersAggregator = require('../core/filters/FacetedFiltersAggregator');

class SearchService {
    constructor() {
        this.categoryResolver = new CategoryResolver();
        this.slugResolver = new SlugResolver();
        this.filterSQLBuilder = new FilterSQLBuilder(this.categoryResolver);
        this.sortSQLBuilder = new SortSQLBuilder();
        this.queryPreprocessor = new QueryPreprocessor();
        this.queryProcessor = new QueryProcessor();
        this.facetedFiltersAggregator = new FacetedFiltersAggregator(this.categoryResolver, this.filterSQLBuilder);
    }

    /**
     * Perform search with filters
     * @param {string} tenantId
     * @param {Object} params - { query, contentTypes, filters, sort, page, perPage }
     */
    async search(tenantId, params) {
        const {
            query: searchQuery,
            contentTypes,
            filters = {},
            sort = 'relevance',
            page = 1,
            perPage = 20
        } = params;

        // Recursive Category Fetch
        let originalCategoryId = filters.category_id;
        if (filters.category_id) {
            const resolvedId = await this.categoryResolver.resolveCategoryId(tenantId, filters.category_id);
            originalCategoryId = resolvedId;
            const allCategoryIds = await this.categoryResolver.getDescendantCategoryIds(tenantId, resolvedId);
            filters.category_ids = allCategoryIds;
            delete filters.category_id;
        }

        const { processedQuery, additionalFilters } = await this.queryPreprocessor.preprocessQuery(tenantId, searchQuery || '', originalCategoryId);
        // Fix: Ensure finalQuery is trimmed if it's not null, otherwise use original search query
        const finalQuery = (processedQuery === null) ? (searchQuery || '') : processedQuery.trim();
        Object.assign(filters, additionalFilters);

        // Resolve Collection if provided
        let collection = null;
        if (filters.collection_slug || filters.collection_id) {
            const colRes = filters.collection_id
                ? await query(`SELECT id, name, slug, description, rules, manual_product_ids, excluded_product_ids FROM collections WHERE id = $1 AND tenant_id = $2`, [filters.collection_id, tenantId])
                : await query(`SELECT id, name, slug, description, rules, manual_product_ids, excluded_product_ids FROM collections WHERE slug = $1 AND tenant_id = $2`, [filters.collection_slug, tenantId]);

            if (colRes.rows[0]) {
                collection = colRes.rows[0];
                const col = colRes.rows[0];
                try {
                    filters.collection_rules = typeof col.rules === 'string' ? JSON.parse(col.rules) : col.rules;
                } catch (e) {
                    filters.collection_rules = [];
                }
                filters.collection_manual_in = col.manual_product_ids;
                filters.collection_manual_ex = col.excluded_product_ids;
            }
            delete filters.collection_slug;
            delete filters.collection_id;
        }

        // Detect Attribute Clause filters for metadata (for return object)
        let attribute = null;
        let clause = null;
        // Logic to extract attribute/clause meta for the response
        // We can replicate the logic that was here or move it to a helper, but it's small enough to keep or we can fetch it.
        // For now, let's keep the logic to extract metadata for the response object.
        for (const key of Object.keys(filters)) {
            if (key.startsWith('attribute.')) {
                const val = filters[key];
                const parts = key.split('.');
                let attrCode = parts[1];
                let clauseName = null;

                if (attrCode.includes(':')) {
                    [attrCode, clauseName] = attrCode.split(':');
                } else if (typeof val === 'string' && val.includes(':')) {
                    [clauseName] = val.split(':');
                }

                if (attrCode && clauseName) {
                    const attrRes = await query(`SELECT id, code, label, clauses FROM attributes WHERE code = $1 AND tenant_id = $2`, [attrCode, tenantId]);
                    if (attrRes.rows[0]) {
                        attribute = {
                            id: attrRes.rows[0].id,
                            code: attrRes.rows[0].code,
                            label: attrRes.rows[0].label
                        };
                        const clauses = (typeof attrRes.rows[0].clauses === 'string'
                            ? JSON.parse(attrRes.rows[0].clauses)
                            : attrRes.rows[0].clauses) || [];
                        clause = clauses.find(c => c.name === clauseName);
                    }
                }
            }
        }

        // Expand query with synonyms
        const expandedQuery = finalQuery ? await this.queryProcessor.expandQuery(finalQuery, tenantId) : '';

        // Build base search query
        let sql = '';
        const queryParams = [];
        let paramIndex = 1;

        if (expandedQuery) {
            sql = `
                SELECT 
                    si.*,
                    ts_rank(si.search_vector, query) as rank
                FROM search_indexes si,
                to_tsquery('english', $${paramIndex}) query
                WHERE si.tenant_id = $${paramIndex + 1}
                AND si.is_active = true
                AND si.search_vector @@ query
            `;
            queryParams.push(expandedQuery, tenantId);
            paramIndex = 3;
        } else {
            sql = `
                SELECT 
                    si.*,
                    1 as rank
                FROM search_indexes si
                WHERE si.tenant_id = $${paramIndex}
                AND si.is_active = true
            `;
            queryParams.push(tenantId);
            paramIndex = 2;
        }

        // Apply content type filter
        if (contentTypes && contentTypes.length > 0) {
            sql += ` AND si.content_type = ANY($${paramIndex})`;
            queryParams.push(contentTypes);
            paramIndex++;
        }

        // Apply faceted filters using Builder
        const filterSQL = await this.filterSQLBuilder.buildFilterSQL(tenantId, filters, queryParams, paramIndex);
        sql += filterSQL.sql;
        paramIndex = filterSQL.nextIndex;

        // Get total count before pagination
        let countSQL = '';
        const countParams = [];
        let countParamIndex = 1;

        if (expandedQuery) {
            countSQL = `
                SELECT COUNT(*) as total
                FROM search_indexes si,
                to_tsquery('english', $${countParamIndex}) query
                WHERE si.tenant_id = $${countParamIndex + 1}
                AND si.is_active = true
                AND si.search_vector @@ query
            `;
            countParams.push(expandedQuery, tenantId);
            countParamIndex = 3;
        } else {
            countSQL = `
                SELECT COUNT(*) as total
                FROM search_indexes si
                WHERE si.tenant_id = $${countParamIndex}
                AND si.is_active = true
            `;
            countParams.push(tenantId);
            countParamIndex = 2;
        }

        if (contentTypes && contentTypes.length > 0) {
            countSQL += ` AND si.content_type = ANY($${countParamIndex})`;
            countParams.push(contentTypes);
            countParamIndex++;
        }

        const countFilterSQL = await this.filterSQLBuilder.buildFilterSQL(tenantId, filters, countParams, countParamIndex);
        countSQL += countFilterSQL.sql;

        const countResult = await query(countSQL, countParams);
        const total = parseInt(countResult.rows[0]?.total || 0);

        // Apply sorting using Builder
        sql += this.sortSQLBuilder.buildSortSQL(sort);

        // Apply pagination
        sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        queryParams.push(perPage, (page - 1) * perPage);

        const searchResults = await query(sql, queryParams);

        // Map and flat results for product consumption in widgets
        const results = searchResults.rows.map(row => {
            if (row.content_type === 'product' && row.metadata) {
                return {
                    ...row,
                    id: row.content_id, // Ensure id is content_id
                    name: row.title || row.metadata.name,
                    price: row.metadata.price || 0,
                    image_url: row.metadata.image_url,
                    slug: row.metadata.handle || row.metadata.slug,
                    is_featured: row.metadata.is_featured || false,
                    status: row.metadata.status || 'active',
                    sku: row.metadata.sku,
                    description: row.content // content field usually stores description
                };
            }
            return row;
        });

        // Get faceted filter counts using Aggregator
        const facets = await this.facetedFiltersAggregator.getFacetedFilters(tenantId, expandedQuery, contentTypes, filters);

        // Fetch category context for SEO if filtered by category
        let category = null;
        const rawCatId = originalCategoryId || filters.category_id || (filters.category_ids && filters.category_ids[0]);
        if (rawCatId && !Array.isArray(rawCatId)) {
            const resolvedId = await this.categoryResolver.resolveCategoryId(tenantId, rawCatId);
            const catRes = await query(`SELECT id, name, slug, description FROM categories WHERE id = $1 AND tenant_id = $2`, [resolvedId, tenantId]);
            if (catRes.rows[0]) {
                category = catRes.rows[0];
            }
        }

        return {
            results,
            facets,
            category,
            collection,
            attribute,
            clause,
            pagination: {
                page,
                perPage,
                total,
                totalPages: Math.ceil(total / perPage)
            }
        };
    }

    /**
     * Resolve a branded slug
     * Delegate to SlugResolver
     */
    async resolveBrandedSlug(tenantId, slug) {
        return this.slugResolver.resolveBrandedSlug(tenantId, slug);
    }
}

module.exports = SearchService;
