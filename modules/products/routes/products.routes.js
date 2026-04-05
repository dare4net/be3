/**
 * Product Routes
 * Product CRUD operations and collections
 */

const { query } = require('../../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate, tenantDelete } = require('../../../utils/dbHelpers');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const authorize = require('../../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ProductService = require('../services/ProductService');

function registerProductRoutes(router, eventBus) {
    // List products (Admin)
    router.get('/', authenticate, authorize('products.view'), asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');

        // Check permissions and vendor context
        const { categoryAccess: { hasUnrestrictedAccess, allowedCategories }, isVendor, vendorName } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);

        // If restricted, we need a custom query as dbHelpers.paginatedTenantQuery doesn't support complex joins/subqueries easily
        // If unrestricted, we use the standard helper

        if (hasUnrestrictedAccess && !isVendor) {
            const conditions = { deleted_at: null };
            if (req.query.show_variants !== 'true') {
                conditions.is_variant = false;
            }

            const result = await paginatedTenantQuery('products', req.tenantId, {
                page: parseInt(req.query.page) || 1,
                perPage: parseInt(req.query.per_page) || 20,
                conditions
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
        const showVariants = req.query.show_variants === 'true';

        // Build query for restricted products
        // Products that belong to ANY of the allowed categories
        const productsSql = `
            SELECT DISTINCT p.* 
            FROM products p
            LEFT JOIN product_categories pc ON p.id = pc.product_id
            WHERE p.tenant_id = $1 
            AND p.deleted_at IS NULL
            AND ($9::boolean OR p.is_variant = false)
            AND (NOT $5::boolean OR ${ProductService.getVendorIsolationFilter(true, vendorName, req.user.id, 6, 8)})
            AND ($7::boolean OR pc.category_id = ANY($2))
            ORDER BY p.created_at DESC
            LIMIT $3 OFFSET $4
        `;

        const countSql = `
            SELECT COUNT(DISTINCT p.id)::int as total
            FROM products p
            LEFT JOIN product_categories pc ON p.id = pc.product_id
            WHERE p.tenant_id = $1 
            AND p.deleted_at IS NULL
            AND ($7::boolean OR p.is_variant = false)
            AND (NOT $3::boolean OR ${ProductService.getVendorIsolationFilter(true, vendorName, req.user.id, 4, 6)})
            AND ($5::boolean OR pc.category_id = ANY($2))
        `;

        const shouldFilterByVendor = isVendor;

        const countRes = await query(countSql, [req.tenantId, allowedCategories, shouldFilterByVendor, vendorName, hasUnrestrictedAccess, req.user.id, showVariants]);
        const total = countRes.rows[0]?.total || 0;

        // Add user.id to params for attribute-based filtering
        const productRes = await query(productsSql, [req.tenantId, allowedCategories, perPage, offset, shouldFilterByVendor, vendorName, hasUnrestrictedAccess, req.user.id, showVariants]);
        const products = productRes.rows;

        // Resolve dynamic tags (e.g., [BUSINESS_NAME])
        await ProductService.resolve(req.tenantId, req.user.id, products);

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

        if (isVendor) {
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
        if (isVendor) {
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
            created_by: req.user.id,
            collection_type: req.body.collection_type || 'manual'
        });

        eventBus.emitEvent('collection.created', {
            tenantId: req.tenantId,
            collectionId: collection.id,
        });

        res.status(201).json({ success: true, collection });
    }));

    // Update collection
    router.put('/collections/:id', authenticate, asyncHandler(async (req, res) => {
        const { tenantId } = req;
        const collectionId = req.params.id;

        // 1. Fetch current collection to check type
        const currentRes = await query(`SELECT id, collection_type FROM collections WHERE id = $1 AND tenant_id = $2`, [collectionId, tenantId]);
        if (!currentRes.rows[0]) {
            return res.status(404).json({ error: 'Collection not found' });
        }

        const current = currentRes.rows[0];
        const updates = { ...req.body };

        // 2. Protection Logic: If it's a vendor-managed collection, don't allow manual rule changes
        if (current.collection_type === 'vendor' && updates.rules) {
            console.log(`[Products] Blocking manual rule update for vendor collection ${collectionId}`);
            delete updates.rules;
            // Also protect slug and name if they are strictly managed by Business Name
            delete updates.slug;
            delete updates.name;
        }

        const collection = await tenantUpdate('collections', tenantId, collectionId, {
            name: updates.name,
            slug: updates.slug,
            description: updates.description,
            image_url: updates.image_url,
            rules: updates.rules ? JSON.stringify(updates.rules) : undefined,
            manual_product_ids: updates.manual_product_ids,
            excluded_product_ids: updates.excluded_product_ids,
            is_active: updates.is_active,
            collection_type: updates.collection_type
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

    // Get variants of a product (by parent ID)
    router.get('/:id/variants', asyncHandler(async (req, res) => {
        // Fetch all active variants where parent_id = the given product ID
        const result = await query(
            `SELECT id, name, handle, price, compare_at_price, sku, status, image_url, variant_label, is_variant, parent_id
             FROM products
             WHERE tenant_id = $1
               AND parent_id = $2
               AND deleted_at IS NULL
             ORDER BY price ASC`,
            [req.tenantId, req.params.id]
        );
        res.json({ success: true, variants: result.rows });
    }));

    // Get product by ID
    router.get('/:id', authenticate, authorize('products.view'), asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const { isVendor, vendorName, categoryAccess: { hasUnrestrictedAccess } } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);

        let sql = `SELECT * FROM products p WHERE id = $1 AND tenant_id = $2`;
        let params = [req.params.id, req.tenantId];

        if (isVendor && vendorName) {
            sql += ` AND ${ProductService.getVendorIsolationFilter(true, vendorName, req.user.id, 3, 4)}`;
            params.push(vendorName, req.user.id);
        }

        const result = await query(sql, params);
        if (!result.rows[0]) {
            return res.status(404).json({ error: 'Product not found or access denied' });
        }

        const product = result.rows[0];

        // Resolve inheritance if this is a variant
        await ProductService.resolveInheritance(req.tenantId, product);

        // Resolve dynamic tags if they exist
        await ProductService.resolve(req.tenantId, req.user.id, product);
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

        // Construct name if it's a variant
        let productName = req.body.name || '';
        if (req.body.parent_id && req.body.variant_label) {
            const parentRes = await query(`SELECT name FROM products WHERE id = $1 AND tenant_id = $2`, [req.body.parent_id, req.tenantId]);
            if (parentRes.rows[0]) {
                productName = `${parentRes.rows[0].name} (${req.body.variant_label})`;
            }
        }

        // Generate base handle
        let handle = req.body.handle || (productName || 'product').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (!handle || handle === 'product') handle = 'product-' + Date.now(); // Fallback for empty names

        // Ensure uniqueness
        const existing = await query(`SELECT id FROM products WHERE tenant_id = $1 AND handle = $2`, [req.tenantId, handle]);
        if (existing.rows.length > 0) {
            // Handle conflict - append random string
            const randomSuffix = Math.random().toString(36).substring(2, 7);
            handle = `${handle}-${randomSuffix}`;
        }

        const tags = ProductService.sanitizeTags(req.body.tags || [], isVendor, vendorName);

        // Auto-apply system attributes
        let productAttributes = req.body.attributes || {};
        try {
            const sysAttrResult = await query(`SELECT code, default_value FROM system_attributes WHERE default_value IS NOT NULL`);
            if (sysAttrResult.rows.length > 0) {
                let VariableRegistry;
                try { VariableRegistry = require('../../variables/services/VariableRegistry'); } catch { }

                for (const sa of sysAttrResult.rows) {
                    let value = sa.default_value;
                    // Resolve variables like [BUSINESS_NAME]
                    if (VariableRegistry && value && /\[[A-Z_][A-Z0-9_]*\]/.test(value)) {
                        value = await VariableRegistry.resolveText(value, {
                            tenantId: req.tenantId,
                            userId: req.user.id
                        });
                    }
                    productAttributes[sa.code] = value;
                }
            }
        } catch (e) {
            console.warn('[Products] Could not auto-apply system attributes:', e.message);
        }

        const productData = {
            name: productName,
            description: req.body.description,
            sku: req.body.sku,
            price: req.body.price,
            compare_at_price: req.body.compare_at_price,
            track_inventory: req.body.track_inventory,
            inventory_quantity: req.body.inventory_quantity || 0,
            status: req.body.status || 'draft',
            created_by: req.user.id,
            attributes: JSON.stringify(productAttributes),
            is_featured: req.body.is_featured || false,
            tags: tags,
            seo_title: req.body.seo_title,
            seo_description: req.body.seo_description,
            handle: handle,
            image_url: req.body.image_url,
            category_id: req.body.category_id,
            // Variant Fields
            parent_id: req.body.parent_id || null,
            is_variant: !!req.body.parent_id,
            variant_label: req.body.variant_label || null,
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
        };

        const product = await tenantInsert('products', req.tenantId, productData);

        // Handle categories
        let finalCategoryIds = req.body.category_ids || [];

        // Safeguard: Inherit from parent if this is a variant and no categories provided
        if (finalCategoryIds.length === 0 && productData.parent_id) {
            const parentCats = await query(`SELECT category_id FROM product_categories WHERE product_id = $1 AND tenant_id = $2`, [productData.parent_id, req.tenantId]);
            finalCategoryIds = parentCats.rows.map(r => r.category_id);

            // Also ensure the primary category_id on the product row is updated if it was null
            if (finalCategoryIds.length > 0 && !productData.category_id) {
                await query(`UPDATE products SET category_id = $1 WHERE id = $2 AND tenant_id = $3`, [finalCategoryIds[0], product.id, req.tenantId]);
            }
        }

        if (finalCategoryIds && Array.isArray(finalCategoryIds)) {
            for (const catId of finalCategoryIds) {
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
        if (isVendor && vendorName) {
            const check = await query(`SELECT id FROM products p WHERE id = $1 AND tenant_id = $2 AND ${ProductService.getVendorIsolationFilter(true, vendorName, req.user.id, 3, 4)}`, [req.params.id, req.tenantId, vendorName, req.user.id]);
            if (check.rows.length === 0) {
                return res.status(403).json({ error: 'Access denied: You do not own this product' });
            }

            // Ensure dynamic vendor tag remains and is sanitized
            updateData.tags = ProductService.sanitizeTags(updateData.tags || [], isVendor, vendorName);
        }

        // If variant_label is updated, automatically synchronize the full product name
        if (updateData.variant_label) {
            const currentRes = await query(`SELECT parent_id FROM products WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId]);
            const current = currentRes.rows[0];
            if (current && current.parent_id) {
                const parentRes = await query(`SELECT name FROM products WHERE id = $1 AND tenant_id = $2`, [current.parent_id, req.tenantId]);
                if (parentRes.rows[0]) {
                    updateData.name = `${parentRes.rows[0].name} (${updateData.variant_label})`;
                }
            }
        }

        const product = await tenantUpdate('products', req.tenantId, req.params.id, updateData);

        // If parent name was updated, propagate to all variants
        if (updateData.name) {
            const variants = await query(
                `SELECT id, variant_label FROM products WHERE parent_id = $1 AND tenant_id = $2`,
                [product.id, req.tenantId]
            );
            for (const v of variants.rows) {
                if (v.variant_label) {
                    const newName = `${product.name} (${v.variant_label})`;
                    await query(`UPDATE products SET name = $1 WHERE id = $2`, [newName, v.id]);
                }
            }
        }

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

    // Delete product (Soft delete)
    router.delete('/:id', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const { isVendor, vendorName } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);

        // Security check for vendor ownership
        if (isVendor && vendorName) {
            const check = await query(`SELECT id FROM products p WHERE id = $1 AND tenant_id = $2 AND ${ProductService.getVendorIsolationFilter(true, vendorName, req.user.id, 3, 4)}`, [req.params.id, req.tenantId, vendorName, req.user.id]);
            if (check.rows.length === 0) {
                return res.status(403).json({ error: 'Access denied: You do not own this product' });
            }
        }

        // Soft delete the product
        await query(`UPDATE products SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId]);

        // Cascade soft delete to variants
        await ProductService.cascadeSoftDelete(req.tenantId, req.params.id);

        eventBus.emitEvent('product.deleted', {
            tenant_id: req.tenantId,
            product_id: req.params.id,
        });

        res.json({ success: true, message: 'Product deleted' });
    }));

    // List variants for a parent
    router.get('/:id/variants', authenticate, authorize('products.view'), asyncHandler(async (req, res) => {
        const result = await query(
            `SELECT * FROM products WHERE parent_id = $1 AND tenant_id = $2 AND deleted_at IS NULL ORDER BY created_at ASC`,
            [req.params.id, req.tenantId]
        );
        res.json({ success: true, variants: result.rows });
    }));
}

module.exports = { registerProductRoutes };
