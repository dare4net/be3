/**
 * Product Service
 * Centralized logic for product transformations, vendor isolation, and tag sanitization.
 * 
 * PRINCIPLE: Modules do not import other modules directly
 */

const { query } = require('../../../config/database');

class ProductService {
    /**
     * Resolve dynamic variables in product data (e.g., [BUSINESS_NAME] in tags)
     * @param {string} tenantId 
     * @param {string} userId - ID of the user viewing the products (vendor ID if restricted)
     * @param {object|array} input - Single product or array of products
     */
    static async resolve(tenantId, userId, input) {
        if (!input) return input;
        const products = Array.isArray(input) ? input : [input];

        let VariableRegistry;
        try {
            VariableRegistry = require('../../variables/services/VariableRegistry');
        } catch (e) {
            return input; // Fallback if variables module is missing
        }

        for (const product of products) {
            // 1. Resolve Inheritance (Variant -> Parent merge)
            if (product.parent_id) {
                await ProductService.resolveInheritance(tenantId, product);
            }

            // 2. Resolve Dynamic Variables in Tags
            if (product.tags && product.tags.length > 0) {
                const resolvedTags = [];
                for (const tag of product.tags) {
                    if (tag && tag.includes('[') && tag.includes(']')) {
                        // Use product.created_by as the context for vendor variables
                        const resolved = await VariableRegistry.resolveText(tag, {
                            tenantId: tenantId,
                            userId: product.created_by || userId
                        });
                        resolvedTags.push(resolved);
                    } else {
                        resolvedTags.push(tag);
                    }
                }
                product.tags = resolvedTags;
            }
        }

        return Array.isArray(input) ? products : products[0];
    }

    /**
     * Sanitize product tags before saving.
     * Removes literal vendor names and ensures dynamic variables are used for vendors.
     * 
     * @param {array} tags - The tags to sanitize
     * @param {boolean} isVendor - Whether the creator is a vendor
     * @param {string} vendorName - Current business name of the vendor
     * @returns {array} Sanitized tags
     */
    static sanitizeTags(tags = [], isVendor = false, vendorName = null) {
        if (!isVendor) return tags;

        // 1. Remove literal vendor name to prevent duplicates
        let sanitized = tags.filter(t => t !== vendorName);

        // 2. Ensure dynamic [BUSINESS_NAME] is present
        if (!sanitized.includes('[BUSINESS_NAME]')) {
            sanitized.push('[BUSINESS_NAME]');
        }

        // 3. Prevent duplicate [BUSINESS_NAME] entries
        sanitized = [...new Set(sanitized)];

        return sanitized;
    }

    /**
     * Returns the SQL filter snippet for vendor isolation
     * @param {boolean} isVendor 
     * @param {string} vendorName 
     * @param {string} userId 
     * @param {number} nameParamIndex - Index for vendorName in params
     * @param {number} idParamIndex - Index for userId in params
     * @returns {string} SQL fragment
     */
    static getVendorIsolationFilter(isVendor, vendorName, userId, nameParamIndex, idParamIndex) {
        if (!isVendor) return 'TRUE';

        // We check:
        // 1. Legacy Tags (direct name match)
        // 2. Dynamic Tag (resolved to name match - handled at DB level by checking nameParamIndex)
        // 3. System Attribute (hard match on Name or UUID)
        return `(p.tags @> ARRAY[$${nameParamIndex}]::text[] OR p.attributes->>'vendor' = $${nameParamIndex} OR p.attributes->>'vendor' = $${idParamIndex})`;
    }

