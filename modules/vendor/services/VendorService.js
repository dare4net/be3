const { query } = require('../../../config/database');
const { tenantInsert } = require('../../../utils/dbHelpers');
const User = require('../../../platform/core/auth/models/User');
const ProductService = require('../../products/services/ProductService');

class VendorService {
    /**
     * Ensure the global system "Vendor" attribute exists.
     * This is a platform-wide attribute in the system_attributes table,
     * automatically available for all tenants.
     * 
     * @returns {object} The vendor system attribute record
     */
    static async ensureVendorAttribute() {
        console.log(`[VendorService] Ensuring global system "Vendor" attribute`);

        try {
            // Check if it already exists in the global system_attributes table
            const existing = await query(
                `SELECT id FROM system_attributes WHERE code = 'vendor'`
            );

            if (existing.rows.length > 0) {
                console.log(`[VendorService] Global "Vendor" system attribute already exists (${existing.rows[0].id})`);
                return existing.rows[0];
            }

            // Create the global system attribute
            const result = await query(
                `INSERT INTO system_attributes (code, label, type, options, is_filterable, is_searchable, description)
                 VALUES ('vendor', 'Vendor', 'select', '[]', true, true, 'Automatically managed vendor identification attribute')
                 RETURNING *`
            );

            console.log(`[VendorService] Created global "Vendor" system attribute (${result.rows[0].id})`);
            return result.rows[0];
        } catch (error) {
            console.error(`[VendorService] Error ensuring vendor attribute (system_attributes table may not exist):`, error.message);
            return null;
        }
    }

    /**
     * Initialize a vendor
     * Creates a collection and assigns the system vendor attribute to their products.
     * @param {string} tenantId 
     * @param {string} userId 
     */
    static async initializeVendor(tenantId, userId) {
        console.log(`[VendorService] Initializing vendor for user ${userId} in tenant ${tenantId}`);

        try {
            // 1. Get user details for business name, thumbnail and backdrop
            const user = await User.findById(tenantId, userId);
            if (!user) {
                console.error(`[VendorService] User ${userId} not found`);
                return;
            }

            const vendorName = user.business_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Vendor';
            const vendorThumbnail = user.business_thumbnail || null;
            const vendorBackdrop = user.business_backdrop || null;
            const slug = `${vendorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${userId.split('-')[0]}`;

            // 2. Ensure the global system vendor attribute exists
            await this.ensureVendorAttribute();

            // 3. Check if collection already exists for this vendor using created_by
            const existing = await query(
                `SELECT id, name, slug, thumbnail_url, image_url FROM collections WHERE tenant_id = $1 AND created_by = $2`,
                [tenantId, userId]
            );

            let collectionId;
            let oldVendorName = null;

            if (existing.rows.length > 0) {
                console.log(`[VendorService] Collection already exists for vendor ${userId}. Updating name if needed.`);
                collectionId = existing.rows[0].id;
                oldVendorName = existing.rows[0].name;

                // Update name, slug, thumbnail and image (backdrop) if needed
                const nameChanged = oldVendorName !== vendorName;
                const thumbnailChanged = existing.rows[0].thumbnail_url !== vendorThumbnail;
                const backdropChanged = existing.rows[0].image_url !== vendorBackdrop;

                if (nameChanged || thumbnailChanged || backdropChanged || !existing.rows[0].is_active) {
                    const rules = [
                        {
                            field: 'attribute',
                            attribute_code: 'vendor',
                            operator: 'eq',
                            value: vendorName
                        }
                    ];

                    // Sync slug with new name
                    const updatedSlug = `${vendorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${userId.split('-')[0]}-collection`;

                    await query(
                        `UPDATE collections SET name = $1, slug = $2, rules = $3, thumbnail_url = $4, image_url = $5, is_active = $6, collection_type = $7 WHERE id = $8`,
                        [vendorName, updatedSlug, JSON.stringify(rules), vendorThumbnail, vendorBackdrop, true, 'vendor', collectionId]
                    );

                    // Emit collection.updated so Search Module indexes it
                    const eventBus = require('../../../platform/events/EventBus');
                    eventBus.emitEvent('collection.updated', {
                        tenantId,
                        collectionId
                    });
                }
            } else {
                // 4. Create Collection with attribute rule and created_by
                const rules = [
                    {
                        field: 'attribute',
                        attribute_code: 'vendor',
                        operator: 'eq',
                        value: vendorName
                    }
                ];

                const collection = await tenantInsert('collections', tenantId, {
                    name: vendorName,
                    slug: `${slug}-collection`,
                    description: `Automatically created collection for vendor ${vendorName}`,
                    rules: JSON.stringify(rules),
                    created_by: userId,
                    thumbnail_url: vendorThumbnail,
                    image_url: vendorBackdrop,
                    is_active: true,
                    collection_type: 'vendor'
                });
                collectionId = collection.id;

                // Emit collection.created so Search Module indexes it
                const eventBus = require('../../../platform/events/EventBus');
                eventBus.emitEvent('collection.created', {
                    tenantId,
                    collectionId: collection.id
                });
            }

            console.log(`[VendorService] Successfully created/verified collection '${vendorName}' for vendor ${userId}`);

            // 5. Update existing products: set the vendor attribute + keep legacy tag for backward compat
            await this.assignVendorAttributeToProducts(tenantId, userId, vendorName, oldVendorName);

            return { id: collectionId, name: vendorName };
        } catch (error) {
            console.error(`[VendorService] Failed to initialize vendor ${userId}:`, error);
            throw error;
        }
    }



