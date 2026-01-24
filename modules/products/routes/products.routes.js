/**
 * Product Routes
 * Product CRUD operations and collections
 */

const { query } = require('../../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate } = require('../../../utils/dbHelpers');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const authorize = require('../../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../../middleware/errorHandler');

function registerProductRoutes(router, eventBus) {
    // List products (Admin)
    router.get('/', authenticate, authorize('products.view'), asyncHandler(async (req, res) => {
        const result = await paginatedTenantQuery('products', req.tenantId, {
            page: parseInt(req.query.page) || 1,
            perPage: parseInt(req.query.per_page) || 20,
        });

        // Fetch categories for each product (simple N+1 solution for now, optimized in prod)
        for (let product of result.data) {
            const cats = await query(
                `SELECT c.id, c.name, c.slug FROM categories c
           JOIN product_categories pc ON c.id = pc.category_id
           WHERE pc.product_id = $1`,
                [product.id]
            );
            product.categories = cats.rows;
        }

        res.json({ success: true, ...result });
    }));

    // List all collections (Public/Admin light)
    router.get('/collections', asyncHandler(async (req, res) => {
        const result = await query(
            `SELECT id, name, slug, image_url FROM collections WHERE tenant_id = $1 AND is_active = true ORDER BY name ASC`,
            [req.tenantId]
        );
        res.json({ success: true, collections: result.rows });
    }));

    // Get product by ID
    router.get('/:id', authenticate, authorize('products.view'), asyncHandler(async (req, res) => {
        const sql = `SELECT * FROM products WHERE id = $1 AND tenant_id = $2`;
        const result = await query(sql, [req.params.id, req.tenantId]);
        if (!result.rows[0]) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const product = result.rows[0];

        // Get categories
        const cats = await query(
            `SELECT c.id, c.name, c.slug FROM categories c
         JOIN product_categories pc ON c.id = pc.category_id
         WHERE pc.product_id = $1`,
            [product.id]
        );
        product.categories = cats.rows;

        res.json({ success: true, product });
    }));

    // Create product
    router.post('/', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
        // Generate base handle
        let handle = req.body.handle || req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (!handle) handle = 'product-' + Date.now(); // Fallback for empty names

        // Ensure uniqueness
        const existing = await query(`SELECT id FROM products WHERE tenant_id = $1 AND handle = $2`, [req.tenantId, handle]);
        if (existing.rows.length > 0) {
            // Handle conflict - append random string
            const randomSuffix = Math.random().toString(36).substring(2, 7);
            handle = `${handle}-${randomSuffix}`;
        }

        const product = await tenantInsert('products', req.tenantId, {
            name: req.body.name,
            description: req.body.description,
            sku: req.body.sku,
            price: req.body.price,
            compare_at_price: req.body.compare_at_price,
            track_inventory: req.body.track_inventory,
            inventory_quantity: req.body.inventory_quantity || 0,
            status: req.body.status || 'draft',
            attributes: req.body.attributes ? JSON.stringify(req.body.attributes) : '{}', // Custom Fields
            is_featured: req.body.is_featured || false,
            tags: req.body.tags || [],
            seo_title: req.body.seo_title,
            seo_description: req.body.seo_description,
            handle: handle,
            image_url: req.body.image_url,
            category_id: req.body.category_id, // Link to primary category
            // SEO Fields
            meta_description: req.body.meta_description,
            og_title: req.body.og_title,
            og_description: req.body.og_description,
            og_image: req.body.og_image,
            og_type: req.body.og_type,
            twitter_card: req.body.twitter_card,
            twitter_title: req.body.twitter_title,
            twitter_description: req.body.twitter_description,
            twitter_image: req.body.twitter_image,
            canonical_url: req.body.canonical_url,
            robots: req.body.robots,
            structured_data: req.body.structured_data
        });

        // Handle categories
        if (req.body.category_ids && Array.isArray(req.body.category_ids)) {
            for (const catId of req.body.category_ids) {
                await query(
                    `INSERT INTO product_categories (tenant_id, product_id, category_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                    [req.tenantId, product.id, catId]
                );
            }
        }

        // PRINCIPLE: All inter-module communication is event-based
        eventBus.emitEvent('product.created', {
            tenantId: req.tenantId,
            productId: product.id,
            name: product.name,
        });

        res.status(201).json({ success: true, product });
    }));

    router.patch('/:id', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
        // Extract category_ids from body to avoid DB error in tenantUpdate
        const { category_ids, ...updateData } = req.body;

        // Stringify attributes if provided
        if (updateData.attributes && typeof updateData.attributes === 'object') {
            updateData.attributes = JSON.stringify(updateData.attributes);
        }

        const product = await tenantUpdate('products', req.tenantId, req.params.id, updateData);

        // Update categories if provided
        if (category_ids && Array.isArray(category_ids)) {
            // Clear existing
            await query(`DELETE FROM product_categories WHERE product_id = $1`, [product.id]);

            // Add new
            for (const catId of category_ids) {
                await query(
                    `INSERT INTO product_categories (tenant_id, product_id, category_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                    [req.tenantId, product.id, catId]
                );
            }
        }

        eventBus.emitEvent('product.updated', {
            tenantId: req.tenantId,
            productId: product.id,
        });

        res.json({ success: true, product });
    }));
}

module.exports = { registerProductRoutes };
