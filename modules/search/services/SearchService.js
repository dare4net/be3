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
const ProductService = require('../../products/services/ProductService');
const VectorEngine = require('../../vector/services/VectorEngine');

class SearchService {
    constructor() {
        this.categoryResolver = new CategoryResolver();
        this.slugResolver = new SlugResolver();
        this.filterSQLBuilder = new FilterSQLBuilder(this.categoryResolver);
        this.sortSQLBuilder = new SortSQLBuilder();
        this.queryPreprocessor = new QueryPreprocessor();
        this.queryProcessor = new QueryProcessor();
        this.facetedFiltersAggregator = new FacetedFiltersAggregator(this.categoryResolver, this.filterSQLBuilder);
        this.vectorEngine = new VectorEngine();
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
            perPage = 20,
            mode: searchMode = 'keyword', // 'keyword', 'vector', 'similar', 'image'
            similar_to: similarTo = null,
            image: searchImage = null,
            userId = null,
            include_stats = false,
            threshold = null
        } = params;

        // Recursive Category Fetch + Auto Drill-down
        let originalCategoryId = filters.category_id;
        if (filters.category_id) {
            let resolvedId = await this.categoryResolver.resolveCategoryId(tenantId, filters.category_id);

            // Auto-drill down if only one child exists
            resolvedId = await this.categoryResolver.resolveDeepestSingleChild(tenantId, resolvedId);

            originalCategoryId = resolvedId;
            const allCategoryIds = await this.categoryResolver.getDescendantCategoryIds(tenantId, resolvedId);
            filters.category_ids = allCategoryIds;
            delete filters.category_id;
        }

        // In vector/similar mode, do NOT perform query preprocessing or inference.
        // Use only the query + filters the caller supplied.
        let finalQuery = (searchQuery || '').trim();
        if (searchMode !== 'vector' && searchMode !== 'similar' && searchMode !== 'image') {
            const { processedQuery, additionalFilters } = await this.queryPreprocessor.preprocessQuery(
                tenantId,
                searchQuery || '',
                originalCategoryId,
                filters
            );
            // Fix: Ensure finalQuery is trimmed if it's not null, otherwise use original search query
            finalQuery = (processedQuery === null) ? (searchQuery || '') : processedQuery.trim();

            // Guardrail: don't overwrite explicit user filters with inferred ones.
            // (Important for category/attribute correctness.)
            for (const [k, v] of Object.entries(additionalFilters || {})) {
                if (!Object.prototype.hasOwnProperty.call(filters, k)) {
                    filters[k] = v;
                }
            }
        }

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
                    const attrRes = await query(`
                        SELECT id, code, label, clauses FROM attributes WHERE code = $1 AND tenant_id = $2
                        UNION ALL
                        SELECT id, code, label, '[]'::jsonb as clauses FROM system_attributes WHERE code = $1
                    `, [attrCode, tenantId]);
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

