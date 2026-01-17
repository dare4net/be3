/**
 * Products Module Bootstrapper
 * 
 * PRINCIPLE: Modules do not import other modules
 * PRINCIPLE: All inter-module communication is event-based
 * PRINCIPLE: Any module can be removed without crashing the system
 */

const express = require('express');
const { query } = require('../../config/database');
const { tenantInsert, paginatedTenantQuery, tenantUpdate, tenantDelete } = require('../../utils/dbHelpers');
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const authorize = require('../../platform/core/roles/middleware/authorize');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../middleware/errorHandler');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();

        // ==========================================
        // Public Routes (No Auth, No Subscription)
        // ==========================================

        // PUBLIC STOREFRONT ENDPOINT (No Auth, but requires Subscription/Module Access)
        router.get('/storefront', subscriptionGuard('products'), asyncHandler(async (req, res) => {
            const { featured, category, category_id, limit, exclude } = req.query;
            const page = parseInt(req.query.page) || 1;
            const perPage = parseInt(limit || req.query.per_page) || 20;
            const offset = (page - 1) * perPage;

            let queryParams = [req.tenantId];
            let whereConditions = [`p.tenant_id = $1`, `p.status = 'active'`];

            if (featured === 'true') {
                queryParams.push(true);
                whereConditions.push(`p.is_featured = $${queryParams.length}`);
            }

            if (exclude) {
                queryParams.push(exclude);
                whereConditions.push(`p.id != $${queryParams.length}`);
            }

            if (category_id) {
                queryParams.push(category_id);
                whereConditions.push(`EXISTS (
                    SELECT 1 FROM product_categories pc
                    WHERE pc.product_id = p.id AND pc.category_id = $${queryParams.length}
                )`);
            } else if (category) {
                queryParams.push(category);
                whereConditions.push(`EXISTS (
                    SELECT 1 FROM product_categories pc
                    JOIN categories c ON pc.category_id = c.id
                    WHERE pc.product_id = p.id AND c.slug = $${queryParams.length}
                )`);
            }

            const whereSQL = whereConditions.join(' AND ');

            // Get products with filters
            const productsSQL = `
                SELECT p.* FROM products p
                WHERE ${whereSQL}
                ORDER BY p.created_at DESC
                LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
            `;
            queryParams.push(perPage, offset);

            const result = await query(productsSQL, queryParams);

            // Get total count
            const countSQL = `SELECT COUNT(*) FROM products p WHERE ${whereSQL}`;
            const countResult = await query(countSQL, queryParams.slice(0, queryParams.length - 2));
            const total = parseInt(countResult.rows[0].count);

            // Fetch categories/images for each product
            for (let product of result.rows) {
                // Get Images
                const imgs = await query(
                    `SELECT * FROM product_media WHERE product_id = $1 AND media_type = 'image' ORDER BY position ASC`,
                    [product.id]
                );
                product.images = imgs.rows;

                // Get Categories
                const cats = await query(
                    `SELECT c.id, c.name, c.slug FROM categories c
                     JOIN product_categories pc ON c.id = pc.category_id
                     WHERE pc.product_id = $1`,
                    [product.id]
                );
                product.categories = cats.rows;
            }

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page,
                    perPage,
                    total,
                    totalPages: Math.ceil(total / perPage)
                }
            });
        }));

        // TEMPORARY DEBUG ENDPOINT
        router.get('/storefront/debug', asyncHandler(async (req, res) => {
            res.json({
                success: true,
                tenantId: req.tenantId,
                headers: req.headers
            });
        }));

        // PUBLIC STOREFRONT PRODUCT DETAIL
        router.get('/storefront/products/:handle', subscriptionGuard('products'), asyncHandler(async (req, res) => {
            const { handle } = req.params;
            console.log(`[Products API] Fetching product: ${handle} for tenant: ${req.tenantId}`);

            // Get Product
            const productRes = await query(
                `SELECT * FROM products WHERE tenant_id = $1 AND (handle = $2 OR id::text = $2) AND status = 'active'`,
                [req.tenantId, handle]
            );
            console.log(`[Products API] Found: ${productRes.rows.length} rows`);

            if (!productRes.rows[0]) {
                return res.status(404).json({ error: 'Product not found' });
            }

            const product = productRes.rows[0];

            // Get Images
            const mediaRes = await query(
                `SELECT * FROM product_media WHERE product_id = $1 AND media_type = 'image' ORDER BY position ASC`,
                [product.id]
            );
            product.images = mediaRes.rows;

            // Get Categories
            const catsRes = await query(
                `SELECT c.id, c.name, c.slug FROM categories c
                 JOIN product_categories pc ON c.id = pc.category_id
                 WHERE pc.product_id = $1`,
                [product.id]
            );
            product.categories = catsRes.rows;

            // Get Attributes (Resolved from Categories + Product Specific)
            // For now, we return the raw product 'attributes' JSONB column.
            // Future: Implement full inheritance resolution similar to /categories/:id/admin if needed for the frontend.

            res.json({ success: true, product });
        }));

        // PUBLIC STOREFRONT CATEGORY DETAIL
        router.get('/storefront/categories/:slug', subscriptionGuard('products'), asyncHandler(async (req, res) => {
            const { slug } = req.params;

            const catRes = await query(
                `SELECT id, name, slug, description, image_url, parent_id 
                 FROM categories 
                 WHERE tenant_id = $1 AND slug = $2 AND is_active = true`,
                [req.tenantId, slug]
            );

            if (!catRes.rows[0]) {
                return res.status(404).json({ error: 'Category not found' });
            }

            const category = catRes.rows[0];

            // Get Subcategories?
            const subRes = await query(
                `SELECT id, name, slug FROM categories 
                 WHERE tenant_id = $1 AND parent_id = $2 AND is_active = true 
                 ORDER BY name ASC`,
                [req.tenantId, category.id]
            );
            category.children = subRes.rows;

            res.json({ success: true, category });
        }));

        // ==========================================
        // Super Admin Routes (No Tenant Auth)
        // ==========================================

        // List products for a specific tenant (Admin)
        router.get('/admin/tenants/:tenantId/products', asyncHandler(async (req, res) => {
            const { tenantId } = req.params;
            const result = await paginatedTenantQuery('products', tenantId, {
                page: parseInt(req.query.page) || 1,
                perPage: parseInt(req.query.per_page) || 20,
            });
            res.json({ success: true, ...result });
        }));

        // Create product for a specific tenant (Admin)
        router.post('/admin/tenants/:tenantId/products', asyncHandler(async (req, res) => {
            const { tenantId } = req.params;

            // Basic insert, skipping category logic for now for simplicity
            const product = await tenantInsert('products', tenantId, {
                name: req.body.name,
                description: req.body.description,
                sku: req.body.sku,
                price: req.body.price,
                track_inventory: false,
                inventory_quantity: 100,
                status: 'active', // Auto-activate
                attributes: {}
            });

            // TODO: Add a default image when product_images table is created
            // if (req.body.image_url) {
            //     await query(
            //         `INSERT INTO product_images (tenant_id, product_id, url, "order", is_primary) VALUES ($1, $2, $3, 0, true)`,
            //         [tenantId, product.id, req.body.image_url]
            //     );
            // }

            res.json({ success: true, product });
        }));

        // PRINCIPLE: All feature access is subscription-gated
        // All routes protected by subscription guard
        // TEMPORARILY DISABLED FOR TESTING - Re-enable after adding subscription during signup
        router.use(subscriptionGuard('products'));

        // ==========================================
        // CATEGORY ROUTES (Public for widgets)
        // ==========================================

        // Get all categories (PUBLIC - for storefront and widget editors)
        router.get('/categories', asyncHandler(async (req, res) => {
            const sql = `SELECT id, name, slug, description, parent_id, is_active, image_url 
                         FROM categories 
                         WHERE tenant_id = $1 AND is_active = true
                         ORDER BY name ASC`;
            const result = await query(sql, [req.tenantId]);
            res.json({ success: true, categories: result.rows });
        }));

        // List categories (Admin - Authenticated)
        // Must be before /categories/:id to prevent conflict
        router.get('/categories/all', authenticate, asyncHandler(async (req, res) => {
            // Simple fetch all (flat list)
            const result = await query(
                `SELECT * FROM categories WHERE tenant_id = $1 ORDER BY name`,
                [req.tenantId]
            );
            res.json({ success: true, categories: result.rows });
        }));

        // Get single category (PUBLIC)
        router.get('/categories/:id', asyncHandler(async (req, res) => {
            const sql = `SELECT id, name, slug, description, image_url, parent_id, is_active 
                         FROM categories 
                         WHERE id = $1 AND tenant_id = $2`;
            const result = await query(sql, [req.params.id, req.tenantId]);

            if (!result.rows[0]) {
                return res.status(404).json({ error: 'Category not found' });
            }

            res.json({ success: true, category: result.rows[0] });
        }));

        // Create category (ADMIN)
        router.post('/categories', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { name, slug, parent_id, description, image_url } = req.body;

            const sql = `INSERT INTO categories (tenant_id, name, slug, parent_id, description, image_url, is_active)
                         VALUES ($1, $2, $3, $4, $5, $6, true)
                         RETURNING *`;
            const result = await query(sql, [req.tenantId, name, slug || name.toLowerCase().replace(/\s+/g, '-'), parent_id || null, description, image_url]);

            res.status(201).json({ success: true, category: result.rows[0] });
        }));

        // Update category (ADMIN)
        router.put('/categories/:id', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { name, slug, parent_id, description, image_url, is_active } = req.body;

            const sql = `UPDATE categories 
                         SET name = COALESCE($1, name),
                             slug = COALESCE($2, slug),
                             parent_id = $3,
                             description = COALESCE($4, description),
                             image_url = COALESCE($5, image_url),
                             is_active = COALESCE($6, is_active),
                             updated_at = NOW()
                         WHERE id = $7 AND tenant_id = $8
                         RETURNING *`;
            const result = await query(sql, [name, slug, parent_id, description, image_url, is_active, req.params.id, req.tenantId]);

            if (!result.rows[0]) {
                return res.status(404).json({ error: 'Category not found' });
            }

            res.json({ success: true, category: result.rows[0] });
        }));

        // Delete category (ADMIN)
        router.delete('/categories/:id', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const sql = `DELETE FROM categories WHERE id = $1 AND tenant_id = $2 RETURNING *`;
            const result = await query(sql, [req.params.id, req.tenantId]);

            if (!result.rows[0]) {
                return res.status(404).json({ error: 'Category not found' });
            }

            res.json({ success: true, message: 'Category deleted' });
        }));



        // ==========================================
        // Attributes (Decoupled)
        // ==========================================

        // List Global Attributes
        router.get('/attributes', authenticate, asyncHandler(async (req, res) => {
            const result = await paginatedTenantQuery('attributes', req.tenantId, {});
            res.json({ success: true, ...result });
        }));

        // Create Global Attribute
        router.post('/attributes', authenticate, asyncHandler(async (req, res) => {
            const attribute = await tenantInsert('attributes', req.tenantId, {
                code: req.body.code,
                label: req.body.label,
                type: req.body.type,
                options: req.body.options || null,
                image_url: req.body.image_url
            });
            res.status(201).json({ success: true, attribute });
        }));

        // Update Global Attribute
        router.put('/attributes/:id', authenticate, asyncHandler(async (req, res) => {
            const attribute = await tenantUpdate('attributes', req.tenantId, req.params.id, {
                code: req.body.code,
                label: req.body.label,
                type: req.body.type,
                options: req.body.options || null,
                image_url: req.body.image_url
            });
            res.json({ success: true, attribute });
        }));

        // Delete Global Attribute
        router.delete('/attributes/:id', authenticate, asyncHandler(async (req, res) => {
            await tenantDelete('attributes', req.tenantId, req.params.id);
            res.json({ success: true, message: 'Attribute deleted' });
        }));

        // Get Categories for an Attribute
        router.get('/attributes/:id/categories', authenticate, asyncHandler(async (req, res) => {
            const result = await query(
                `SELECT category_id FROM category_attributes WHERE attribute_id = $1 AND tenant_id = $2`,
                [req.params.id, req.tenantId]
            );
            res.json({ success: true, category_ids: result.rows.map(r => r.category_id) });
        }));

        // Attach Attribute to Category
        router.post('/categories/:id/attributes', authenticate, asyncHandler(async (req, res) => {
            const { attribute_id, is_required } = req.body;

            await query(
                `INSERT INTO category_attributes (tenant_id, category_id, attribute_id, is_required)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (category_id, attribute_id) DO UPDATE SET is_required = EXCLUDED.is_required`,
                [req.tenantId, req.params.id, attribute_id, is_required || false]
            );

            res.json({ success: true, message: 'Attribute attached to category' });
        }));

        // Unlink Attribute
        router.delete('/categories/:id/attributes/:attrId', authenticate, asyncHandler(async (req, res) => {
            await query(
                `DELETE FROM category_attributes WHERE tenant_id = $1 AND category_id = $2 AND attribute_id = $3`,
                [req.tenantId, req.params.id, req.params.attrId]
            );
            res.json({ success: true, message: 'Attribute unlinked' });
        }));

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
            const product = await tenantInsert('products', req.tenantId, {
                name: req.body.name,
                description: req.body.description,
                sku: req.body.sku,
                price: req.body.price,
                compare_at_price: req.body.compare_at_price,
                track_inventory: req.body.track_inventory,
                inventory_quantity: req.body.inventory_quantity || 0,
                status: req.body.status || 'draft',
                attributes: req.body.attributes || {}, // Custom Fields
                is_featured: req.body.is_featured || false,
                tags: req.body.tags || [],
                seo_title: req.body.seo_title,
                seo_description: req.body.seo_description,
                handle: req.body.handle || req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                image_url: req.body.image_url
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

        // ==========================================
        // Category Routes
        // ==========================================



        // Create category
        router.post('/categories', authenticate, asyncHandler(async (req, res) => {
            const category = await tenantInsert('categories', req.tenantId, {
                name: req.body.name,
                slug: req.body.slug || req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                parent_id: req.body.parent_id || null,
                description: req.body.description,
                attributes_schema: req.body.attributes_schema || [] // [NEW] Schema Definition
            });

            res.status(201).json({ success: true, category });
        }));


        // Update category
        router.patch('/categories/:id', authenticate, asyncHandler(async (req, res) => {
            const category = await tenantUpdate('categories', req.tenantId, req.params.id, req.body);
            res.json({ success: true, category });
        }));



        // Override: Fetch Category Details (Including Attributes via Inheritance)
        router.get('/categories/:id/admin', authenticate, asyncHandler(async (req, res) => {
            const catRes = await query(`SELECT * FROM categories WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId]);
            if (!catRes.rows[0]) return res.status(404).json({ error: 'Category not found' });

            const category = catRes.rows[0];

            // Recursive CTE to fetch attributes from current category up to the root
            // Logic:
            // 1. Traverse UP the tree (child -> parent -> grandparent)
            // 2. Collect all linked attributes
            // 3. Child settings override Parent settings (DISTINCT ON id, ordered by depth)
            const sql = `
                WITH RECURSIVE category_tree AS (
                    -- Anchor: Start at the requested category
                    SELECT id, parent_id, name, 0 as depth
                    FROM categories
                    WHERE id = $1 AND tenant_id = $2
                    UNION ALL
                    -- Recursive: Go up to parent
                    SELECT c.id, c.parent_id, c.name, ct.depth + 1
                    FROM categories c
                    INNER JOIN category_tree ct ON c.id = ct.parent_id
                    WHERE c.tenant_id = $2
                )
                SELECT DISTINCT ON (a.id)
                    a.*,
                    ca.is_required,
                    ct.name as source_category_name,
                    (ct.depth > 0) as is_inherited
                FROM category_tree ct
                JOIN category_attributes ca ON ca.category_id = ct.id
                JOIN attributes a ON a.id = ca.attribute_id
                ORDER BY a.id, ct.depth ASC
            `;

            const attrRes = await query(sql, [category.id, req.tenantId]);

            category.attributes = attrRes.rows;
            res.json({ success: true, category });
        }));

        // Delete category
        router.delete('/categories/:id', authenticate, asyncHandler(async (req, res) => {
            // Check for subcategories first? Or products? 
            // For now, let's just delete (cascade handles mapping, logic handles subcats)
            await tenantDelete('categories', req.tenantId, req.params.id);
            res.json({ success: true, message: 'Category deleted' });
        }));

        // Delete product
        router.delete('/:id', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const product = await tenantDelete('products', req.tenantId, req.params.id);

            eventBus.emitEvent('product.deleted', {
                tenantId: req.tenantId,
                productId: req.params.id,
            });

            res.json({ success: true, message: 'Product deleted' });
        }));

        // ==========================================
        // Super Admin Routes (No Tenant Auth)
        // ==========================================

        // List products for a specific tenant (Admin)
        router.get('/admin/tenants/:tenantId/products', asyncHandler(async (req, res) => {
            const { tenantId } = req.params;
            const result = await paginatedTenantQuery('products', tenantId, {
                page: parseInt(req.query.page) || 1,
                perPage: parseInt(req.query.per_page) || 20,
            });
            res.json({ success: true, ...result });
        }));

        // Create product for a specific tenant (Admin)
        router.post('/admin/tenants/:tenantId/products', asyncHandler(async (req, res) => {
            const { tenantId } = req.params;

            // Basic insert, skipping category logic for now for simplicity
            const product = await tenantInsert('products', tenantId, {
                name: req.body.name,
                description: req.body.description,
                sku: req.body.sku,
                price: req.body.price,
                track_inventory: false,
                inventory_quantity: 100,
                status: 'active', // Auto-activate
                attributes: {}
            });

            // Add a default image if provided URL (Mocking image upload)
            if (req.body.image_url) {
                await query(
                    `INSERT INTO product_images (tenant_id, product_id, url, "order", is_primary) VALUES ($1, $2, $3, 0, true)`,
                    [tenantId, product.id, req.body.image_url]
                );
            }

            res.json({ success: true, product });
        }));


        app.use('/products', router);
        console.log('[Products] Module initialized');

        return true;
    } catch (error) {
        console.error('[Products] Bootstrap failed:', error);
        // PRINCIPLE: Any module can be removed without crashing the system
        return false;
    }
}

module.exports = { bootstrap };
