const { query } = require('../../../config/database');
const { tenantInsert } = require('../../../utils/dbHelpers');
const User = require('../../../platform/core/auth/models/User');

class VendorService {
    /**
     * Initialize a vendor
     * Creates a collection for the vendor based on their business name
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

            // 2. Check if collection already exists for this vendor using created_by
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

                if (nameChanged || thumbnailChanged || backdropChanged) {
                    const rules = [
                        {
                            field: 'tag',
                            operator: 'eq',
                            value: vendorName
                        }
                    ];

                    // Sync slug with new name
                    const updatedSlug = `${vendorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${userId.split('-')[0]}-collection`;

                    await query(
                        `UPDATE collections SET name = $1, slug = $2, rules = $3, thumbnail_url = $4, image_url = $5 WHERE id = $6`,
                        [vendorName, updatedSlug, JSON.stringify(rules), vendorThumbnail, vendorBackdrop, collectionId]
                    );

                    // Emit collection.updated so Search Module indexes it
                    const eventBus = require('../../../platform/events/EventBus');
                    eventBus.emitEvent('collection.updated', {
                        tenantId,
                        collectionId
                    });
                }
            } else {
                // 3. Create Collection with tag rule and created_by
                const rules = [
                    {
                        field: 'tag',
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
                    is_active: true
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

            // 4. Update existing products (and cleanup old tags if it's a rename)
            await this.reTagExistingProducts(tenantId, userId, vendorName, oldVendorName);

            return { id: collectionId, name: vendorName };
        } catch (error) {
            console.error(`[VendorService] Failed to initialize vendor ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Re-tag all products for this vendor
     * Useful when business name changes
     */
    static async reTagExistingProducts(tenantId, userId, vendorName, oldVendorName = null) {
        console.log(`[VendorService] Re-tagging products for vendor ${userId}. New: ${vendorName}, Old: ${oldVendorName || 'None'}`);

        try {
            const products = await query(
                `SELECT id, tags FROM products WHERE tenant_id = $1 AND created_by = $2`,
                [tenantId, userId]
            );

            for (const product of products.rows) {
                let tags = product.tags || [];
                const originalTags = [...tags];

                // 1. Remove old vendor name tag if it's a rename
                if (oldVendorName && oldVendorName !== vendorName) {
                    tags = tags.filter(t => t !== oldVendorName);
                }

                // 2. Add new vendor name tag
                if (!tags.includes(vendorName)) {
                    tags.push(vendorName);
                }

                // If tags changed, update
                if (JSON.stringify(tags) !== JSON.stringify(originalTags)) {
                    console.log(`[VendorService] Updating product ${product.id} tags: ${originalTags.join(',')} -> ${tags.join(',')}`);
                    await query(
                        `UPDATE products SET tags = $1::text[] WHERE id = $2`,
                        [tags, product.id]
                    );

                    // Emit product.updated for search indexing
                    const eventBus = require('../../../platform/events/EventBus');
                    eventBus.emitEvent('product.updated', {
                        tenantId,
                        productId: product.id
                    });
                }
            }
            console.log(`[VendorService] Re-tagged ${products.rows.length} products`);
        } catch (error) {
            console.error(`[VendorService] Error re-tagging products:`, error);
        }
    }
}

module.exports = VendorService;