        // --- NEW: Vector/Visual Search Branch ---
        if (searchMode === 'vector' || searchMode === 'similar' || searchMode === 'image' || searchImage) {
            let vectorResults = [];
            let total = 0;
            let queryVector = null;
            let vectorColumn = 'embedding';
            const offset = (page - 1) * perPage;

            // Determine effective search mode
            const effectiveMode = searchImage ? 'image' : searchMode;

            // Build dynamic filters
            const vectorFilters = {
                ...filters,
                deleted_at: null,
                is_variant: false
            };
            const vectorQueryParams = [];
            const vectorFilterStartIndex = 4;
            const { sql: vectorFilterSql } = await this.filterSQLBuilder.buildProductFilterSQL(
                tenantId,
                vectorFilters,
                vectorQueryParams,
                vectorFilterStartIndex
            );

            if (effectiveMode === 'similar' && similarTo) {
                console.log(`[Search] 🧠 Similarity search for ${similarTo}`);
                // For similarity, we don't easily have the vector here without fetching, 
                // but we can let VectorEngine handle it. Facets might still be broad for 'similar'
                // unless we specifically fetch the source product vector.
                vectorResults = await this.vectorEngine.findSimilarProducts(tenantId, similarTo, {
                    limit: perPage + 1,
                    offset: offset,
                    filter: { sql: vectorFilterSql, params: vectorQueryParams }
                });
            } else if (effectiveMode === 'image' || searchImage) {
                const source = searchImage || searchQuery;
                console.log(`[Search] 👁️ Visual search for: "${typeof source === 'string' ? source.substring(0, 50) : 'Buffer'}..."`);

                // GET THE VECTOR EXPLICITLY FOR FACETS
                queryVector = await this.vectorEngine.getImageEmbedding(source);
                vectorColumn = 'image_embedding';

                vectorResults = await this.vectorEngine.visualSearch(tenantId, queryVector, {
                    limit: perPage + 1,
                    offset: offset,
                    threshold: threshold || 0.7,
                    filter: { sql: vectorFilterSql, params: vectorQueryParams }
                });
            } else if (finalQuery) {
                console.log(`[Search] 🧠 Pure vector search for: "${finalQuery}"`);

                // GET THE VECTOR EXPLICITLY FOR FACETS
                queryVector = await this.vectorEngine.getEmbedding(finalQuery);
                vectorColumn = 'embedding';

                vectorResults = await this.vectorEngine.semanticSearch(tenantId, queryVector, {
                    limit: perPage + 1,
                    offset: offset,
                    filter: { sql: vectorFilterSql, params: vectorQueryParams }
                });
            }

            // --- LOOK-AHEAD PAGINATION LOGIC ---
            // If we got the extra result, there is a next page.
            const hasMore = vectorResults.length > perPage;
            if (hasMore) {
                vectorResults.pop(); // Remove the extra look-ahead result
                total = page * perPage + 1; // Signal that at least one more exists
            } else {
                total = offset + vectorResults.length; // Exact total found so far
            }

            // Map vector results to standard search index format
            const results = vectorResults.map(p => ({
                content_id: p.id,
                content_type: 'product',
                title: p.name,
                content: p.description,
                rank: (p.similarity || 0) / 100,
                metadata: {
                    name: p.name,
                    price: p.price,
                    description: p.description,
                    image_url: p.image_url,
                    handle: p.handle,
                    status: p.status,
                    tags: p.tags,
                    attributes: p.attributes || {}
                }
            }));

            // Standardize results using the existing mapper
            const finalResults = results.map(row => {
                return {
                    ...row,
                    id: row.content_id,
                    name: row.title || row.metadata.name,
                    price: row.metadata.price || 0,
                    image_url: row.metadata.image_url,
                    slug: row.metadata.handle || row.metadata.slug,
                    is_featured: row.metadata.is_featured || false,
                    status: row.metadata.status || 'active',
                    sku: row.metadata.sku,
                    description: row.metadata.description || row.content,
                    attributes: row.metadata.attributes || {},
                    tags: row.metadata.tags || []
                };
            });

            // Resolve dynamic tags (publicly)
            await ProductService.resolve(tenantId, null, finalResults);

            // Optional: Enrich with stats
            if (include_stats) {
                await ProductService.enrichWithStats(tenantId, finalResults);
            }

            // Get facets (constrained by vector context if available)
            const facets = await this.facetedFiltersAggregator.getFacetedFilters(
                tenantId,
                '',
                ['product'],
                filters,
                originalCategoryId,
                null,
                queryVector ? { column: vectorColumn, vector: queryVector, threshold: threshold || 0.7 } : null
            );

            // Fetch SEO context (preserved behavior)
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
                results: finalResults,
                facets,
                category,
                collection,
                attribute,
                clause,
                mode: searchMode,
                query_vector: queryVector, // Return the vector for optimization
                vector_column: vectorColumn,
                is_relaxed: false,
                pagination: {
                    page,
                    perPage,
                    total: total,
                    totalPages: Math.ceil(total / perPage)
                }
            };
        }

        // Waterfall Strategy: Try AND first, then OR if filters exist
        const modes = ['AND'];

        // Determine if relaxation is allowed (requires at least one filter context)
        const hasFilters = Object.keys(filters).length > 0 || originalCategoryId || collection;
        if (hasFilters && finalQuery) {
            modes.push('OR');
        }

        let lastAttempt = null;

        for (const mode of modes) {
            const expandedQuery = finalQuery ? await this.queryProcessor.expandQuery(finalQuery, tenantId, mode) : '';

            // Build base search query
            let sql = '';
            const queryParams = [];
            let paramIndex = 1;

            if (expandedQuery) {
                sql = `
                    SELECT 
                        si.*,
                        ts_rank(si.search_vector, query) as rank
                    FROM search_indexes si
                    JOIN products p ON si.content_id = p.id AND si.content_type = 'product'
                    CROSS JOIN to_tsquery('english', $${paramIndex}) query
                    WHERE si.tenant_id = $${paramIndex + 1}
                    AND si.is_active = true
                    AND p.deleted_at IS NULL
                    AND p.is_variant = false
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
                    JOIN products p ON si.content_id = p.id AND si.content_type = 'product'
                    WHERE si.tenant_id = $${paramIndex}
                    AND si.is_active = true
                    AND p.deleted_at IS NULL
                    AND p.is_variant = false
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
            const currentParams = [...queryParams];
            const filterSQL = await this.filterSQLBuilder.buildFilterSQL(tenantId, filters, currentParams, paramIndex);
            sql += filterSQL.sql;
            const finalIndex = filterSQL.nextIndex;

            // Apply sorting using Builder
            sql += this.sortSQLBuilder.buildSortSQL(sort);

            // Apply pagination
            sql += ` LIMIT $${finalIndex} OFFSET $${finalIndex + 1}`;
            currentParams.push(perPage, (page - 1) * perPage);

            const searchResults = await query(sql, currentParams);

            // Get total count
            let countSQL = '';
            const countParams = [];
            let countParamIndex = 1;

            if (expandedQuery) {
                countSQL = `
                    SELECT COUNT(*) as total
                    FROM search_indexes si
                    JOIN products p ON si.content_id = p.id AND si.content_type = 'product'
                    CROSS JOIN to_tsquery('english', $${countParamIndex}) query
                    WHERE si.tenant_id = $${countParamIndex + 1}
                    AND si.is_active = true
                    AND p.deleted_at IS NULL
                    AND p.is_variant = false
                    AND si.search_vector @@ query
                `;
                countParams.push(expandedQuery, tenantId);
                countParamIndex = 3;
            } else {
                countSQL = `
                    SELECT COUNT(*) as total
                    FROM search_indexes si
                    JOIN products p ON si.content_id = p.id AND si.content_type = 'product'
                    WHERE si.tenant_id = $${countParamIndex}
                    AND si.is_active = true
                    AND p.deleted_at IS NULL
                    AND p.is_variant = false
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

            lastAttempt = {
                results: searchResults.rows,
                total,
                mode
            };

            // If we found results, stop the waterfall
            if (total > 0) {
                if (mode === 'OR') console.log(`[Search] ⚡ Relaxed search successful for: "${finalQuery}"`);
                break;
            }

            // If and failed but we have OR mode left, continue
            if (mode === 'AND' && modes.includes('OR')) {
                console.log(`[Search] 🔍 No results for strict AND, retrying with relaxed OR: "${finalQuery}"`);
            }
        }

        // Map and flat results
        const results = lastAttempt.results.map(row => {
            if (row.content_type === 'product' && row.metadata) {
                return {
                    ...row,
                    id: row.content_id,
                    name: row.title || row.metadata.name,
                    price: row.metadata.price || 0,
                    image_url: row.metadata.image_url,
                    slug: row.metadata.handle || row.metadata.slug,
                    is_featured: row.metadata.is_featured || false,
                    status: row.metadata.status || 'active',
                    sku: row.metadata.sku,
                    description: row.metadata.description || row.content,
                    attributes: row.metadata.attributes || {},
                    tags: row.metadata.tags || []
                };
            }
            return row;
        });

        // Resolve dynamic tags (publicly)
        await ProductService.resolve(tenantId, null, results);

        // Optional: Enrich with stats
        if (include_stats) {
            await ProductService.enrichWithStats(tenantId, results);
        }

        // Get faceted filter counts (only if we have results or after final attempt)
        const expandedQueryForFacets = finalQuery ? await this.queryProcessor.expandQuery(finalQuery, tenantId, lastAttempt.mode) : '';
        const facets = await this.facetedFiltersAggregator.getFacetedFilters(tenantId, expandedQueryForFacets, contentTypes, filters, originalCategoryId, userId);

        // Fetch category context for SEO
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
            mode: lastAttempt.mode,
            is_relaxed: lastAttempt.mode === 'OR',
            pagination: {
                page,
                perPage,
                total: lastAttempt.total,
                totalPages: Math.ceil(lastAttempt.total / perPage)
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
