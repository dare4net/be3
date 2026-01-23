/**
 * Search Service
 * Core search logic with PostgreSQL full-text search
 */

const { query } = require('../../../config/database');
const SearchSynonym = require('../models/SearchSynonym');
const { generateBrandedSEO } = require('../../../lib/seoHelpers');

class SearchService {
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
            const resolvedId = await this.resolveCategoryId(tenantId, filters.category_id);
            originalCategoryId = resolvedId;
            const allCategoryIds = await this.getDescendantCategoryIds(tenantId, resolvedId);
            filters.category_ids = allCategoryIds;
            delete filters.category_id;
        }

        const { processedQuery, additionalFilters } = await this.preprocessQuery(tenantId, searchQuery || '', originalCategoryId);
        const finalQuery = processedQuery || searchQuery;
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

        // Detect Attribute Clause filters for metadata
        let attribute = null;
        let clause = null;
        for (const key of Object.keys(filters)) {
            if (key.startsWith('attribute.')) {
                const val = filters[key];
                const parts = key.split('.');
                let attrCode = parts[1];
                let clauseName = null;

                // Handle format attribute.code:value = 1 (sent by widget)
                if (attrCode.includes(':')) {
                    [attrCode, clauseName] = attrCode.split(':');
                }
                // Handle format attribute.code = "value:clause" (sent by search UI)
                else if (typeof val === 'string' && val.includes(':')) {
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
        const expandedQuery = finalQuery ? await this.expandQuery(finalQuery, tenantId) : '';

        // AUTO-ROTATION: If we have a clause filter but NO category context, pick one randomly from matching products
        if (clause && !originalCategoryId) {
            // We use a simplified facet fetch to find eligible categories for this clause
            const rotationFacets = await this.getFacetedFilters(tenantId, expandedQuery, contentTypes, filters);
            const catIds = rotationFacets.categories ? Object.keys(rotationFacets.categories) : [];

            if (catIds.length > 0) {
                // Pick a random category ID from the eligible ones
                const pickedCatId = catIds[Math.floor(Math.random() * catIds.length)];
                originalCategoryId = pickedCatId;

                // Fetch descendants and update filters to lock into this category
                const allCategoryIds = await this.getDescendantCategoryIds(tenantId, pickedCatId);
                filters.category_ids = allCategoryIds;
            }
        }

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

        // Apply faceted filters
        const filterSQL = await this.buildFilterSQL(tenantId, filters, queryParams, paramIndex);
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

        const countFilterSQL = await this.buildFilterSQL(tenantId, filters, countParams, countParamIndex);
        countSQL += countFilterSQL.sql;

        const countResult = await query(countSQL, countParams);
        const total = parseInt(countResult.rows[0]?.total || 0);

        // Apply sorting
        sql += this.buildSortSQL(sort);

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

        // Get faceted filter counts
        const facets = await this.getFacetedFilters(tenantId, expandedQuery, contentTypes, filters);

        // Fetch category context for SEO if filtered by category
        let category = null;
        const rawCatId = originalCategoryId || filters.category_id || (filters.category_ids && filters.category_ids[0]);
        if (rawCatId && !Array.isArray(rawCatId)) {
            const resolvedId = await this.resolveCategoryId(tenantId, rawCatId);
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
     * Expand query with synonyms
     * @param {string} query - Original search query
     * @param {string} tenantId
     * @returns {string} - Expanded query with synonyms
     */
    async expandQuery(searchQuery, tenantId) {
        if (!searchQuery || searchQuery.trim() === '') {
            return '';
        }

        // Get active synonyms for tenant
        const synonyms = await SearchSynonym.findActive(tenantId);

        if (synonyms.length === 0) {
            // No synonyms, return sanitized query
            return this.sanitizeQuery(searchQuery);
        }

        // Build synonym map
        const synonymMap = new Map();
        synonyms.forEach(syn => {
            const allTerms = [syn.term, ...syn.synonyms];
            allTerms.forEach(term => {
                if (!synonymMap.has(term.toLowerCase())) {
                    synonymMap.set(term.toLowerCase(), allTerms);
                }
            });
        });

        // Expand query terms
        const terms = searchQuery.toLowerCase().split(/\s+/);
        const expandedTerms = terms.map(term => {
            const cleanTerm = term.replace(/[^\w]/g, '');
            if (synonymMap.has(cleanTerm)) {
                const synonyms = synonymMap.get(cleanTerm);
                return `(${synonyms.join(' | ')})`;
            }
            return cleanTerm;
        });

        return expandedTerms.join(' & ');
    }

    /**
     * Sanitize query for PostgreSQL tsquery
     * @param {string} query
     * @returns {string}
     */
    sanitizeQuery(query) {
        // Remove special characters and convert to tsquery format
        return query
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 0)
            .join(' & ');
    }

    /**
     * Build filter SQL
     * @param {Object} filters
     * @param {Array} queryParams
     * @param {number} startIndex
     * @returns {Object} - { sql, nextIndex }
     */
    async buildFilterSQL(tenantId, filters, queryParams, startIndex) {
        let sql = '';
        let index = startIndex;

        // Collection Rules and Overrides
        if (filters.collection_rules || filters.collection_manual_in || filters.collection_manual_ex) {
            let colSQL = ' (';
            let hasRules = false;

            if (filters.collection_rules && Array.isArray(filters.collection_rules) && filters.collection_rules.length > 0) {
                const ruleConditions = [];
                for (const rule of filters.collection_rules) {
                    const { field, operator, value } = rule;
                    switch (field) {
                        case 'category':
                            const catIds = Array.isArray(value) ? value : [value];
                            if (catIds.length > 0) {
                                const resolvedCatIds = [];
                                for (const id of catIds) {
                                    const descendants = await this.getDescendantCategoryIds(tenantId, id);
                                    resolvedCatIds.push(...descendants);
                                }
                                ruleConditions.push(`si.metadata->'category_ids' ?| $${index}`);
                                queryParams.push([...new Set(resolvedCatIds)]);
                                index++;
                            }
                            break;
                        case 'tag':
                            if (Array.isArray(value)) {
                                ruleConditions.push(`si.metadata->'tags' ?| $${index}`);
                            } else {
                                ruleConditions.push(`si.metadata->'tags' ? $${index}`);
                            }
                            queryParams.push(value);
                            index++;
                            break;
                        case 'price':
                            const priceVal = `si.metadata->>'price'`;
                            const safePrice = `(CASE WHEN ${priceVal} ~ '^-?[0-9.]+$' THEN (${priceVal})::numeric ELSE NULL END)`;
                            if (operator === 'gt') {
                                ruleConditions.push(`${safePrice} > $${index}`);
                            } else if (operator === 'lt') {
                                ruleConditions.push(`${safePrice} < $${index}`);
                            }
                            queryParams.push(parseFloat(value));
                            index++;
                            break;
                        case 'has_attribute':
                            ruleConditions.push(`si.metadata->'attributes' ? $${index}`);
                            queryParams.push(value);
                            index++;
                            break;
                        case 'attribute':
                            let attrCode, attrVal;
                            if (rule.attribute_code) {
                                attrCode = rule.attribute_code;
                                attrVal = rule.value;
                            } else {
                                [attrCode, attrVal] = String(value).split(':');
                            }
                            if (attrCode && attrVal !== undefined) {
                                if (Array.isArray(attrVal)) {
                                    ruleConditions.push(`si.metadata->'attributes'->>$${index} = ANY($${index + 1})`);
                                } else {
                                    ruleConditions.push(`si.metadata->'attributes'->>$${index} = $${index + 1}`);
                                }
                                queryParams.push(attrCode, attrVal);
                                index += 2;
                            }
                            break;
                        case 'attribute_clause':
                            const acattrCode = rule.attribute_code;
                            const clauseName = value;
                            if (acattrCode && clauseName) {
                                const attrRes = await query(
                                    `SELECT clauses, type FROM attributes WHERE tenant_id = $1 AND code = $2`,
                                    [tenantId, acattrCode]
                                );
                                if (attrRes.rows[0]) {
                                    const { clauses, type } = attrRes.rows[0];
                                    const clause = (clauses || []).find(c => c.name === clauseName);
                                    if (clause) {
                                        let op = clause.operator || '=';
                                        const ruleVal = clause.value;
                                        const isArray = Array.isArray(ruleVal);

                                        if (isArray && (op === '=' || op === 'LIKE' || op === 'ILIKE')) {
                                            op = (op === 'LIKE' || op === 'ILIKE') ? 'ILIKE ANY' : '= ANY';
                                        }

                                        if (type === 'number') {
                                            const attrVal = `si.metadata->'attributes'->>$${index}`;
                                            const safeAttr = `(CASE WHEN ${attrVal} ~ '^-?[0-9.]+$' THEN (${attrVal})::numeric ELSE NULL END)`;
                                            ruleConditions.push(`${safeAttr} ${op} (${isArray ? `$${index + 1}::numeric[]` : `$${index + 1}`})`);
                                        } else {
                                            ruleConditions.push(`si.metadata->'attributes'->>$${index} ${op} ($${index + 1})`);
                                        }
                                        queryParams.push(acattrCode, ruleVal);
                                        index += 2;
                                    }
                                }
                            }
                            break;
                    }
                }
                if (ruleConditions.length > 0) {
                    colSQL += `(${ruleConditions.join(' AND ')})`;
                    hasRules = true;
                }
            }

            if (filters.collection_manual_in && Array.isArray(filters.collection_manual_in) && filters.collection_manual_in.length > 0) {
                if (hasRules) colSQL += ' OR ';
                colSQL += `si.content_id = ANY($${index})`;
                queryParams.push(filters.collection_manual_in);
                index++;
                hasRules = true;
            }

            if (!hasRules) colSQL += ' TRUE';
            colSQL += ') ';

            if (filters.collection_manual_ex && Array.isArray(filters.collection_manual_ex) && filters.collection_manual_ex.length > 0) {
                colSQL += ` AND si.content_id != ALL($${index})`;
                queryParams.push(filters.collection_manual_ex);
                index++;
            }

            sql += ` AND ${colSQL}`;
        }

        // Price range filter
        if (filters.price_min !== undefined && filters.price_min !== null) {
            sql += ` AND (si.metadata->>'price')::numeric >= $${index}`;
            queryParams.push(parseFloat(filters.price_min));
            index++;
        }

        if (filters.price_max !== undefined && filters.price_max !== null) {
            sql += ` AND (si.metadata->>'price')::numeric <= $${index}`;
            queryParams.push(parseFloat(filters.price_max));
            index++;
        }

        // Category filter
        if (filters.category_id) {
            sql += ` AND si.metadata->'category_ids' ? $${index}`;
            queryParams.push(filters.category_id);
            index++;
        }

        if (filters.category_ids && Array.isArray(filters.category_ids)) {
            sql += ` AND si.metadata->'category_ids' ?| $${index}`;
            queryParams.push(filters.category_ids);
            index++;
        }

        // Status filter
        if (filters.status) {
            sql += ` AND si.metadata->>'status' = $${index}`;
            queryParams.push(filters.status);
            index++;
        }

        // Featured filter
        if (filters.is_featured !== undefined) {
            sql += ` AND (si.metadata->>'is_featured')::boolean = $${index}`;
            queryParams.push(filters.is_featured);
            index++;
        }

        // Tag filter
        if (filters.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
            sql += ` AND si.metadata->'tags' ?| $${index}`;
            queryParams.push(filters.tags);
            index++;
        } else if (filters.tag) {
            sql += ` AND si.metadata->'tags' ? $${index}`;
            queryParams.push(filters.tag);
            index++;
        }

        // Custom attribute filters (e.g., attribute.color, attribute.size, attribute.price:budget_deal)
        const attributeKeys = Object.keys(filters).filter(k => k.startsWith('attribute.'));

        if (attributeKeys.length > 0) {
            for (const key of attributeKeys) {
                const parts = key.replace('attribute.', '').split(':');
                const attrCode = parts[0];
                const clauseName = parts[1];
                const filterValue = filters[key];

                if (clauseName) {
                    const attrRes = await query(
                        `SELECT clauses, type FROM attributes WHERE tenant_id = $1 AND code = $2`,
                        [tenantId, attrCode]
                    );

                    if (attrRes.rows[0]) {
                        const { type } = attrRes.rows[0];
                        const clauses = (typeof attrRes.rows[0].clauses === 'string'
                            ? JSON.parse(attrRes.rows[0].clauses)
                            : attrRes.rows[0].clauses) || [];
                        const clause = clauses.find(c => c.name === clauseName);

                        if (clause) {
                            const op = clause.operator || '=';
                            const rawVal = clause.value || filterValue;

                            // Support array values (multi-select/multi-match)
                            const isArray = Array.isArray(rawVal) || (typeof rawVal === 'string' && rawVal.includes(','));
                            const val = Array.isArray(rawVal) ? rawVal : (typeof rawVal === 'string' && rawVal.includes(',') ? rawVal.split(',').map(v => v.trim()) : rawVal);

                            if (isArray && (op === '=' || op === 'LIKE' || op === 'ILIKE')) {
                                const finalOp = (op === 'LIKE' || op === 'ILIKE') ? 'ILIKE ANY' : '= ANY';
                                if (type === 'number') {
                                    sql += ` AND (si.metadata->'attributes'->>$${index})::numeric ${finalOp}($${index + 1}::numeric[])`;
                                } else {
                                    sql += ` AND si.metadata->'attributes'->>$${index} ${finalOp}($${index + 1})`;
                                }
                                queryParams.push(attrCode, val);
                                index += 2;
                            } else if (type === 'number') {
                                // Handle single numeric value
                                sql += ` AND (si.metadata->'attributes'->>$${index})::numeric ${op} $${index + 1}::numeric`;
                                queryParams.push(attrCode, val);
                                index += 2;
                            } else {
                                // Default text comparison
                                sql += ` AND si.metadata->'attributes'->>$${index} ${op} $${index + 1}`;
                                queryParams.push(attrCode, val);
                                index += 2;
                            }
                            continue;
                        }

                        // Handle NLQ patterns (e.g., _nlq_under_1000)
                        if (clauseName.startsWith('_nlq_')) {
                            const nlqParts = clauseName.split('_');
                            const opWord = nlqParts[2];
                            const val = nlqParts[3];
                            const opPhrases = { 'under': '<', 'below': '<', 'over': '>', 'above': '>', 'exactly': '=', 'min': '>=', 'max': '<=' };
                            const op = opPhrases[opWord] || '=';

                            if (type === 'number') {
                                sql += ` AND (si.metadata->'attributes'->>$${index})::numeric ${op} $${index + 1}::numeric`;
                                queryParams.push(attrCode, val);
                                index += 2;
                            } else {
                                sql += ` AND si.metadata->'attributes'->>$${index} ${op} $${index + 1}`;
                                queryParams.push(attrCode, val);
                                index += 2;
                            }
                            continue;
                        }
                    }
                    // If a clause was specified but not found in the defined clauses,
                    // treat the clauseName as the literal value to match (fallback/default)
                    const val = clauseName;
                    sql += ` AND si.metadata->'attributes'->>$${index} = $${index + 1}`;
                    queryParams.push(attrCode, val);
                    index += 2;
                    continue;
                }

                // Default: Exact match (only if no :clause was specified)
                const isArray = Array.isArray(filterValue) || (typeof filterValue === 'string' && filterValue.includes(','));
                const val = Array.isArray(filterValue) ? filterValue : (typeof filterValue === 'string' && filterValue.includes(',') ? filterValue.split(',').map(v => v.trim()) : filterValue);

                if (isArray) {
                    sql += ` AND si.metadata->'attributes'->>$${index} = ANY($${index + 1})`;
                } else {
                    sql += ` AND si.metadata->'attributes'->>$${index} = $${index + 1}`;
                }
                queryParams.push(attrCode, val);
                index += 2;
            }
        }

        return { sql, nextIndex: index };
    }

    /**
     * Build sort SQL
     * @param {string} sort - 'relevance', 'price_asc', 'price_desc', 'date_desc', 'date_asc'
     * @returns {string}
     */
    buildSortSQL(sort) {
        switch (sort) {
            case 'price_asc':
                return ` ORDER BY (si.metadata->>'price')::numeric ASC, rank DESC`;
            case 'price_desc':
                return ` ORDER BY (si.metadata->>'price')::numeric DESC, rank DESC`;
            case 'date_desc':
                return ` ORDER BY si.created_at DESC, rank DESC`;
            case 'date_asc':
                return ` ORDER BY si.created_at ASC, rank DESC`;
            case 'relevance':
            default:
                return ` ORDER BY rank DESC, si.created_at DESC`;
        }
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
            const allCategoryIds = await this.getDescendantCategoryIds(tenantId, currentFilters.category_id);
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
        const filterSQL = await this.buildFilterSQL(tenantId, currentFilters, queryParams, paramIndex);
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
            // Fetch ALL valid attributes for these categories (including inheritance, filtered by is_ignored)
            // For simplicity, we'll use the first category in the list as the primary context
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

    /**
     * Preprocess query for Natural Language patterns
     * @param {string} tenantId
     * @param {string} searchQuery
     * @param {string} categoryId - Optional current category context
     * @returns {Object} - { processedQuery, additionalFilters }
     */
    async preprocessQuery(tenantId, searchQuery, categoryId = null) {
        if (!searchQuery) return { processedQuery: null, additionalFilters: {} };

        const additionalFilters = {};
        let processedQuery = searchQuery;

        // 1. Fetch all attributes with clauses for this tenant
        const attrRes = await query(
            `SELECT code, label, clauses, type FROM attributes WHERE tenant_id = $1`,
            [tenantId]
        );
        const attributes = attrRes.rows;

        // 2. Pattern Matching for numeric attributes (e.g., "price under 1000", "storage above 128")
        // We look for: [Attribute Label/Code] + [Operator Word] + [Number]
        const opPhrases = {
            'under': '<',
            'below': '<',
            'over': '>',
            'above': '>',
            'exactly': '=',
            'min': '>=',
            'max': '<='
        };

        for (const attr of attributes) {
            const label = (attr.label || '').toLowerCase();
            const code = attr.code.toLowerCase();

            // Try to find phrases like "storage under 500" or "price above 1000"
            const regex = new RegExp(`\\b(${label}|${code})\\s+(under|below|over|above|exactly|min|max)\\s+(\\$?)(\\d+)\\b`, 'i');
            const match = processedQuery.match(regex);

            if (match) {
                const operatorWord = match[2].toLowerCase();
                const value = match[4];
                const op = opPhrases[operatorWord];

                // If this match corresponds to a specific clause, use it
                const clause = (attr.clauses || []).find(c => {
                    if (c.operator === op && c.value === value) {
                        // Check exclusions
                        if (categoryId && c.excluded_category_ids && c.excluded_category_ids.includes(categoryId)) {
                            return false;
                        }
                        return true;
                    }
                    return false;
                });

                if (clause) {
                    additionalFilters[`attribute.${attr.code}:${clause.name}`] = value;
                } else {
                    // Fallback: Use manual price filter or generic attribute filter if type matches
                    if (attr.code === 'price') {
                        if (op === '<') additionalFilters['price_max'] = value;
                        if (op === '>') additionalFilters['price_min'] = value;
                    } else if (attr.type === 'number') {
                        // Note: Our current buildFilterSQL works on specific clauses or exact matches
                        // For generic NLQ operators we might need a dynamic clause or a special syntax
                        // For now, let's treat these as "Anonymous Clauses" if they match an operator
                        additionalFilters[`attribute.${attr.code}:_nlq_${operatorWord}_${value}`] = value;
                        // We'll need to update buildFilterSQL to handle these _nlq_ patterns or just add a temporary clause
                    }
                }

                processedQuery = processedQuery.replace(match[0], '').trim();
            }

            // 3. Match Clause Labels or Branded Phrases directly
            for (const clause of (attr.clauses || [])) {
                const clauseLabel = (clause.label || '').toLowerCase();
                const prefix = (clause.prefix || '').trim().toLowerCase();
                const suffix = (clause.suffix || '').trim().toLowerCase();

                const phrases = [];
                if (clauseLabel) phrases.push(clauseLabel);
                if (prefix) phrases.push(prefix);
                if (suffix) phrases.push(suffix);
                if (prefix && suffix) phrases.push(`${prefix} ${suffix}`);

                for (const phrase of phrases) {
                    if (phrase && processedQuery.toLowerCase().includes(phrase)) {
                        // Check exclusions
                        if (categoryId && clause.excluded_category_ids && clause.excluded_category_ids.includes(categoryId)) {
                            continue;
                        }

                        additionalFilters[`attribute.${attr.code}:${clause.name}`] = clause.value;

                        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
                        processedQuery = processedQuery.replace(regex, '').trim();
                    }
                }
            }
        }

        // 4. Default Price Patterns (Fallback for when "price" isn't explicitly mentioned)
        const priceUnderMatch = processedQuery.match(/\b(under|below)\s+(\$?)(\d+)\b/i);
        if (priceUnderMatch) {
            additionalFilters['price_max'] = priceUnderMatch[3];
            processedQuery = processedQuery.replace(priceUnderMatch[0], '').trim();
        }

        const priceOverMatch = processedQuery.match(/\b(over|above)\s+(\$?)(\d+)\b/i);
        if (priceOverMatch) {
            additionalFilters['price_min'] = priceOverMatch[3];
            processedQuery = processedQuery.replace(priceOverMatch[0], '').trim();
        }

        return { processedQuery, additionalFilters };
    }

    /**
     * Resolve a category identifier (UUID or slug) to a UUID
     * @param {string} tenantId
     * @param {string} idOrSlug
     * @returns {string} - Category UUID
     */
    async resolveCategoryId(tenantId, idOrSlug) {
        if (!idOrSlug) return null;

        const isUuid = /^[0-9a-fA-F-]{36}$/.test(idOrSlug);
        if (isUuid) return idOrSlug;

        const res = await query(
            `SELECT id FROM categories WHERE slug = $1 AND tenant_id = $2`,
            [idOrSlug, tenantId]
        );

        return res.rows[0]?.id || idOrSlug;
    }

    /**
     * Get all descendant category IDs recursively
     * @param {string} tenantId
     * @param {string} categoryId
     * @returns {Promise<Array>}
     */
    async getDescendantCategoryIds(tenantId, categoryId) {
        try {
            const sql = `
                WITH RECURSIVE category_tree AS (
                    SELECT id FROM categories WHERE id = $1 AND tenant_id = $2
                    UNION ALL
                    SELECT c.id FROM categories c
                    INNER JOIN category_tree ct ON c.parent_id = ct.id
                    WHERE c.tenant_id = $2
                )
                SELECT id FROM category_tree;
            `;

            const result = await query(sql, [categoryId, tenantId]);
            return result.rows.map(r => r.id);
        } catch (error) {
            console.error('[SearchService] Error fetching recursive categories:', error);
            return [categoryId]; // Fallback to just the current category
        }
    }
    /**
     * Resolve a branded slug (e.g., "best-iphones-under-5000") into Category + Clause
     * @param {string} tenantId
     * @param {string} slug
     * @returns {Promise<Object|null>}
     */
    async resolveBrandedSlug(tenantId, slug) {
        // Utility for slugifying
        const slugify = (text) => (text || '')
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, '')
            .replace(/--+/g, '-');

        // 1. Fetch all attributes with clauses
        const attrRes = await query(
            `SELECT id, code, label, clauses FROM attributes WHERE tenant_id = $1`,
            [tenantId]
        );
        const attributes = attrRes.rows;

        // 2. Fetch all active categories
        const catRes = await query(
            `SELECT id, name, slug, image_url, description FROM categories WHERE tenant_id = $1 AND is_active = true`,
            [tenantId]
        );
        const categories = catRes.rows;

        // 3. Iterate and match
        for (const attr of attributes) {
            const clauses = attr.clauses || [];
            for (const clause of clauses) {
                const prefix = clause.prefix || '';
                const suffix = clause.suffix || '';

                // Try matching against every category
                for (const cat of categories) {
                    const brandedString = `${prefix}${cat.slug}${suffix}`;
                    const targetSlug = slugify(brandedString);

                    if (targetSlug === slug) {
                        const resolution = {
                            category: cat,
                            attribute: {
                                id: attr.id,
                                code: attr.code,
                                label: attr.label
                            },
                            clause: clause,
                            filter: `attribute.${attr.code}:${clause.name}`
                        };

                        // Add SEO metadata
                        resolution.seo = generateBrandedSEO(cat, resolution.attribute, clause);

                        return resolution;
                    }
                }
            }
        }

        return null;
    }
}

module.exports = SearchService;
