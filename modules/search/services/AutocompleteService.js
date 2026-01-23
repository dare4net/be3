/**
 * Autocomplete Service
 * Provides search suggestions and autocomplete
 */

const { query } = require('../../../config/database');

class AutocompleteService {
    /**
     * Get autocomplete suggestions
     * @param {string} tenantId
     * @param {string} partialQuery - Partial search query
     * @param {number} limit - Max number of suggestions
     * @returns {Array}
     */
    async getSuggestions(tenantId, partialQuery, limit = 10) {
        if (!partialQuery || partialQuery.trim().length < 2) {
            return [];
        }

        const searchTerm = `%${partialQuery.toLowerCase()}%`;

        // Get suggestions from indexed content titles
        // Use GROUP BY to get distinct titles, then sort
        const contentSQL = `
            SELECT 
                title as suggestion, 
                'content' as type,
                (array_agg(content_type))[1] as content_type,
                (array_agg(content_id))[1] as content_id,
                (jsonb_agg(metadata))->0 as metadata
            FROM search_indexes
            WHERE tenant_id = $1
            AND is_active = true
            AND (
                LOWER(title) LIKE $2
                OR EXISTS (
                    SELECT 1 FROM unnest(keywords) AS keyword
                    WHERE LOWER(keyword) LIKE $2
                )
            )
            GROUP BY title
            ORDER BY 
                CASE 
                    WHEN LOWER(title) = LOWER($3) THEN 1
                    WHEN LOWER(title) LIKE LOWER($3) || '%' THEN 2
                    ELSE 3
                END,
                title
            LIMIT $4
        `;

        const contentResults = await query(contentSQL, [
            tenantId,
            searchTerm,
            partialQuery.toLowerCase(),
            Math.ceil(limit * 0.7) // 70% from content
        ]);

        // Get suggestions from clauses
        const clauseSQL = `
            SELECT 
                a.label as attr_label,
                c->>'label' as clause_label,
                c->>'name' as clause_name,
                c->>'prefix' as clause_prefix,
                c->>'suffix' as clause_suffix,
                c->>'value' as clause_value,
                a.code as attr_code,
                a.type as attr_type
            FROM attributes a, jsonb_array_elements(a.clauses) c
            WHERE a.tenant_id = $1
            AND (
                a.label ILIKE $2 
                OR c->>'label' ILIKE $2
                OR a.code ILIKE $2
                OR c->>'name' ILIKE $2
            )
            LIMIT $3
        `;

        const clauseResults = await query(clauseSQL, [
            tenantId,
            searchTerm,
            Math.ceil(limit * 0.2) // 20% from clauses
        ]);

        const querySQL = `
            SELECT 
                query as suggestion, 
                'query' as type,
                NULL::UUID as content_id,
                NULL::VARCHAR as content_type,
                COUNT(*) as usage_count
            FROM search_analytics
            WHERE tenant_id = $1
            AND query ILIKE $2
            AND has_results = true
            AND created_at > NOW() - INTERVAL '30 days'
            GROUP BY query
            ORDER BY usage_count DESC
            LIMIT $3
        `;

        const queryResults = await query(querySQL, [
            tenantId,
            searchTerm,
            Math.ceil(limit * 0.2) // 20% from popular queries
        ]);

        const suggestions = [];
        const seen = new Set();

        const brandingSQL = `
            WITH RECURSIVE
            -- 1. All categories that match the name + their descendants
            matched_cats AS (
                SELECT id, name, slug, parent_id
                FROM categories
                WHERE tenant_id = $1 AND name ILIKE $2 AND is_active = true
                -- Limits total matched categories to 3 to keep suggestions manageable
                LIMIT 3
            ),
            cat_descendants AS (
                SELECT id, name, slug, parent_id FROM matched_cats
                UNION ALL
                SELECT c.id, c.name, c.slug, c.parent_id
                FROM categories c
                JOIN cat_descendants cd ON c.parent_id = cd.id
                WHERE c.tenant_id = $1 AND c.is_active = true
            ),
            -- 2. Attribute inheritance mapping (Top-Down)
            effective_attrs AS (
                -- Anchor: Direct links
                SELECT category_id, attribute_id, tenant_id FROM category_attributes WHERE tenant_id = $1
                UNION ALL
                -- Recursive: Inherit from parent
                SELECT h.id, ea.attribute_id, h.tenant_id
                FROM categories h
                JOIN effective_attrs ea ON h.parent_id = ea.category_id
                WHERE h.tenant_id = ea.tenant_id
            ),
            -- 3. Filtered Attributes/Clauses matching the query
            matched_attributes AS (
                SELECT 
                    a.id as attr_id, a.code as attr_code, a.label as attr_label,
                    cl->>'name' as cl_name, cl->>'label' as cl_label,
                    cl->>'prefix' as cl_prefix, cl->>'suffix' as cl_suffix,
                    cl->>'value' as cl_value,
                    cl->'excluded_category_ids' as cl_excluded_ids
                FROM attributes a
                CROSS JOIN LATERAL jsonb_array_elements(a.clauses) cl
                WHERE a.tenant_id = $1
                AND (
                    a.label ILIKE $2 OR cl->>'label' ILIKE $2 OR a.code ILIKE $2 OR cl->>'name' ILIKE $2
                    OR cl->>'prefix' ILIKE $2 OR cl->>'suffix' ILIKE $2
                )
            ),
            -- 4. Combine everything for final suggestions
            final_pool AS (
                -- Case A: Categories in a matched branch + their inherited attributes
                SELECT 
                    cd.id as cat_id, cd.name as cat_name, cd.slug as cat_slug,
                    a.code as attr_code, a.label as attr_label,
                    cl->>'name' as cl_name, cl->>'label' as cl_label,
                    cl->>'prefix' as cl_prefix, cl->>'suffix' as cl_suffix,
                    cl->>'value' as cl_value,
                    1 as priority -- Category branch match is highest priority
                FROM cat_descendants cd
                JOIN effective_attrs ea ON ea.category_id = cd.id
                JOIN attributes a ON a.id = ea.attribute_id
                CROSS JOIN LATERAL jsonb_array_elements(a.clauses) cl
                WHERE NOT (cl->'excluded_category_ids' @> jsonb_build_array(cd.id::text))
                OR cl->'excluded_category_ids' IS NULL
                
                UNION ALL
                
                -- Case B: Matched attribute/clause + categories that have them (direct or inherited)
                SELECT 
                    c.id as cat_id, c.name as cat_name, c.slug as cat_slug,
                    ma.attr_code, ma.attr_label,
                    ma.cl_name, ma.cl_label,
                    ma.cl_prefix, ma.cl_suffix,
                    ma.cl_value,
                    2 as priority -- Attribute match find relevant categories
                FROM matched_attributes ma
                JOIN effective_attrs ea ON ea.attribute_id = ma.attr_id
                JOIN categories c ON ea.category_id = c.id
                WHERE c.is_active = true
                AND (
                    ma.cl_excluded_ids IS NULL 
                    OR NOT (ma.cl_excluded_ids @> jsonb_build_array(c.id::text))
                )
            )
            SELECT DISTINCT ON (cat_id, attr_code, cl_name)
                cat_id, cat_name, cat_slug, attr_code, cl_name, cl_prefix, cl_suffix, cl_value, priority
            FROM final_pool
            ORDER BY cat_id, attr_code, cl_name, priority ASC
            LIMIT $3
        `;

        const brandingRes = await query(brandingSQL, [tenantId, searchTerm, Math.max(limit, 15)]);

        brandingRes.rows.forEach(item => {
            const prefix = item.cl_prefix ? `${item.cl_prefix.trim()} ` : '';
            const suffix = item.cl_suffix ? ` ${item.cl_suffix.trim()}` : '';
            const suggestionText = `${prefix}${item.cat_name}${suffix}`.trim();

            // Generate pretty slug
            const slugify = (text) => (text || '').toString().toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-');
            const prettySlug = slugify((item.cl_prefix || '') + (item.cat_slug || '') + (item.cl_suffix || ''));

            const key = suggestionText.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                suggestions.push({
                    text: suggestionText,
                    type: 'clause',
                    attribute: item.attr_code,
                    clause: item.cl_name,
                    slug: prettySlug,
                    filter: `category_id=${item.cat_id}&attribute.${item.attr_code}:${item.cl_name}=${item.cl_value || 1}`
                });
            }
        });

