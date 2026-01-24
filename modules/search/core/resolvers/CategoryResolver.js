/**
 * Category Resolver
 * Handles category ID resolution and descendant tree traversal
 */

const { query } = require('../../../../config/database');

class CategoryResolver {
    /**
     * Resolve a category identifier (UUID or slug) to a UUID
     * @param {string} tenantId
     * @param {string} idOrSlug
     * @returns {string} - Category UUID
     */
    async resolveCategoryId(tenantId, idOrSlug) {
        // Check if it's already a UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(idOrSlug)) {
            return idOrSlug;
        }

        // Otherwise, treat as slug and resolve
        const result = await query(
            `SELECT id FROM categories WHERE tenant_id = $1 AND slug = $2`,
            [tenantId, idOrSlug]
        );

        if (result.rows.length === 0) {
            throw new Error(`Category with slug '${idOrSlug}' not found`);
        }

        return result.rows[0].id;
    }

    /**
     * Get all descendant category IDs recursively
     * @param {string} tenantId
     * @param {string} categoryId
     * @returns {Promise<Array>}
     */
    async getDescendantCategoryIds(tenantId, categoryId) {
        const sql = `
            WITH RECURSIVE descendant_categories AS (
                SELECT id FROM categories 
                WHERE id = $1 AND tenant_id = $2
                UNION ALL
                SELECT c.id FROM categories c
                INNER JOIN descendant_categories dc ON c.parent_id = dc.id
                WHERE c.tenant_id = $2
            )
            SELECT id FROM descendant_categories
        `;

        const result = await query(sql, [categoryId, tenantId]);
        return result.rows.map(row => row.id);
    }
}

module.exports = CategoryResolver;