    /**
     * Resolve inheritance for variants.
     * Merges parent data into the variant for fields that are null/empty.
     * @param {string} tenantId 
     * @param {object} product 
     */
    static async resolveInheritance(tenantId, product) {
        if (!product || !product.parent_id) return product;

        try {
            const parentRes = await query(`SELECT * FROM products WHERE id = $1 AND tenant_id = $2`, [product.parent_id, tenantId]);
            if (!parentRes.rows[0]) return product;

            const parent = parentRes.rows[0];

            // 1. Fallback Fields (if variant has null or empty)
            const fallbackFields = ['description', 'image_url', 'price', 'category_id'];
            fallbackFields.forEach(field => {
                if (product[field] === null || product[field] === undefined || product[field] === '') {
                    product[field] = parent[field];
                    product[`is_inherited_${field}`] = true; // Flag for UI
                }
            });

            // Fallback Images (Gallery)
            // If product.images exists and is empty, fetch parent images
            if (!product.images || product.images.length === 0) {
                const parentImages = await query(
                    `SELECT * FROM product_media WHERE product_id = $1 AND media_type = 'image' ORDER BY position ASC`,
                    [product.parent_id]
                );
                if (parentImages.rows.length > 0) {
                    product.images = parentImages.rows;
                    product.is_inherited_images = true;
                }
            }

            // 2. Attributes Merge
            // Variant attributes override Parent attributes
            const parentAttrs = parent.attributes || {};
            const variantAttrs = product.attributes || {};
            product.attributes = { ...parentAttrs, ...variantAttrs };
            product.inherited_attribute_keys = Object.keys(parentAttrs).filter(key => !variantAttrs.hasOwnProperty(key));

            product.parent_name = parent.name; // For breadcrumbs/UI
            return product;
        } catch (err) {
            console.error('[ProductService] Failed to resolve inheritance:', err);
            return product;
        }
    }

    /**
     * Handle cascading soft-delete for variants
     * @param {string} tenantId 
     * @param {string} productId 
     */
    static async cascadeSoftDelete(tenantId, productId) {
        try {
            await query(`
                UPDATE products 
                SET deleted_at = NOW() 
                WHERE tenant_id = $1 AND parent_id = $2 AND deleted_at IS NULL
            `, [tenantId, productId]);
            console.log(`[ProductService] Cascaded soft-delete to variants for parent: ${productId}`);
        } catch (err) {
            console.error('[ProductService] Failed to cascade soft-delete:', err);
        }
    }

    /**
     * Enrich products with analytics stats (impressions and wishlist count)
     * @param {string} tenantId 
     * @param {Array} products 
     */
    static async enrichWithStats(tenantId, products) {
        if (!products || products.length === 0) return products;

        const productIds = products.map(p => p.id).filter(Boolean);
        if (productIds.length === 0) return products;

        try {
            // 1. Query Analytics (Impressions)
            const analyticsRes = await query(`
                SELECT entity_id, COUNT(*) as count
                FROM analytics_events
                WHERE tenant_id = $1
                AND event_type = 'impression'
                AND entity_type = 'product'
                AND entity_id = ANY($2)
                GROUP BY entity_id
            `, [tenantId, productIds]);

            // 2. Query Wishlists
            const wishlistRes = await query(`
                SELECT product_id, COUNT(*) as count
                FROM wishlists
                WHERE tenant_id = $1
                AND product_id = ANY($2)
                GROUP BY product_id
            `, [tenantId, productIds]);

            // 3. Map stats
            const statsMap = {};

            analyticsRes.rows.forEach(row => {
                if (!statsMap[row.entity_id]) statsMap[row.entity_id] = { impressions: 0, wishlist_count: 0 };
                statsMap[row.entity_id].impressions = parseInt(row.count);
            });

            wishlistRes.rows.forEach(row => {
                if (!statsMap[row.product_id]) statsMap[row.product_id] = { impressions: 0, wishlist_count: 0 };
                statsMap[row.product_id].wishlist_count = parseInt(row.count);
            });

            // 4. Inject back into products
            products.forEach(p => {
                p.stats = statsMap[p.id] || { impressions: 0, wishlist_count: 0 };
            });
        } catch (err) {
            console.error('[ProductService] Failed to enrich products with stats:', err);
        }

        return products;
    }
}

module.exports = ProductService;