        // 2. Direct Clause Fallback (Legacy formatting for clauses that didn't get branded)
        clauseResults.rows.forEach(item => {
            const suggestionText = `${item.attr_label}: ${item.clause_label}`;
            const key = suggestionText.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                suggestions.push({
                    text: suggestionText,
                    type: 'clause',
                    attribute: item.attr_code,
                    clause: item.clause_name,
                    filter: `attribute.${item.attr_code}:${item.clause_name}=${item.clause_value || 1}`
                });
            }
        });

        // 3. Process Content and Query suggestions
        [...contentResults.rows, ...queryResults.rows].forEach(item => {
            const suggestionText = item.suggestion || '';
            const key = suggestionText.toLowerCase();
            if (!seen.has(key) && suggestions.length < limit) {
                seen.add(key);
                suggestions.push({
                    text: item.suggestion,
                    type: item.type,
                    content_type: item.content_type,
                    content_id: item.content_id,
                    image_url: item.metadata?.image_url || null,
                    price: item.metadata?.price || null,
                    handle: item.metadata?.handle || null,
                    slug: item.metadata?.slug || null
                });
            }
        });

        return suggestions;
    }

    /**
     * Get popular searches
     * @param {string} tenantId
     * @param {number} limit
     * @returns {Array}
     */
    async getPopularSearches(tenantId, limit = 10) {
        const sql = `
            SELECT 
                query,
                COUNT(*) as count,
                AVG(result_count)::int as avg_results
            FROM search_analytics
            WHERE tenant_id = $1
            AND created_at > NOW() - INTERVAL '30 days'
            GROUP BY query
            ORDER BY count DESC
            LIMIT $2
        `;

        const results = await query(sql, [tenantId, limit]);
        return results.rows;
    }

    /**
     * Get trending searches (recent popular queries)
     * @param {string} tenantId
     * @param {number} limit
     * @returns {Array}
     */
    async getTrendingSearches(tenantId, limit = 10) {
        const sql = `
            SELECT 
                query,
                COUNT(*) as count
            FROM search_analytics
            WHERE tenant_id = $1
            AND created_at > NOW() - INTERVAL '7 days'
            GROUP BY query
            ORDER BY count DESC, MAX(created_at) DESC
            LIMIT $2
        `;

        const results = await query(sql, [tenantId, limit]);
        return results.rows;
    }
}

module.exports = AutocompleteService;
