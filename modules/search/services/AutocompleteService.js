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

        const normalizedQuery = partialQuery.toLowerCase().trim();
        const terms = normalizedQuery.split(/\s+/).filter(t => t.length >= 2);
        const searchTerm = `%${normalizedQuery}%`;

        // Prepare plural/singular tokens for flexible matching
        const singularize = (t) => t.replace(/(es|s)$/, '');
        const pluralize = (t) => {
            if (t.endsWith('s')) return t;
            if (t.endsWith('y')) return t.slice(0, -1) + 'ies';
            return t + 's';
        };

        const singularTokens = terms.map(t => singularize(t));
        const pluralTokens = terms.map(t => pluralize(t));

        // 1. Get Direct Content/Title suggestions (Products, Pages, etc.)
        const contentSQL = `
            SELECT 
                title as suggestion, 
                'content' as type,
                content_type,
                content_id,
                metadata
            FROM search_indexes
            WHERE tenant_id = $1
            AND is_active = true
            AND (
                -- Must match ALL tokens in the query
                NOT EXISTS (
                    SELECT 1 FROM unnest($5::text[], $6::text[]) as t(s_token, p_token)
                    WHERE NOT (
                        LOWER(title) LIKE '%' || s_token || '%' 
                        OR LOWER(title) LIKE '%' || p_token || '%'
                        OR content ILIKE '%' || s_token || '%'
                        OR content ILIKE '%' || p_token || '%'
                        OR EXISTS (
                            SELECT 1 FROM unnest(keywords) k 
                            WHERE k ILIKE '%' || s_token || '%' OR k ILIKE '%' || p_token || '%'
                        )
                        OR (
                            metadata ? 'attributes' AND EXISTS (
                                SELECT 1 FROM jsonb_each_text(metadata->'attributes') as attr(key, val)
                                WHERE val ILIKE '%' || s_token || '%' OR val ILIKE '%' || p_token || '%'
                            )
                        )
                    )
                )
            )
            ORDER BY 
                CASE 
                    WHEN LOWER(title) = $2 THEN 1
                    WHEN LOWER(title) LIKE $2 || '%' THEN 2
                    ELSE 3
                END,
                title
            LIMIT $3
            OFFSET $4
        `;

        const contentResults = await query(contentSQL, [
            tenantId,
            normalizedQuery,
            Math.ceil(limit * 0.4),
            0, // offset
            singularTokens,
            pluralTokens
        ]);

        // 2. Intelligent Navigation Suggestions
        // Logic: We split terms to allow "apple laptop" to match category "Laptop" + brand "Apple"
        const brandingSQL = `
            WITH RECURSIVE
            -- 1. Split query into tokens for flexible matching
            query_tokens AS (
                SELECT unnest($6::text[]) as token
            ),
            -- 2. Direct Category Matches (Matches any part of the query)
            matched_cats AS (
                SELECT id, name, slug, parent_id, image_url,
                       -- Count how many query tokens match the category name
                       (SELECT count(*) FROM query_tokens WHERE name ILIKE '%' || token || '%') as match_count
                FROM categories
                WHERE tenant_id = $1 AND is_active = true
                AND (
                    name ILIKE $2 OR name ILIKE $3 
                    OR EXISTS (SELECT 1 FROM query_tokens WHERE name ILIKE '%' || token || '%')
                )
            ),
            -- 3. Attribute inheritance mapping
            effective_attrs AS (
                SELECT category_id, attribute_id, tenant_id FROM category_attributes WHERE tenant_id = $1
                UNION ALL
                SELECT h.id, ea.attribute_id, h.tenant_id
                FROM categories h
                JOIN effective_attrs ea ON h.parent_id = ea.category_id
                WHERE h.tenant_id = ea.tenant_id
            ),
            -- 4. Clause Matches
            matched_clauses AS (
                SELECT 
                    a.id as attr_id, a.code as attr_code, a.label as attr_label,
                    cl->>'name' as cl_name, cl->>'label' as cl_label,
                    cl->>'prefix' as cl_prefix, cl->>'suffix' as cl_suffix,
                    cl->>'value' as cl_value,
                    cl->'excluded_category_ids' as cl_excluded_ids,
                    cl->'value' as cl_value_json,
                    a.image_url as attr_image,
                    -- Explicit matching: brand/clause specifically mentioned
                    (
                        cl->>'label' ILIKE $2 OR cl->>'label' ILIKE $3 
                        OR cl->>'prefix' ILIKE $2 OR cl->>'prefix' ILIKE $3
                        OR cl->>'suffix' ILIKE $2 OR cl->>'suffix' ILIKE $3
                        OR EXISTS (SELECT 1 FROM query_tokens WHERE cl->>'label' ILIKE '%' || token || '%' OR cl->>'prefix' ILIKE '%' || token || '%' OR cl->>'suffix' ILIKE '%' || token || '%')
                    ) as is_explicit_value_match,
                    -- Soft matching: attribute name (e.g. typing "brand") mentioned
                    (a.label ILIKE $2 OR a.code ILIKE $2) as is_attribute_name_match,
                    -- Intersection scoring: did this match part of the query?
                    (SELECT count(*) FROM query_tokens WHERE cl->>'label' ILIKE '%' || token || '%' OR cl->>'prefix' ILIKE '%' || token || '%' OR cl->>'suffix' ILIKE '%' || token || '%') as val_match_count
                FROM attributes a
                CROSS JOIN LATERAL jsonb_array_elements(a.clauses) cl
                WHERE a.tenant_id = $1
                AND (
                    a.label ILIKE $2 OR cl->>'label' ILIKE $2 OR a.code ILIKE $2 OR cl->>'name' ILIKE $2
                    OR cl->>'prefix' ILIKE $2 OR cl->>'suffix' ILIKE $2
                    OR EXISTS (SELECT 1 FROM query_tokens WHERE cl->>'label' ILIKE '%' || token || '%' OR a.label ILIKE '%' || token || '%' OR cl->>'prefix' ILIKE '%' || token || '%' OR cl->>'suffix' ILIKE '%' || token || '%')
                )
            ),
            -- 5. Final Rankings
            final_pool AS (
                -- TIER 0: Full Phrases (e.g. "Smartphones")
                SELECT 
                    id as cat_id, name as cat_name, slug as cat_slug, image_url as cat_image,
                    NULL as attr_code, NULL as attr_label, NULL as cl_name, NULL as cl_label,
                    NULL as cl_prefix, NULL as cl_suffix, NULL as cl_value,
                    0 as priority
                FROM matched_cats mc
                WHERE mc.name ILIKE $2 OR mc.name ILIKE $3

                UNION ALL

                -- TIER 1: Raw Filter (e.g. "Brand: Apple")
                SELECT 
                    NULL as cat_id, NULL as cat_name, NULL as cat_slug, mc.attr_image as cat_image,
                    mc.attr_code, mc.attr_label, mc.cl_name, mc.cl_label,
                    mc.cl_prefix, mc.cl_suffix, mc.cl_value,
                    1 as priority
                FROM matched_clauses mc
                WHERE mc.cl_label ILIKE $2 OR mc.cl_label ILIKE $3
                   OR mc.cl_prefix ILIKE $2 OR mc.cl_prefix ILIKE $3
                   OR mc.cl_suffix ILIKE $2 OR mc.cl_suffix ILIKE $3

                UNION ALL
                
                -- TIER 2: Branded Intersection (e.g. "Apple Laptop")
                -- We show this if category name AND brand/clause name both have matches in the tokens
                SELECT 
                    mc.id, mc.name, mc.slug, mc.image_url,
                    ma.attr_code, ma.attr_label, ma.cl_name, ma.cl_label,
                    ma.cl_prefix, ma.cl_suffix, ma.cl_value,
                    2 as priority
                FROM matched_cats mc
                JOIN effective_attrs ea ON ea.category_id = mc.id
                JOIN matched_clauses ma ON ma.attr_id = ea.attribute_id
                WHERE (mc.match_count > 0 AND ma.val_match_count > 0) -- HIT BOTH!
                AND (ma.cl_excluded_ids IS NULL OR NOT (ma.cl_excluded_ids @> jsonb_build_array(mc.id::text)))

                UNION ALL
                
                -- TIER 3: Branded Drift (Brand-only search suggested in related categories)
                -- ANTI-EXPLOSION: Capped to Top 5 that have CONFIRMED product matches
                SELECT 
                    c.id, c.name, c.slug, c.image_url,
                    ma.attr_code, ma.attr_label,
                    ma.cl_name, ma.cl_label,
                    ma.cl_prefix, ma.cl_suffix,
                    ma.cl_value,
                    3 as priority
                FROM matched_clauses ma
                JOIN effective_attrs ea ON ea.attribute_id = ma.attr_id
                JOIN categories c ON ea.category_id = c.id
                WHERE c.is_active = true 
                AND ma.is_explicit_value_match = true
                AND (ma.cl_excluded_ids IS NULL OR NOT (ma.cl_excluded_ids @> jsonb_build_array(c.id::text)))
                -- PRODUCT MATCH REQUIRED (using search_indexes):
                AND EXISTS (
                    SELECT 1 FROM search_indexes si
                    WHERE si.tenant_id = $1
                    AND si.is_active = true
                    AND si.content_type = 'product'
                    AND si.metadata->'category_ids' ? c.id::text
                    AND (
                        CASE 
                            WHEN jsonb_typeof(ma.cl_value_json) = 'array' 
                            THEN si.metadata->'attributes'->>ma.attr_code = ANY(
                                SELECT jsonb_array_elements_text(ma.cl_value_json)
                            )
                            ELSE si.metadata->'attributes'->>ma.attr_code = (ma.cl_value_json #>> '{}')
                        END
                    )
                    LIMIT 1
                )
                -- Avoid redundancy with Tier 2
                AND NOT ( (SELECT count(*) FROM query_tokens WHERE c.name ILIKE '%' || token || '%') > 0 AND ma.val_match_count > 0 )
            )
            SELECT * FROM (
                SELECT DISTINCT ON (priority, cat_name, attr_code, cl_name)
                    cat_id, cat_name, cat_slug, cat_image, attr_code, attr_label, cl_name, cl_label, cl_prefix, cl_suffix, cl_value, priority
                FROM final_pool
                ORDER BY priority ASC, cat_name, attr_code, cl_name
            ) sub
            ORDER BY priority ASC, 
                     CASE WHEN LOWER(cat_name) = $4 THEN 1 ELSE 2 END,
                     cat_name ASC, 
                     cl_label ASC
            LIMIT $5
        `;

        const brandingRes = await query(brandingSQL, [
            tenantId,
            searchTerm,
            `%${normalizedQuery.replace(/(es|s)$/, '')}%`,
            normalizedQuery,
            Math.max(limit, 20),
            terms
        ]);

        const suggestions = [];
        const seen = new Set();

        const addSuggestion = (item) => {
            const textKey = (item.text || '').toLowerCase().trim();
            if (textKey && !seen.has(textKey) && suggestions.length < limit) {
                seen.add(textKey);
                suggestions.push(item);
                return true;
            }
            return false;
        };

        // STEP 1: Navigation
        brandingRes.rows.forEach(item => {
            let suggestionText = '';
            let type = 'category';
            let filter = `category_id=${item.cat_id}`;

            if (item.cat_id && item.cl_name) {
                const prefix = item.cl_prefix ? `${item.cl_prefix.trim()} ` : '';
                const suffix = item.cl_suffix ? ` ${item.cl_suffix.trim()}` : '';
                suggestionText = `${prefix}${item.cat_name}${suffix}`.trim();
                type = 'clause';
                filter = `category_id=${item.cat_id}&attribute.${item.attr_code}:${item.cl_name}=${item.cl_value || 1}`;
            } else if (item.cl_name) {
                suggestionText = `${item.attr_label}: ${item.cl_label || item.cl_name}`;
                type = 'filter';
                filter = `attribute.${item.attr_code}:${item.cl_name}=${item.cl_value || 1}`;
            } else {
                suggestionText = item.cat_name;
                type = 'category';
            }

            const slugify = (text) => (text || '').toString().toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-');
            const prettySlug = (item.cat_id && item.cl_name)
                ? slugify((item.cl_prefix || '') + (item.cat_slug || '') + (item.cl_suffix || ''))
                : (item.cat_id ? item.cat_slug : null);

            addSuggestion({
                text: suggestionText,
                type: type,
                image_url: item.cat_image,
                category_id: item.cat_id,
                category_slug: item.cat_slug,
                attribute: item.attr_code,
                clause: item.cl_name,
                slug: prettySlug,
                filter: filter
            });
        });

        // STEP 2: Products
        contentResults.rows.forEach(item => {
            addSuggestion({
                text: item.suggestion,
                type: 'content',
                content_type: item.content_type,
                id: item.content_id, // Standardize ID field
                content_id: item.content_id,
                image_url: item.metadata?.image_url || null,
                price: item.metadata?.price || null,
                handle: item.metadata?.handle || null,
                slug: item.metadata?.slug || null
            });
        });

        return suggestions;
    }

    async getPopularSearches(tenantId, limit = 10) {
        const sql = `SELECT query FROM search_analytics WHERE tenant_id = $1 AND has_results = true GROUP BY query ORDER BY COUNT(*) DESC LIMIT $2`;
        const res = await query(sql, [tenantId, limit]);
        return res.rows;
    }

    async getTrendingSearches(tenantId, limit = 10) {
        const sql = `SELECT query FROM search_analytics WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '7 days' GROUP BY query ORDER BY COUNT(*) DESC LIMIT $2`;
        const res = await query(sql, [tenantId, limit]);
        return res.rows;
    }
}

module.exports = AutocompleteService;
