/**
 * Product Routes
 * Product CRUD operations and collections
 */

const { query } = require('../../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate, tenantDelete } = require('../../../utils/dbHelpers');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const authorize = require('../../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../../middleware/errorHandler');

function registerProductRoutes(router, eventBus) {
    // List products (Admin)
    router.get('/', authenticate, authorize('products.view'), asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');

        // Check permissions and vendor context
        const { categoryAccess: { hasUnrestrictedAccess, allowedCategories }, isVendor, vendorName } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);

        // If restricted, we need a custom query as dbHelpers.paginatedTenantQuery doesn't support complex joins/subqueries easily
        // If unrestricted, we use the standard helper

        if (hasUnrestrictedAccess && !isVendor) {
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
            return res.json({ success: true, ...result });
        }

        // Restricted Access Logic
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 20;
        const offset = (page - 1) * perPage;

        // Build query for restricted products
        // Products that belong to ANY of the allowed categories
        const productsSql = `
            SELECT DISTINCT p.* 
            FROM products p
            LEFT JOIN product_categories pc ON p.id = pc.product_id
            WHERE p.tenant_id = $1 
            AND (NOT $5::boolean OR p.tags @> ARRAY[$6]::text[])
            AND ($7::boolean OR pc.category_id = ANY($2))
            ORDER BY p.created_at DESC
            LIMIT $3 OFFSET $4
        `;

        const countSql = `
            SELECT COUNT(DISTINCT p.id)::int as total
            FROM products p
            LEFT JOIN product_categories pc ON p.id = pc.product_id
            WHERE p.tenant_id = $1 
            AND (NOT $3::boolean OR p.tags @> ARRAY[$4]::text[])
            AND ($5::boolean OR pc.category_id = ANY($2))
        `;

        const shouldFilterByVendor = isVendor && !hasUnrestrictedAccess;

        const countRes = await query(countSql, [req.tenantId, allowedCategories, shouldFilterByVendor, vendorName, hasUnrestrictedAccess]);
        const total = countRes.rows[0]?.total || 0;

        const productRes = await query(productsSql, [req.tenantId, allowedCategories, perPage, offset, shouldFilterByVendor, vendorName, hasUnrestrictedAccess]);
        const products = productRes.rows;

        // Fetch categories for each product
        for (let product of products) {
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
            data: products,
            pagination: {
                page,
                perPage,
                total,
                totalPages: Math.ceil(total / perPage)
            }
        });
    }));

    // List all collections (Public/Admin light)
    router.get('/collections', authenticate, asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const { isVendor, categoryAccess: { hasUnrestrictedAccess } } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);

        let sql = `SELECT c.id, c.name, c.slug, c.image_url,
                (cardinality(c.manual_product_ids) + CASE WHEN jsonb_array_length(c.rules) > 0 THEN 1 ELSE 0 END) as product_count
             FROM collections c 
             WHERE c.tenant_id = $1 AND c.is_active = true`;
        const params = [req.tenantId];

        if (isVendor && !hasUnrestrictedAccess) {
            sql += ` AND c.created_by = $2`;
            params.push(req.user.id);
        }

        sql += ` ORDER BY name ASC`;

        const result = await query(sql, params);
        res.json({ success: true, collections: result.rows });
    }));

    // ==========================================
    // Collections Management (Admin)
    // ==========================================

    // List collections (Admin with pagination)
    router.get('/collections/admin', authenticate, asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const { isVendor, categoryAccess: { hasUnrestrictedAccess } } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);

        const conditions = {};
        if (isVendor && !hasUnrestrictedAccess) {
            conditions.created_by = req.user.id;
        }

        const result = await paginatedTenantQuery('collections', req.tenantId, {
            page: parseInt(req.query.page) || 1,
            perPage: parseInt(req.query.per_page) || 50,
            conditions
        });
        res.json({ success: true, ...result });
    }));

    // Get single collection
    router.get('/collections/:id', authenticate, asyncHandler(async (req, res) => {
        const resCol = await query(`SELECT * FROM collections WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId]);
        if (!resCol.rows[0]) return res.status(404).json({ error: 'Collection not found' });
        res.json({ success: true, collection: resCol.rows[0] });
    }));

    // Create collection
    router.post('/collections', authenticate, asyncHandler(async (req, res) => {
        const collection = await tenantInsert('collections', req.tenantId, {
            name: req.body.name,
            slug: req.body.slug,
            description: req.body.description,
            image_url: req.body.image_url,
            rules: req.body.rules ? JSON.stringify(req.body.rules) : '[]',
            manual_product_ids: req.body.manual_product_ids || [],
            excluded_product_ids: req.body.excluded_product_ids || [],
            is_active: req.body.is_active !== undefined ? req.body.is_active : true,
            created_by: req.user.id
        });

        eventBus.emitEvent('collection.created', {
            tenantId: req.tenantId,
            collectionId: collection.id,
        });

        res.status(201).json({ success: true, collection });
    }));

    // Update collection
    router.put('/collections/:id', authenticate, asyncHandler(async (req, res) => {
        const collection = await tenantUpdate('collections', req.tenantId, req.params.id, {
            name: req.body.name,
            slug: req.body.slug,
            description: req.body.description,
            image_url: req.body.image_url,
            rules: req.body.rules ? JSON.stringify(req.body.rules) : undefined,
            manual_product_ids: req.body.manual_product_ids,
            excluded_product_ids: req.body.excluded_product_ids,
            is_active: req.body.is_active
        });

        eventBus.emitEvent('collection.updated', {
            tenantId: req.tenantId,
            collectionId: collection.id,
        });

        res.json({ success: true, collection });
    }));

    // Delete collection
    router.delete('/collections/:id', authenticate, asyncHandler(async (req, res) => {
        await tenantDelete('collections', req.tenantId, req.params.id);

        eventBus.emitEvent('collection.deleted', {
            tenantId: req.tenantId,
            collectionId: req.params.id,
        });

        res.json({ success: true, message: 'Collection deleted' });
    }));

    // Get product by ID
    router.get('/:id', authenticate, authorize('products.view'), asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const { isVendor, vendorName, categoryAccess: { hasUnrestrictedAccess } } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);

        let sql = `SELECT * FROM products WHERE id = $1 AND tenant_id = $2`;
        let params = [req.params.id, req.tenantId];

        if (isVendor && vendorName && !hasUnrestrictedAccess) {
            sql += ` AND (tags @> ARRAY[$3]::text[] OR created_by = $4)`;
            params.push(vendorName, req.user.id);
        }

        const result = await query(sql, params);
        if (!result.rows[0]) {
            return res.status(404).json({ error: 'Product not found or access denied' });
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
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const { isVendor, vendorName, categoryAccess: { hasUnrestrictedAccess } } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);

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

        const tags = req.body.tags || [];
        if (isVendor && vendorName && !hasUnrestrictedAccess && !tags.includes(vendorName)) {
            tags.push(vendorName);
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
            created_by: req.user.id,
            attributes: req.body.attributes ? JSON.stringify(req.body.attributes) : '{}', // Custom Fields
            is_featured: req.body.is_featured || false,
            tags: tags,
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

        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const { isVendor, vendorName, categoryAccess: { hasUnrestrictedAccess } } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);

        // Security check for vendor ownership
        if (isVendor && vendorName && !hasUnrestrictedAccess) {
            const check = await query(`SELECT id FROM products WHERE id = $1 AND tenant_id = $2 AND (tags @> ARRAY[$3]::text[] OR created_by = $4)`, [req.params.id, req.tenantId, vendorName, req.user.id]);
            if (check.rows.length === 0) {
                return res.status(403).json({ error: 'Access denied: You do not own this product' });
            }

            // Ensure vendor tag remains
            if (updateData.tags && Array.isArray(updateData.tags)) {
                if (!updateData.tags.includes(vendorName)) {
                    updateData.tags.push(vendorName);
                }
            }
        }

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
