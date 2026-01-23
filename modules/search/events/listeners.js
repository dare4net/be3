/**
 * Search Module Event Listeners
 * Listens to content changes and updates search index
 * 
 * PRINCIPLE: All inter-module communication is event-based
 */

const IndexService = require('../services/IndexService');

/**
 * Initialize event listeners for search module
 * @param {Object} eventBus - Global event bus
 */
function initializeListeners(eventBus) {
    const indexService = new IndexService();

    // Product events
    eventBus.registerListener('product.created', async (event) => {
        try {
            const { tenantId, productId } = event.data;
            console.log(`[Search] Indexing product: ${productId} for tenant: ${tenantId}`);

            // Fetch product data - we need to query the products table
            // Since modules don't import each other, we query the database directly
            const { query } = require('../../../config/database');

            const productResult = await query(
                `SELECT * FROM products WHERE id = $1 AND tenant_id = $2`,
                [productId, tenantId]
            );

            if (productResult.rows.length === 0) {
                console.warn(`[Search] Product ${productId} not found for indexing`);
                return;
            }

            const product = productResult.rows[0];

            // Fetch categories
            const categoriesResult = await query(
                `SELECT c.id, c.name, c.slug 
                 FROM categories c
                 JOIN product_categories pc ON c.id = pc.category_id
                 WHERE pc.product_id = $1`,
                [productId]
            );
            product.categories = categoriesResult.rows;

            // Fetch primary image if image_url is missing
            if (!product.image_url) {
                const mediaResult = await query(
                    `SELECT url FROM product_media WHERE product_id = $1 AND media_type = 'image' ORDER BY position ASC LIMIT 1`,
                    [productId]
                );
                if (mediaResult.rows[0]) {
                    product.image_url = mediaResult.rows[0].url;
                }
            }

            await indexService.indexProduct(tenantId, product);
        } catch (error) {
            console.error('[Search] Error indexing product:', error);
        }
    }, 'search');

    eventBus.registerListener('product.updated', async (event) => {
        try {
            const { tenantId, productId } = event.data;
            console.log(`[Search] Re-indexing product: ${productId}`);

            const { query } = require('../../../config/database');

            const productResult = await query(
                `SELECT * FROM products WHERE id = $1 AND tenant_id = $2`,
                [productId, tenantId]
            );

            if (productResult.rows.length === 0) {
                return;
            }

            const product = productResult.rows[0];

            // Fetch categories
            const categoriesResult = await query(
                `SELECT c.id, c.name, c.slug 
                 FROM categories c
                 JOIN product_categories pc ON c.id = pc.category_id
                 WHERE pc.product_id = $1`,
                [productId]
            );
            product.categories = categoriesResult.rows;

            // Fetch primary image if image_url is missing
            if (!product.image_url) {
                const mediaResult = await query(
                    `SELECT url FROM product_media WHERE product_id = $1 AND media_type = 'image' ORDER BY position ASC LIMIT 1`,
                    [productId]
                );
                if (mediaResult.rows[0]) {
                    product.image_url = mediaResult.rows[0].url;
                }
            }

            await indexService.indexProduct(tenantId, product);
        } catch (error) {
            console.error('[Search] Error re-indexing product:', error);
        }
    }, 'search');

    eventBus.registerListener('product.deleted', async (event) => {
        try {
            const { tenantId, productId } = event.data;
            console.log(`[Search] Removing product from index: ${productId}`);
            await indexService.removeFromIndex(tenantId, 'product', productId);
        } catch (error) {
            console.error('[Search] Error removing product from index:', error);
        }
    }, 'search');

    // Category events
    eventBus.registerListener('category.created', async (event) => {
        try {
            const { tenantId, categoryId } = event.data;
            console.log(`[Search] Indexing category: ${categoryId}`);

            const { query } = require('../../../config/database');

            const categoryResult = await query(
                `SELECT * FROM categories WHERE id = $1 AND tenant_id = $2`,
                [categoryId, tenantId]
            );

            if (categoryResult.rows.length === 0) {
                return;
            }

            await indexService.indexCategory(tenantId, categoryResult.rows[0]);
        } catch (error) {
            console.error('[Search] Error indexing category:', error);
        }
    }, 'search');

    eventBus.registerListener('category.updated', async (event) => {
        try {
            const { tenantId, categoryId } = event.data;

            const { query } = require('../../../config/database');

            const categoryResult = await query(
                `SELECT * FROM categories WHERE id = $1 AND tenant_id = $2`,
                [categoryId, tenantId]
            );

            if (categoryResult.rows.length === 0) {
                return;
            }

            await indexService.indexCategory(tenantId, categoryResult.rows[0]);
        } catch (error) {
            console.error('[Search] Error re-indexing category:', error);
        }
    }, 'search');

    eventBus.registerListener('category.deleted', async (event) => {
        try {
            const { tenantId, categoryId } = event.data;
            await indexService.removeFromIndex(tenantId, 'category', categoryId);
        } catch (error) {
            console.error('[Search] Error removing category from index:', error);
        }
    }, 'search');

    // Collection events
    eventBus.registerListener('collection.created', async (event) => {
        try {
            const { tenantId, collectionId } = event.data;
            const { query } = require('../../../config/database');
            const res = await query(`SELECT * FROM collections WHERE id = $1 AND tenant_id = $2`, [collectionId, tenantId]);
            if (res.rows[0]) await indexService.indexCollection(tenantId, res.rows[0]);
        } catch (error) {
            console.error('[Search] Error indexing collection:', error);
        }
    }, 'search');

    eventBus.registerListener('collection.updated', async (event) => {
        try {
            const { tenantId, collectionId } = event.data;
            const { query } = require('../../../config/database');
            const res = await query(`SELECT * FROM collections WHERE id = $1 AND tenant_id = $2`, [collectionId, tenantId]);
            if (res.rows[0]) await indexService.indexCollection(tenantId, res.rows[0]);
        } catch (error) {
            console.error('[Search] Error re-indexing collection:', error);
        }
    }, 'search');

    eventBus.registerListener('collection.deleted', async (event) => {
        try {
            const { tenantId, collectionId } = event.data;
            await indexService.removeFromIndex(tenantId, 'collection', collectionId);
        } catch (error) {
            console.error('[Search] Error removing collection from index:', error);
        }
    }, 'search');

    // Note: Page events would be added here when page_builder module emits them
    // For now, pages can be indexed manually via admin endpoint

    console.log('[Search] Event listeners initialized');
}

module.exports = { initializeListeners };
