/**
 * Category Routes
 * Category management endpoints (PUBLIC and ADMIN)
 */

const { query } = require('../../../config/database');
const { tenantInsert, tenantUpdate } = require('../../../utils/dbHelpers');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const authorize = require('../../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ProductService = require('../services/ProductService');
const MediaInterceptor = require('../../media/services/MediaInterceptor');

function registerCategoryRoutes(router, eventBus) {
    // Get all categories (PUBLIC - for storefront and widget editors)
    router.get('/categories', asyncHandler(async (req, res) => {
        // 1. Get Categories with Direct Product Count
        const sql = `
            SELECT 
                c.id, c.name, c.slug, c.description, c.parent_id, c.is_active, c.image_url,
                COUNT(pc.product_id)::int as direct_product_count
            FROM categories c
            LEFT JOIN product_categories pc ON c.id = pc.category_id
            LEFT JOIN products p ON pc.product_id = p.id AND p.status = 'active' -- Only count active products
            WHERE c.tenant_id = $1 AND c.is_active = true
            GROUP BY c.id
            ORDER BY c.name ASC
        `;
        const result = await query(sql, [req.tenantId]);
        const categories = result.rows;

        // 2. Build Tree / Map for O(1) lookups
        const categoryMap = new Map();
        categories.forEach(cat => {
            cat.product_count = cat.direct_product_count; // Initialize with direct count
            cat.children = [];
            categoryMap.set(cat.id, cat);
        });

        // 3. Link Children to Parents
        categories.forEach(cat => {
            if (cat.parent_id && categoryMap.has(cat.parent_id)) {
                categoryMap.get(cat.parent_id).children.push(cat);
            }
        });

        // 4. Recursive Count Aggregation
        // function to get total count (memoized implicitly by modifying objects)
        const getRecursiveCount = (cat) => {
            let total = cat.direct_product_count;
            for (const child of cat.children) {
                total += getRecursiveCount(child);
            }
            cat.product_count = total; // Update with aggregated total
            return total;
        };

        // Calculate for all top-level categories (others will get calculated recursively)
        categories.forEach(cat => {
            if (!cat.parent_id) {
                getRecursiveCount(cat);
            }
        });

        // Clean up circular references if needed (or just send flat list with updated counts)
        const flatResult = categories.map(cat => {
            const { children, ...rest } = cat;
            return rest; // Return flat list, but with updated product_count
        });

        res.json({ success: true, categories: flatResult });
    }));

    // List categories (Admin - Authenticated)
    // Must be before /categories/:id to prevent conflict
    router.get('/categories/all', authenticate, asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const { hasUnrestrictedAccess, allowedCategories } = await PermissionService.getUserCategoryAccess(req.tenantId, req.user.id);

        let sql = `SELECT * FROM categories WHERE tenant_id = $1`;
        const params = [req.tenantId];

        if (!hasUnrestrictedAccess) {
            sql += ` AND id = ANY($2)`;
            params.push(allowedCategories);
        }

        sql += ` ORDER BY name`;

        const result = await query(sql, params);
        res.json({ success: true, categories: result.rows });
    }));

    // Get top-level categories only (Admin - for hierarchical navigation)
    router.get('/categories/top-level', authenticate, asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const { hasUnrestrictedAccess, allowedCategories } = await PermissionService.getUserCategoryAccess(req.tenantId, req.user.id);

        const params = [req.tenantId];
        let whereClause = `c.tenant_id = $1 AND c.parent_id IS NULL`;

        // If restricted, we need to be careful. 
        // A "top level" category for a restricted user might be a subcategory in the global tree.
        // OR we simply show only the allowed categories that happen to be top level.
        // Usually, if a user is assigned a subcategory, they should see it as a "root" in their view or see the path to it?
        // For simplicity and security: Show only allowed categories that are top-level. 
        // If a user is assigned ONLY a subcategory, this endpoint might return nothing if we strict filter for parent_id IS NULL.
        // BETTER APPROACH: Return allowed categories that have NO allowed parent.
        // But for now, let's just filter the standard top-level query.

        if (!hasUnrestrictedAccess) {
            // If user is restricted, we'll just return the logical roots of their allowed tree
            // i.e. categories they have access to where they DON'T have access to the parent
            // logic: select * from categories where id IN allowed AND (parent_id IS NULL OR parent_id NOT IN allowed)

            // Dynamic SQL is safer here
            const result = await query(
                `SELECT 
                    c.id, c.name, c.slug, c.description, c.image_url, c.is_active,
                    COUNT(DISTINCT pc.product_id)::int as product_count,
                    COUNT(DISTINCT child.id)::int as subcategory_count,
                    EXISTS(SELECT 1 FROM categories WHERE parent_id = c.id AND tenant_id = $1) as has_children
                FROM categories c
                LEFT JOIN product_categories pc ON c.id = pc.category_id
                LEFT JOIN categories child ON child.parent_id = c.id AND child.tenant_id = $1
                WHERE c.tenant_id = $1 
                AND c.id = ANY($2)
                AND (c.parent_id IS NULL OR NOT (c.parent_id = ANY($2)))
                GROUP BY c.id
                ORDER BY c.name ASC`,
                [req.tenantId, allowedCategories]
            );
            return res.json({ success: true, categories: result.rows });
        }

        const sql = `
            SELECT 
                c.id, c.name, c.slug, c.description, c.image_url, c.is_active,
                COUNT(DISTINCT pc.product_id)::int as product_count,
                COUNT(DISTINCT child.id)::int as subcategory_count,
                EXISTS(SELECT 1 FROM categories WHERE parent_id = c.id AND tenant_id = $1) as has_children
            FROM categories c
            LEFT JOIN product_categories pc ON c.id = pc.category_id
            LEFT JOIN categories child ON child.parent_id = c.id AND child.tenant_id = $1
            WHERE c.tenant_id = $1 AND c.parent_id IS NULL
            GROUP BY c.id
            ORDER BY c.name ASC
        `;
        const result = await query(sql, [req.tenantId]);
        res.json({ success: true, categories: result.rows });
    }));

    // Get categories where the vendor currently has products (from ledger)
    router.get('/categories/vendor-active', authenticate, asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const { isVendor, vendorName, roles } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);
        
        const isAdmin = roles.some(r => r.name === 'Admin' || r.name === 'Super Admin' || r === 'Admin' || r === 'Super Admin');

        // If Admin, return all active categories
        if (isAdmin) {
            const sql = `SELECT * FROM categories WHERE tenant_id = $1 AND is_active = true ORDER BY name`;
            const result = await query(sql, [req.tenantId]);
            return res.json({ success: true, categories: result.rows });
        }

        // If Vendor, return only categories from their ledger
        const sql = `
            SELECT c.id, c.name, c.slug, c.image_url, vcl.product_count 
            FROM categories c
            JOIN vendor_category_ledger vcl ON c.id = vcl.category_id
            WHERE c.tenant_id = $1 
            AND vcl.tenant_id = $1
            AND (vcl.vendor_id = $2 OR vcl.vendor_name = $3)
            AND vcl.product_count > 0
            AND c.is_active = true
            ORDER BY c.name
        `;
        const result = await query(sql, [req.tenantId, req.user.id, vendorName]);
        res.json({ success: true, categories: result.rows });
    }));

    // Get children of a specific category (Admin - for hierarchical navigation)
    router.get('/categories/:id/children', authenticate, asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const { hasUnrestrictedAccess, allowedCategories } = await PermissionService.getUserCategoryAccess(req.tenantId, req.user.id);

        // Security check: Can user view the parent?
        if (!hasUnrestrictedAccess && !allowedCategories.some(id => id == req.params.id)) {
            // If user can't see parent, they shouldn't be asking for children, but maybe they have access to children?
            // Usually tree navigation implies access to node.
            // For strict security: deny.
            return res.status(403).json({ error: 'Access denied to this category' });
        }

        const params = [req.tenantId, req.params.id];
        let filterClause = "";

        if (!hasUnrestrictedAccess) {
            filterClause = `AND c.id = ANY($3)`;
            params.push(allowedCategories);
        }

        const sql = `
            SELECT 
                c.id, c.name, c.slug, c.description, c.image_url, c.parent_id, c.is_active,
                COUNT(DISTINCT pc.product_id)::int as product_count,
                COUNT(DISTINCT child.id)::int as subcategory_count,
                EXISTS(SELECT 1 FROM categories WHERE parent_id = c.id AND tenant_id = $1) as has_children
            FROM categories c
            LEFT JOIN product_categories pc ON c.id = pc.category_id
            LEFT JOIN categories child ON child.parent_id = c.id AND child.tenant_id = $1
            WHERE c.tenant_id = $1 AND c.parent_id = $2
            ${filterClause}
            GROUP BY c.id
            ORDER BY c.name ASC
        `;
        const result = await query(sql, params);
        res.json({ success: true, categories: result.rows });
    }));

    // Get comprehensive category details (Admin - for detail panel)
    router.get('/categories/:id/details', authenticate, asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const categoryId = req.params.id;

        // Permission Check
        const { isVendor, vendorName, categoryAccess: { hasUnrestrictedAccess, allowedCategories } } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);
        if (!hasUnrestrictedAccess && !allowedCategories.some(id => id == categoryId)) {
            return res.status(403).json({ error: 'Access denied to this category' });
        }

        try {
            // 1. Get basic category info
            const categoryRes = await query(
                `SELECT * FROM categories WHERE id = $1 AND tenant_id = $2`,
                [categoryId, req.tenantId]
            );

            if (!categoryRes.rows[0]) {
                return res.status(404).json({ error: 'Category not found' });
            }

            const category = categoryRes.rows[0];

            // 2. Get product counts (direct and total with descendants)
            const productCountSql = `
                WITH RECURSIVE category_tree AS (
                    SELECT id, 0 as depth FROM categories WHERE id = $1 AND tenant_id = $2
                    UNION ALL
                    SELECT c.id, ct.depth + 1 FROM categories c
                    INNER JOIN category_tree ct ON c.parent_id = ct.id
                    WHERE c.tenant_id = $2 AND ct.depth < 10
                )
                SELECT 
                    COUNT(DISTINCT CASE WHEN pc.category_id = $1 THEN pc.product_id END)::int as direct_product_count,
                    COUNT(DISTINCT pc.product_id)::int as total_product_count
                FROM category_tree ct
                LEFT JOIN product_categories pc ON pc.category_id = ct.id
                JOIN products p ON p.id = pc.product_id
                WHERE p.tenant_id = $2
                AND (NOT $3::boolean OR ${ProductService.getVendorIsolationFilter(true, vendorName, req.user.id, 4, 5)})
            `;
            const countRes = await query(productCountSql, [categoryId, req.tenantId, isVendor, vendorName, req.user.id]);
            category.direct_product_count = countRes.rows[0]?.direct_product_count || 0;
            category.total_product_count = countRes.rows[0]?.total_product_count || 0;

            // 3. Get subcategories
            const subcategoriesRes = await query(
                `SELECT id, name, slug, image_url FROM categories WHERE parent_id = $1 AND tenant_id = $2 ORDER BY name`,
                [categoryId, req.tenantId]
            );
            category.subcategories = subcategoriesRes.rows;

            // 4. Get linked attributes (with inheritance and clauses)
            try {
                const attributesSql = `
                    WITH RECURSIVE category_tree AS (
                        SELECT id, parent_id, name, 0 as depth
                        FROM categories
                        WHERE id = $1 AND tenant_id = $2
                        UNION ALL
                        SELECT c.id, c.parent_id, c.name, ct.depth + 1
                        FROM categories c
                        INNER JOIN category_tree ct ON c.id = ct.parent_id
                        WHERE c.tenant_id = $2 AND ct.depth < 10
                    )
                    SELECT DISTINCT ON (a.id)
                        a.id, a.code, a.label, a.type, a.image_url, a.clauses, a.options, a.allow_custom,
                        ca.is_required, ca.is_ignored,
                        ct.name as source_category_name,
                        (ct.depth > 0) as is_inherited
                    FROM category_tree ct
                    JOIN category_attributes ca ON ca.category_id = ct.id
                    JOIN attributes a ON a.id = ca.attribute_id
                    WHERE a.tenant_id = $2
                    ORDER BY a.id, ct.depth ASC
                `;
                const attributesRes = await query(attributesSql, [categoryId, req.tenantId]);
                category.attributes = attributesRes.rows || [];
            } catch (attrError) {
                console.error('Error fetching attributes:', attrError);
                console.error('SQL Error details:', attrError.message);
                category.attributes = [];
            }

            // 5. Get recent products (limit 10) - from category tree with direct products first
            try {
                const productsRes = await query(
                    `WITH RECURSIVE category_tree AS (
                        SELECT id, 0 as depth FROM categories WHERE id = $1 AND tenant_id = $2
                        UNION ALL
                        SELECT c.id, ct.depth + 1 FROM categories c
                        INNER JOIN category_tree ct ON c.parent_id = ct.id
                        WHERE c.tenant_id = $2 AND ct.depth < 10
                    )
                    SELECT p.id, p.name, p.image_url, p.price, p.status,
                           CASE WHEN pc.category_id = $1 THEN 0 ELSE 1 END as sort_order
                    FROM products p
                    JOIN product_categories pc ON p.id = pc.product_id
                    JOIN category_tree ct ON pc.category_id = ct.id
                    WHERE p.tenant_id = $2
                    AND (NOT $3::boolean OR ${ProductService.getVendorIsolationFilter(true, vendorName, req.user.id, 4, 5)})
                    ORDER BY sort_order ASC, p.created_at DESC
                    LIMIT 10`,
                    [categoryId, req.tenantId, isVendor, vendorName, req.user.id]
                );
                const recentProducts = productsRes.rows || [];

                // Resolve dynamic tags for recent products
                await ProductService.resolve(req.tenantId, req.user.id, recentProducts);

                category.recent_products = recentProducts;
            } catch (prodError) {
                console.error('Error fetching products:', prodError);
                category.recent_products = [];
            }

            // 6. Get breadcrumb path
            try {
                const breadcrumbSql = `
                    WITH RECURSIVE category_path AS (
                        SELECT id, name, parent_id, 0 as level
                        FROM categories
                        WHERE id = $1 AND tenant_id = $2
                        UNION ALL
                        SELECT c.id, c.name, c.parent_id, cp.level + 1
                        FROM categories c
                        INNER JOIN category_path cp ON c.id = cp.parent_id
                        WHERE c.tenant_id = $2 AND cp.level < 10
                    )
                    SELECT id, name FROM category_path ORDER BY level DESC
                `;
                const breadcrumbRes = await query(breadcrumbSql, [categoryId, req.tenantId]);
                category.breadcrumb = breadcrumbRes.rows || [];
            } catch (breadError) {
                console.error('Error fetching breadcrumb:', breadError);
                category.breadcrumb = [{ id: category.id, name: category.name }];
            }

            res.json({ success: true, category });
        } catch (error) {
            console.error('Error in category details endpoint:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch category details',
                message: error.message
            });
        }
    }));

    // Get category details for Admin Product Editor (Lightweight + Attributes)
    router.get('/categories/:id/admin', authenticate, asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const categoryId = req.params.id;

        // Permission Check
        const { hasUnrestrictedAccess, allowedCategories } = await PermissionService.getUserCategoryAccess(req.tenantId, req.user.id);
        if (!hasUnrestrictedAccess && !allowedCategories.some(id => id == categoryId)) {
            return res.status(403).json({ error: 'Access denied to this category' });
        }

        try {
            // 1. Get basic category info
            const categoryRes = await query(
                `SELECT * FROM categories WHERE id = $1 AND tenant_id = $2`,
                [categoryId, req.tenantId]
            );

            if (!categoryRes.rows[0]) {
                return res.status(404).json({ error: 'Category not found' });
            }

            const category = categoryRes.rows[0];

            // 2. Get linked attributes (with inheritance and clauses) - CRITICAL for product editor
            try {
                const attributesSql = `
                    WITH RECURSIVE category_tree AS (
                        SELECT id, parent_id, name, 0 as depth
                        FROM categories
                        WHERE id = $1 AND tenant_id = $2
                        UNION ALL
                        SELECT c.id, c.parent_id, c.name, ct.depth + 1
                        FROM categories c
                        INNER JOIN category_tree ct ON c.id = ct.parent_id
                        WHERE c.tenant_id = $2 AND ct.depth < 10
                    )
                    SELECT DISTINCT ON (a.id)
                        a.id, a.code, a.label, a.type, a.image_url, a.clauses, a.options, a.allow_custom,
                        ca.is_required, ca.is_ignored,
                        ct.name as source_category_name,
                        (ct.depth > 0) as is_inherited
                    FROM category_tree ct
                    JOIN category_attributes ca ON ca.category_id = ct.id
                    JOIN attributes a ON a.id = ca.attribute_id
                    WHERE a.tenant_id = $2
                    ORDER BY a.id, ct.depth ASC
                `;
                const attributesRes = await query(attributesSql, [categoryId, req.tenantId]);
                category.attributes = attributesRes.rows || [];
            } catch (attrError) {
                console.error('Error fetching attributes:', attrError);
                category.attributes = [];
            }

            // 3. Get breadcrumb path (useful for UI context)
            try {
                const breadcrumbSql = `
                    WITH RECURSIVE category_path AS (
                        SELECT id, name, parent_id, 0 as level
                        FROM categories
                        WHERE id = $1 AND tenant_id = $2
                        UNION ALL
                        SELECT c.id, c.name, c.parent_id, cp.level + 1
                        FROM categories c
                        INNER JOIN category_path cp ON c.id = cp.parent_id
                        WHERE c.tenant_id = $2 AND cp.level < 10
                    )
                    SELECT id, name FROM category_path ORDER BY level DESC
                `;
                const breadcrumbRes = await query(breadcrumbSql, [categoryId, req.tenantId]);
                category.breadcrumb = breadcrumbRes.rows || [];
            } catch (breadError) {
                category.breadcrumb = [{ id: category.id, name: category.name }];
            }

            res.json({ success: true, category });
        } catch (error) {
            console.error('Error in category admin endpoint:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch category details',
                message: error.message
            });
        }
    }));

    // Get paginated products for a category (including subcategories)
    router.get('/categories/:id/products', authenticate, asyncHandler(async (req, res) => {
        const PermissionService = require('../../../platform/core/roles/services/PermissionService');
        const categoryId = req.params.id;

        // Permission Check
        const { isVendor, vendorName, categoryAccess: { hasUnrestrictedAccess, allowedCategories } } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);
        if (!hasUnrestrictedAccess && !allowedCategories.some(id => id == categoryId)) {
            return res.status(403).json({ error: 'Access denied to this category' });
        }
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 20;
        const offset = (page - 1) * perPage;

        try {
            // Get total count
            const countSql = `
                WITH RECURSIVE category_tree AS (
                    SELECT id, 0 as depth FROM categories WHERE id = $1 AND tenant_id = $2
                    UNION ALL
                    SELECT c.id, ct.depth + 1 FROM categories c
                    INNER JOIN category_tree ct ON c.parent_id = ct.id
                    WHERE c.tenant_id = $2 AND ct.depth < 10
                )
                SELECT COUNT(DISTINCT p.id)::int as total
                FROM products p
                JOIN product_categories pc ON p.id = pc.product_id
                JOIN category_tree ct ON pc.category_id = ct.id
                WHERE p.tenant_id = $2
                AND (NOT $3::boolean OR ${ProductService.getVendorIsolationFilter(true, vendorName, req.user.id, 4, 5)})
            `;
            const countRes = await query(countSql, [categoryId, req.tenantId, isVendor, vendorName, req.user.id]);
            const total = countRes.rows[0]?.total || 0;

            // Get paginated products (direct products first)
            const productsSql = `
                WITH RECURSIVE category_tree AS (
                    SELECT id, 0 as depth FROM categories WHERE id = $1 AND tenant_id = $2
                    UNION ALL
                    SELECT c.id, ct.depth + 1 FROM categories c
                    INNER JOIN category_tree ct ON c.parent_id = ct.id
                    WHERE c.tenant_id = $2 AND ct.depth < 10
                )
                SELECT DISTINCT ON (p.id)
                    p.id, p.name, p.image_url, p.price, p.status, p.sku,
                    CASE WHEN pc.category_id = $1 THEN 0 ELSE 1 END as sort_order,
                    c.name as category_name
                FROM products p
                JOIN product_categories pc ON p.id = pc.product_id
                JOIN category_tree ct ON pc.category_id = ct.id
                JOIN categories c ON pc.category_id = c.id
                WHERE p.tenant_id = $2
                AND (NOT $5::boolean OR ${ProductService.getVendorIsolationFilter(true, vendorName, req.user.id, 6, 7)})
                ORDER BY p.id, sort_order ASC
                OFFSET $3 LIMIT $4
            `;
            const productsRes = await query(productsSql, [categoryId, req.tenantId, offset, perPage, isVendor, vendorName, req.user.id]);

            // Resolve dynamic tags for products list
            await ProductService.resolve(req.tenantId, req.user.id, productsRes.rows);

            // Sort by sort_order
            const products = productsRes.rows.sort((a, b) => {
                if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
                return b.id - a.id;
            });

            res.json({
                success: true,
                products,
                pagination: {
                    page,
                    perPage,
                    total,
                    totalPages: Math.ceil(total / perPage)
                }
            });
        } catch (error) {
            console.error('Error in paginated products endpoint:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch products',
                message: error.message
            });
        }
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
        // Intercept and mirror image_url
        await MediaInterceptor.intercept(req.body, 'categories');
        await MediaInterceptor.interceptSeo(req.body, 'categories/seo');

        const category = await tenantInsert('categories', req.tenantId, {
            name: req.body.name,
            slug: req.body.slug || req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            parent_id: req.body.parent_id || null,
            description: req.body.description,
            image_url: req.body.image_url,
            is_active: true,
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
        // PRINCIPLE: All inter-module communication is event-based
        eventBus.emitEvent('category.created', {
            tenantId: req.tenantId,
            categoryId: category.id,
            name: category.name,
        });

        res.status(201).json({ success: true, category });
    }));

    // Update category (ADMIN)
    router.put('/categories/:id', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { tenantId } = req;

        // Get old category for cleanup
        const oldCatRes = await query(`SELECT image_url FROM categories WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
        const oldUrl = oldCatRes.rows[0]?.image_url;

        // Intercept and mirror image_url
        await MediaInterceptor.intercept(req.body, 'categories', 'image_url', oldUrl);
        await MediaInterceptor.interceptSeo(req.body, 'categories/seo');

        // Note: Router is mounted at /products, so this becomes /products/categories/:id
        const category = await tenantUpdate('categories', tenantId, id, req.body);

        eventBus.emitEvent('category.updated', {
            tenantId: req.tenantId,
            categoryId: category.id,
        });

        res.json({ success: true, category });
    }));

    // Delete category (ADMIN)
    router.delete('/categories/:id', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
        const sql = `DELETE FROM categories WHERE id = $1 AND tenant_id = $2 RETURNING *`;
        const result = await query(sql, [req.params.id, req.tenantId]);

        if (!result.rows[0]) {
            return res.status(404).json({ error: 'Category not found' });
        }

        eventBus.emitEvent('category.deleted', {
            tenantId: req.tenantId,
            categoryId: req.params.id,
        });

        res.json({ success: true, message: 'Category deleted' });
    }));
}

module.exports = { registerCategoryRoutes };
