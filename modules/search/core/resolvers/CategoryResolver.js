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

    /**
     * Resolve the deepest single child in a branch.
     * Enhanced: Only considers children that actually contain products in the search index.
     * If category A has children [B, C, D] but only B has products, it drills into B.
     * @param {string} tenantId
     * @param {string} categoryId
     * @returns {Promise<string>} - The deepest single viable child ID
     */
    async resolveDeepestSingleChild(tenantId, categoryId) {
        let currentId = categoryId;

        while (true) {
            // First, check if the current category itself has products directly assigned to it.
            // If it does, don't auto-drill — the user is browsing a category with its own products.
            const directProducts = await query(
                `SELECT 1 FROM search_indexes si
                 WHERE si.tenant_id = $1 AND si.is_active = true
                 AND si.content_type = 'product'
                 AND si.metadata->'category_ids' ? $2::text
                 AND NOT EXISTS (
                    SELECT 1 FROM categories c
                    WHERE c.tenant_id = $1 AND c.parent_id = $2::uuid AND c.is_active = true
                    AND si.metadata->'category_ids' ? c.id::text
                 )
                 LIMIT 1`,
                [tenantId, currentId]
            );

            if (directProducts.rows.length > 0) {
                // This category has products assigned directly to it (not just in children), stop here.
                break;
            }

            // Find children that actually have products in the index (directly or in descendants)
            // We use the search_indexes as the source of truth for "active" products
            const result = await query(
                `SELECT c.id FROM categories c
                 WHERE c.tenant_id = $1 AND c.parent_id = $2 AND c.is_active = true
                 AND EXISTS (
                    SELECT 1 FROM search_indexes si 
                    WHERE si.tenant_id = $1 AND si.is_active = true 
                    AND si.metadata->'category_ids' ? c.id::text
                 )`,
                [tenantId, currentId]
            );

            if (result.rows.length === 1) {
                // If there's exactly one subcategory with products, drill down.
                // This ensures that "Smart Phones & Tablets" (where Tablets is empty) 
                // will automatically land the user on "Smart Phones".
                currentId = result.rows[0].id;
            } else {
                // If it has 0 categories with products, or multiple "viable" branches, we stop.
                break;
            }
        }
        return currentId;
    }
}

module.exports = CategoryResolver;