    /**
     * Deactivate a vendor's collection
     * @param {string} tenantId 
     * @param {string} userId 
     */
    static async deactivateVendor(tenantId, userId) {
        console.log(`[VendorService] Deactivating vendor collection for user ${userId} in tenant ${tenantId}`);

        try {
            const existing = await query(
                `SELECT id FROM collections WHERE tenant_id = $1 AND created_by = $2 AND collection_type = 'vendor'`,
                [tenantId, userId]
            );

            if (existing.rows.length > 0) {
                const collectionId = existing.rows[0].id;
                await query(
                    `UPDATE collections SET is_active = false WHERE id = $1`,
                    [collectionId]
                );

                console.log(`[VendorService] Deactivated vendor collection ${collectionId}`);

                // Emit collection.updated so Search Module indexes it correctly
                const eventBus = require('../../../platform/events/EventBus');
                eventBus.emitEvent('collection.updated', {
                    tenantId,
                    collectionId
                });
            }
        } catch (error) {
            console.error(`[VendorService] Error deactivating vendor collection for ${userId}:`, error);
        }
    }

    /**
     * Assign the system vendor attribute to all products for a vendor.
     * Also handles renaming (removes old vendor name, sets new one).
     * Maintains backward-compatible tags as well.
     */
    static async assignVendorAttributeToProducts(tenantId, userId, vendorName, oldVendorName = null) {
        console.log(`[VendorService] Assigning vendor attribute for ${userId}. New: ${vendorName}, Old: ${oldVendorName || 'None'}`);

        try {
            const products = await query(
                `SELECT id, tags, attributes FROM products WHERE tenant_id = $1 AND created_by = $2`,
                [tenantId, userId]
            );

            for (const product of products.rows) {
                let tags = product.tags || [];
                const originalTags = [...tags];
                let attributes = product.attributes || {};
                if (typeof attributes === 'string') {
                    try { attributes = JSON.parse(attributes); } catch { attributes = {}; }
                }
                const originalAttributes = { ...attributes };

                // 1. Update the vendor attribute on the product
                attributes.vendor = vendorName;

                // 2. Variable-based tag management (using centralized service)
                tags = ProductService.sanitizeTags(tags, true, vendorName);

                // Only update if something changed
                const tagsChanged = JSON.stringify(tags) !== JSON.stringify(originalTags);
                const attrsChanged = JSON.stringify(attributes) !== JSON.stringify(originalAttributes);

                if (tagsChanged || attrsChanged) {
                    console.log(`[VendorService] Updating product ${product.id}: vendor="${vendorName}"`);
                    await query(
                        `UPDATE products SET tags = $1::text[], attributes = $2 WHERE id = $3`,
                        [tags, JSON.stringify(attributes), product.id]
                    );

                    // Emit product.updated for search indexing
                    const eventBus = require('../../../platform/events/EventBus');
                    eventBus.emitEvent('product.updated', {
                        tenantId,
                        productId: product.id
                    });
                }
            }
            console.log(`[VendorService] Updated ${products.rows.length} products with vendor attribute`);
        } catch (error) {
            console.error(`[VendorService] Error assigning vendor attribute:`, error);
        }
    }

    /**
     * @deprecated Use assignVendorAttributeToProducts instead.
     * Kept for backward compatibility.
     */
    static async reTagExistingProducts(tenantId, userId, vendorName, oldVendorName = null) {
        return this.assignVendorAttributeToProducts(tenantId, userId, vendorName, oldVendorName);
    }
}

module.exports = VendorService;
