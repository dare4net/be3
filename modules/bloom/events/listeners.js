/**
 * Bloom Module Event Listeners
 * 
 * Subscribes to product/category/collection CRUD events on the EventBus
 * and keeps Bloom filters incrementally updated.
 * 
 * PRINCIPLE: All inter-module communication is event-based.
 * PRINCIPLE: Bloom failures must never block the emitting module.
 */

const BloomFilterService = require('../services/BloomFilterService');
const { query } = require('../../../config/database');

/**
 * Initialize event listeners for the Bloom module.
 * @param {Object} eventBus - Global event bus
 */
function initializeListeners(eventBus) {
    const bloomService = new BloomFilterService();

    // ═══════════════════════════════════════════════
    // PRODUCT EVENTS
    // ═══════════════════════════════════════════════

    eventBus.registerListener('product.created', async (event) => {
        try {
            const { tenantId, productId } = event.data;

            // Fetch the product for tokenization
            const productRes = await query(
                `SELECT id, name, sku, tags, attributes FROM products WHERE id = $1 AND tenant_id = $2`,
                [productId, tenantId]
            );
            if (!productRes.rows[0]) return;

            // Fetch product's categories
            const catRes = await query(
                `SELECT c.id, c.name FROM categories c
                 JOIN product_categories pc ON c.id = pc.category_id
                 WHERE pc.product_id = $1`,
                [productId]
            );

            const product = productRes.rows[0];
            const catNames = catRes.rows.map(r => r.name);
            const catIds = catRes.rows.map(r => r.id);

            // Tokenize and add to global + category filters
            const tokens = bloomService.tokenizeProduct(product, catNames);
            await bloomService.addTokens(tenantId, tokens, catIds);

            console.log(`[Bloom] Indexed product ${productId}: ${tokens.length} tokens`);
        } catch (error) {
            console.error('[Bloom] Error on product.created:', error.message);
        }
    }, 'bloom');

    eventBus.registerListener('product.updated', async (event) => {
        try {
            const { tenantId, productId } = event.data;

            const productRes = await query(
                `SELECT id, name, sku, tags, attributes FROM products WHERE id = $1 AND tenant_id = $2`,
                [productId, tenantId]
            );
            if (!productRes.rows[0]) return;

            const catRes = await query(
                `SELECT c.id, c.name FROM categories c
                 JOIN product_categories pc ON c.id = pc.category_id
                 WHERE pc.product_id = $1`,
                [productId]
            );

            const product = productRes.rows[0];
            const catNames = catRes.rows.map(r => r.name);
            const catIds = catRes.rows.map(r => r.id);

            // On update: add new tokens (Bloom filters are additive, old tokens remain — scanner will clean up periodically)
            const tokens = bloomService.tokenizeProduct(product, catNames);
            await bloomService.addTokens(tenantId, tokens, catIds);

            console.log(`[Bloom] Re-indexed product ${productId}: ${tokens.length} tokens`);
        } catch (error) {
            console.error('[Bloom] Error on product.updated:', error.message);
        }
    }, 'bloom');

    eventBus.registerListener('product.deleted', async (event) => {
        try {
            const { tenantId, productId } = event.data;

            // Bloom filters don't support removal.
            // Fetch the categories this product belonged to and rebuild those category filters.
            const catRes = await query(
                `SELECT category_id FROM product_categories WHERE product_id = $1`,
                [productId]
            );

            const catIds = catRes.rows.map(r => r.category_id);
            if (catIds.length > 0) {
                await bloomService.onProductDeleted(tenantId, catIds);
                console.log(`[Bloom] Product ${productId} deleted — rebuilt ${catIds.length} category filters`);
            }

            // Note: Global filter is NOT rebuilt on single deletion (too expensive).
            // The scanner will handle periodic global rebuilds.
        } catch (error) {
            console.error('[Bloom] Error on product.deleted:', error.message);
        }
    }, 'bloom');

    // ═══════════════════════════════════════════════
    // CATEGORY EVENTS
    // ═══════════════════════════════════════════════

    eventBus.registerListener('category.created', async (event) => {
        try {
            const { tenantId, categoryId } = event.data;

            const catRes = await query(
                `SELECT name, slug FROM categories WHERE id = $1 AND tenant_id = $2`,
                [categoryId, tenantId]
            );
            if (!catRes.rows[0]) return;

            const cat = catRes.rows[0];
            const tokens = [
                ...bloomService.tokenize(cat.name),
                ...(cat.slug ? bloomService.tokenize(cat.slug.replace(/-/g, ' ')) : [])
            ];

            // Add category tokens to global filter
            await bloomService.addTokens(tenantId, tokens);

            // Build a new per-category filter (empty initially, will be populated as products are added)
            await bloomService.buildCategoryFilter(tenantId, categoryId);

            console.log(`[Bloom] Indexed new category ${categoryId}: ${tokens.length} tokens`);
        } catch (error) {
            console.error('[Bloom] Error on category.created:', error.message);
        }
    }, 'bloom');

    eventBus.registerListener('category.updated', async (event) => {
        try {
            const { tenantId, categoryId } = event.data;

            const catRes = await query(
                `SELECT name, slug FROM categories WHERE id = $1 AND tenant_id = $2`,
                [categoryId, tenantId]
            );
            if (!catRes.rows[0]) return;

            const cat = catRes.rows[0];
            const tokens = [
                ...bloomService.tokenize(cat.name),
                ...(cat.slug ? bloomService.tokenize(cat.slug.replace(/-/g, ' ')) : [])
            ];

            await bloomService.addTokens(tenantId, tokens);

            // Rebuild category filter (name might have changed)
            await bloomService.buildCategoryFilter(tenantId, categoryId);

            console.log(`[Bloom] Re-indexed category ${categoryId}`);
        } catch (error) {
            console.error('[Bloom] Error on category.updated:', error.message);
        }
    }, 'bloom');

    eventBus.registerListener('category.deleted', async (event) => {
        try {
            const { tenantId, categoryId } = event.data;

            // Remove the category filter key from Redis
            const redis = require('../../../config/redis');
            const key = `tenant:${tenantId}:bloom:cat:${categoryId}`;
            if (redis.isRedisHealthy()) {
                await redis.redisClient.del(key);
            }

            console.log(`[Bloom] Removed category filter for ${categoryId}`);
            // Global filter rebuild deferred to scanner
        } catch (error) {
            console.error('[Bloom] Error on category.deleted:', error.message);
        }
    }, 'bloom');

    // ═══════════════════════════════════════════════
    // COLLECTION EVENTS
    // ═══════════════════════════════════════════════

    eventBus.registerListener('collection.created', async (event) => {
        try {
            const { tenantId, collectionId } = event.data;

            const colRes = await query(
                `SELECT name, slug FROM collections WHERE id = $1 AND tenant_id = $2`,
                [collectionId, tenantId]
            );
            if (!colRes.rows[0]) return;

            const col = colRes.rows[0];
            const tokens = [
                ...bloomService.tokenize(col.name),
                ...(col.slug ? bloomService.tokenize(col.slug.replace(/-/g, ' ')) : [])
            ];

            await bloomService.addTokens(tenantId, tokens);
            console.log(`[Bloom] Indexed collection ${collectionId}: ${tokens.length} tokens`);
        } catch (error) {
            console.error('[Bloom] Error on collection.created:', error.message);
        }
    }, 'bloom');

    eventBus.registerListener('collection.updated', async (event) => {
        try {
            const { tenantId, collectionId } = event.data;

            const colRes = await query(
                `SELECT name, slug FROM collections WHERE id = $1 AND tenant_id = $2`,
                [collectionId, tenantId]
            );
            if (!colRes.rows[0]) return;

            const col = colRes.rows[0];
            const tokens = [
                ...bloomService.tokenize(col.name),
                ...(col.slug ? bloomService.tokenize(col.slug.replace(/-/g, ' ')) : [])
            ];

            await bloomService.addTokens(tenantId, tokens);
            console.log(`[Bloom] Re-indexed collection ${collectionId}`);
        } catch (error) {
            console.error('[Bloom] Error on collection.updated:', error.message);
        }
    }, 'bloom');

    eventBus.registerListener('collection.deleted', async (event) => {
        try {
            // Global rebuild deferred to scanner
            console.log(`[Bloom] Collection deleted — global rebuild deferred to scanner`);
        } catch (error) {
            console.error('[Bloom] Error on collection.deleted:', error.message);
        }
    }, 'bloom');

    console.log('[Bloom] Event listeners initialized');
}

module.exports = { initializeListeners };
