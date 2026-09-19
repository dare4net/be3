/**
 * Index Service
 * Handles indexing content from events
 */

const { query } = require('../../../config/database');

class IndexService {
    /**
     * Index a product
     * @param {string} tenantId
     * @param {Object} product - Product object with categories, tags, etc.
     */
    async indexProduct(tenantId, product) {
        // Fetch all ancestors for all product categories to ensure deep search and filtering works
        const allCategoryIds = new Set();
        const allCategoryNames = new Set();
        const allCategorySlugs = new Set();

        if (product.categories && product.categories.length > 0) {
            const sql = `
                WITH RECURSIVE cat_hierarchy AS (
                    SELECT id, parent_id, name, slug 
                    FROM categories 
                    WHERE id = ANY($1) AND tenant_id = $2
                    UNION ALL
                    SELECT c.id, c.parent_id, c.name, c.slug
                    FROM categories c
                    INNER JOIN cat_hierarchy ch ON c.id = ch.parent_id
                    WHERE c.tenant_id = $2
                )
                SELECT DISTINCT id, name, slug FROM cat_hierarchy;
            `;
            const catRes = await query(sql, [product.categories.map(c => c.id), tenantId]);
            catRes.rows.forEach(c => {
                allCategoryIds.add(c.id);
                allCategoryNames.add(c.name);
                allCategorySlugs.add(c.slug);
            });
        }

        const attrValues = [];
        if (product.attributes && typeof product.attributes === 'object') {
            Object.values(product.attributes).forEach(val => {
                if (typeof val === 'string') attrValues.push(val);
                if (Array.isArray(val)) attrValues.push(...val.map(v => v.toString()));
            });
        }

        // Build a lookup map for user business names needed in this product
        let ownerBusinessName = null;
        if (product.created_by && product.tags && product.tags.some(t => t && t.includes('[BUSINESS_NAME]'))) {
            const ownerRes = await query(
                `SELECT business_name, first_name, last_name FROM users WHERE id = $1`,
                [product.created_by]
            );
            const owner = ownerRes.rows[0];
            if (owner) {
                ownerBusinessName = owner.business_name
                    || `${owner.first_name || ''} ${owner.last_name || ''}`.trim()
                    || null;
            }
        }

        // Resolve dynamic tags (e.g., [BUSINESS_NAME]) — direct DB, no VariableRegistry dependency
        const resolvedTags = [];
        if (product.tags && product.tags.length > 0) {
            for (const tag of product.tags) {
                if (tag && tag.includes('[BUSINESS_NAME]')) {
                    if (ownerBusinessName) {
                        resolvedTags.push(tag.replace(/\[BUSINESS_NAME\]/g, ownerBusinessName));
                    }
                    // Skip storing the unresolved placeholder or "Be3" fallback
                } else if (tag) {
                    resolvedTags.push(tag);
                }
            }
        }


        const keywords = [
            product.name,
            product.sku || '',
            ...resolvedTags,
            ...Array.from(allCategoryNames),
            ...Array.from(allCategorySlugs),
            ...attrValues
        ].filter(k => k && k.trim() !== '');

        const metadata = {
            price: product.price || null,
            compare_at_price: product.compare_at_price || null,
            category_ids: Array.from(allCategoryIds),
            category_names: Array.from(allCategoryNames),
            status: product.status || 'draft',
            is_featured: product.is_featured || false,
            sku: product.sku || null,
            handle: product.handle || null,
            image_url: product.image_url || null,
            tags: resolvedTags,
            created_by: product.created_by || null,
            delivery_type: product.delivery_type || 'normal'
        };

        // Add product attributes if they exist
        if (product.attributes && typeof product.attributes === 'object') {
            metadata.attributes = product.attributes;
        }

        const searchDoc = {
            content_type: 'product',
            content_id: product.id,
            title: product.name || '',
            content: `${product.description || ''} ${product.sku || ''} ${Array.from(allCategoryNames).join(' ')} ${attrValues.join(' ')}`.trim(),
            keywords: keywords,
            metadata: metadata,
            is_active: product.status === 'active'
        };

        await this.upsertIndex(tenantId, searchDoc);
    }

    /**
     * Index a category
     * @param {string} tenantId
     * @param {Object} category - Category object
     */
    async indexCategory(tenantId, category) {
        const keywords = [
            category.name,
            category.slug || '',
            ...(category.description ? [category.description] : [])
        ].filter(k => k && k.trim() !== '');

        const metadata = {
            parent_id: category.parent_id || null,
            is_active: category.is_active !== false,
            slug: category.slug || null,
            image_url: category.image_url || null
        };

        const searchDoc = {
            content_type: 'category',
            content_id: category.id,
            title: category.name || '',
            content: category.description || '',
            keywords: keywords,
            metadata: metadata,
            is_active: category.is_active !== false
        };

        await this.upsertIndex(tenantId, searchDoc);
    }

    /**
     * Index a collection
     * @param {string} tenantId
     * @param {Object} collection - Collection object
     */
    async indexCollection(tenantId, collection) {
        const keywords = [
            collection.name,
            collection.slug || '',
            ...(collection.description ? [collection.description] : [])
        ].filter(k => k && k.trim() !== '');

        const metadata = {
            slug: collection.slug || null,
            image_url: collection.image_url || null,
            is_active: collection.is_active !== false
        };

        const searchDoc = {
            content_type: 'collection',
            content_id: collection.id,
            title: collection.name || '',
            content: collection.description || '',
            keywords: keywords,
            metadata: metadata,
            is_active: collection.is_active !== false
        };

        await this.upsertIndex(tenantId, searchDoc);
    }

