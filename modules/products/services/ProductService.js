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
}

module.exports = ProductService;
