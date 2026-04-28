/**
 * Slug Resolver
 * Handles branded slug resolution (e.g., "best-iphones-under-5000")
 */

const { query } = require('../../../../config/database');
const { generateBrandedSEO } = require('../../../../lib/seoHelpers');
const ClauseImageCache = require('../../services/ClauseImageCache');

class SlugResolver {
    /**
     * Utility for slugifying text
     * @param {string} text
     * @returns {string}
     */
    slugify(text) {
        return (text || '')
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, '')
            .replace(/--+/g, '-');
    }

    /**
     * Resolve a branded slug (e.g., "best-iphones-under-5000") into Category + Clause
     * @param {string} tenantId
     * @param {string} slug
     * @returns {Promise<Object|null>}
     */
    async resolveBrandedSlug(tenantId, slug) {
        // Fetch all attributes with clauses
        const attrsRes = await query(
            `SELECT id, code, label, type, clauses FROM attributes WHERE tenant_id = $1 AND clauses IS NOT NULL`,
            [tenantId]
        );

        // Fetch all categories (include description for SEO fallback)
        const catsRes = await query(
            `SELECT id, name, slug, image_url, description, meta_description FROM categories WHERE tenant_id = $1 AND is_active = true`,
            [tenantId]
        );

        // Try to match slug against all possible combinations
        for (const attr of attrsRes.rows) {
            const clauses = (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : attr.clauses) || [];

            for (const clause of clauses) {
                const prefix = (clause.prefix || '').trim();
                const suffix = (clause.suffix || '').trim();

                for (const cat of catsRes.rows) {
                    const generatedSlug = this.slugify(`${prefix}${cat.slug || ''}${suffix}`);

                    if (generatedSlug === slug) {
                        // Match found!
                        const title = (prefix || suffix)
                            ? `${prefix ? `${prefix} ` : ''}${cat.name}${suffix ? ` ${suffix}` : ''}`.trim()
                            : (clause.label || clause.name);

                        const filterKey = `attribute.${attr.code}:${clause.name}`;
                        const filterValue = clause.value ?? 1;

                        const normalizedClause = {
                            ...clause,
                            name: clause.name || '',
                            label: clause.label || clause.name || '',
                            prefix: prefix || '',
                            suffix: suffix || '',
                            value: clause.value,
                            operator: clause.operator || '='
                        };

                        // Resolve cached product image for this clause/category pair
                        const clauseValue = Array.isArray(clause.value) ? clause.value[0] : (clause.value ?? '1');
                        const cachedImage = await ClauseImageCache.getClauseImage(
                            tenantId, cat.id, attr.code, clauseValue, clause.operator || '='
                        );

                        const seo = generateBrandedSEO(
                            cat,
                            attr,
                            normalizedClause,
                            '', // baseUrl
                            cachedImage // cached product image → OG image
                        );

                        return {
                            category: cat,
                            attribute: { id: attr.id, code: attr.code, label: attr.label, type: attr.type },
                            clause,
                            title,
                            filter: `category_id=${cat.id}&${filterKey}=${encodeURIComponent(String(filterValue))}`,
                            seo
                        };
                    }
                }
            }
        }

        return null; // No match found
    }
}

module.exports = SlugResolver;