    /**
     * Index a page
     * @param {string} tenantId
     * @param {Object} page - Page object
     */
    async indexPage(tenantId, page) {
        const keywords = [
            page.title,
            page.slug || '',
            ...(page.meta_description ? [page.meta_description] : [])
        ].filter(k => k && k.trim() !== '');

        const metadata = {
            is_published: page.is_published || false,
            page_type: page.page_type || 'page',
            slug: page.slug || null
        };

        const searchDoc = {
            content_type: 'page',
            content_id: page.id,
            title: page.title || '',
            content: page.content || page.meta_description || '',
            keywords: keywords,
            metadata: metadata,
            is_active: page.is_published !== false
        };

        await this.upsertIndex(tenantId, searchDoc);
    }

    /**
     * Upsert search index
     * @param {string} tenantId
     * @param {Object} doc - Search document
     */
    async upsertIndex(tenantId, doc) {
        const sql = `
            INSERT INTO search_indexes 
            (tenant_id, content_type, content_id, title, content, keywords, metadata, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (tenant_id, content_type, content_id)
            DO UPDATE SET
                title = EXCLUDED.title,
                content = EXCLUDED.content,
                keywords = EXCLUDED.keywords,
                metadata = EXCLUDED.metadata,
                is_active = EXCLUDED.is_active,
                updated_at = NOW()
        `;

        await query(sql, [
            tenantId,
            doc.content_type,
            doc.content_id,
            doc.title,
            doc.content,
            doc.keywords,
            JSON.stringify(doc.metadata),
            doc.is_active !== false
        ]);
    }

    /**
     * Remove from index or mark inactive
     * @param {string} tenantId
     * @param {string} contentType
     * @param {string} contentId
     */
    async removeFromIndex(tenantId, contentType, contentId) {
        const sql = `
            UPDATE search_indexes
            SET is_active = false, updated_at = NOW()
            WHERE tenant_id = $1
            AND content_type = $2
            AND content_id = $3
        `;

        await query(sql, [tenantId, contentType, contentId]);
    }

    /**
     * Rebuild index for a tenant
     * Fetches all products, categories, and pages and indexes them
     * @param {string} tenantId
     */
    async rebuildIndex(tenantId) {
        console.log(`[IndexService] Starting index rebuild for tenant: ${tenantId}`);

        let indexedCount = 0;

        try {
            // Index all products
            const productsResult = await query(
                `SELECT * FROM products WHERE tenant_id = $1`,
                [tenantId]
            );

            console.log(`[IndexService] Found ${productsResult.rows.length} products to index`);

            for (const product of productsResult.rows) {
                try {
                    // Fetch categories for each product
                    const categoriesResult = await query(
                        `SELECT c.id, c.name, c.slug 
                         FROM categories c
                         JOIN product_categories pc ON c.id = pc.category_id
                         WHERE pc.product_id = $1`,
                        [product.id]
                    );
                    product.categories = categoriesResult.rows;

                    // Fetch primary image if image_url is missing
                    if (!product.image_url) {
                        const mediaResult = await query(
                            `SELECT url FROM product_media WHERE product_id = $1 AND media_type = 'image' ORDER BY position ASC LIMIT 1`,
                            [product.id]
                        );
                        if (mediaResult.rows[0]) {
                            product.image_url = mediaResult.rows[0].url;
                        }
                    }

                    await this.indexProduct(tenantId, product);
                    indexedCount++;
                } catch (error) {
                    console.error(`[IndexService] Error indexing product ${product.id}:`, error);
                }
            }

            // Index all categories
            const categoriesResult = await query(
                `SELECT * FROM categories WHERE tenant_id = $1`,
                [tenantId]
            );

            console.log(`[IndexService] Found ${categoriesResult.rows.length} categories to index`);

            for (const category of categoriesResult.rows) {
                try {
                    await this.indexCategory(tenantId, category);
                    indexedCount++;
                } catch (error) {
                    console.error(`[IndexService] Error indexing category ${category.id}:`, error);
                }
            }

            // Index all collections
            const collectionsResult = await query(
                `SELECT * FROM collections WHERE tenant_id = $1`,
                [tenantId]
            );

            console.log(`[IndexService] Found ${collectionsResult.rows.length} collections to index`);

            for (const collection of collectionsResult.rows) {
                try {
                    await this.indexCollection(tenantId, collection);
                    indexedCount++;
                } catch (error) {
                    console.error(`[IndexService] Error indexing collection ${collection.id}:`, error);
                }
            }

            // Index all pages (if pages table exists)
            try {
                const pagesResult = await query(
                    `SELECT * FROM pages WHERE tenant_id = $1`,
                    [tenantId]
                );

                console.log(`[IndexService] Found ${pagesResult.rows.length} pages to index`);

                for (const page of pagesResult.rows) {
                    try {
                        await this.indexPage(tenantId, page);
                        indexedCount++;
                    } catch (error) {
                        console.error(`[IndexService] Error indexing page ${page.id}:`, error);
                    }
                }
            } catch (error) {
                // Pages table might not exist, that's okay
                console.log(`[IndexService] Pages table not found or not accessible: ${error.message}`);
            }

            console.log(`[IndexService] Index rebuild completed. Indexed ${indexedCount} items.`);
            return { success: true, indexedCount };
        } catch (error) {
            console.error(`[IndexService] Error during index rebuild:`, error);
            throw error;
        }
    }
}

module.exports = IndexService;
