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
const { mergeProductSEO, mergeCategorySEO } = require('../../lib/seoHelpers');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();

        // ==========================================
        // Public Routes (No Auth, No Subscription)
        // ==========================================

        // PUBLIC STOREFRONT ENDPOINT (No Auth, but requires Subscription/Module Access)
        router.get('/storefront', subscriptionGuard('products'), asyncHandler(async (req, res) => {
            const { featured, category, category_id, limit, exclude, sort } = req.query;
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

            if (category_id || category) {
                const catParam = category_id || category;
                const field = category_id ? 'id' : 'slug';

                queryParams.push(catParam);
                const catIndex = queryParams.length;

                whereConditions.push(`EXISTS (
                    SELECT 1 FROM product_categories pc
                    WHERE pc.product_id = p.id AND pc.category_id IN (
                        WITH RECURSIVE cat_tree AS (
                            SELECT id FROM categories WHERE ${field} = $${catIndex} AND tenant_id = $1
                            UNION ALL
                            SELECT c.id FROM categories c
                            INNER JOIN cat_tree ct ON c.parent_id = ct.id
                            WHERE c.tenant_id = $1
                        )
                        SELECT id FROM cat_tree
                    )
                )`);
            }

            const whereSQL = whereConditions.join(' AND ');

            // Determine Sort Order
            let orderBy = 'p.created_at DESC';
            if (sort === 'oldest') orderBy = 'p.created_at ASC';
            else if (sort === 'price_asc') orderBy = 'p.price ASC';
            else if (sort === 'price_desc') orderBy = 'p.price DESC';
            else if (sort === 'name_asc') orderBy = 'p.name ASC';
            else if (sort === 'name_desc') orderBy = 'p.name DESC';
            else if (sort === 'random') orderBy = 'RANDOM()';
            else if (sort === 'trending') orderBy = 'p.is_featured DESC, p.created_at DESC';

            // Get products with filters
            const productsSQL = `
                SELECT p.* FROM products p
                WHERE ${whereSQL}
                ORDER BY ${orderBy}
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

            // Fetch category context for metadata/titles if filtered
            let categoryMetadata = null;
            if (category_id || category) {
                const catParam = category_id || category;
                const field = category_id ? 'id' : 'slug';
                const catRes = await query(
                    `SELECT id, name, slug FROM categories WHERE ${field} = $1 AND tenant_id = $2`,
                    [catParam, req.tenantId]
                );
                categoryMetadata = catRes.rows[0] || null;
            }

            res.json({
                success: true,
                data: result.rows,
                category: categoryMetadata,
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
            // Resolve attribute metadata (labels, icons)
            const attrKeys = Object.keys(product.attributes || {});
            product.resolved_attributes = [];

            if (attrKeys.length > 0) {
                const attrDefs = await query(
                    `SELECT code, label, image_url, type FROM attributes WHERE tenant_id = $1 AND code = ANY($2)`,
                    [req.tenantId, attrKeys]
                );

                product.resolved_attributes = attrKeys.map(key => {
                    const def = attrDefs.rows.find(a => a.code === key);
                    return {
                        code: key,
                        label: def ? def.label : key.replace(/_/g, ' '), // Fallback to formatted key
                        value: product.attributes[key],
                        icon: def ? def.image_url : null,
                        type: def ? def.type : 'text'
                    };
                });
            }

            // SEO Inheritance
            const primaryCategory = product.categories[0] || null; // Fallback to first if no explicit primary
            // Ideally we'd match product.category_id but simpler logic for now matches first found

            product.seo = mergeProductSEO(product, primaryCategory);

            res.json({ success: true, product });
        }));

        // PUBLIC STOREFRONT CATEGORY DETAIL
        router.get('/storefront/categories/:slug', subscriptionGuard('products'), asyncHandler(async (req, res) => {
            const { slug } = req.params;

            const catRes = await query(
                `SELECT * FROM categories 
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

            // SEO
            category.seo = mergeCategorySEO(category);

            res.json({ success: true, category });
        }));

        // PUBLIC STOREFRONT COLLECTION DETAIL
        router.get('/storefront/collections/:slug', subscriptionGuard('products'), asyncHandler(async (req, res) => {
            const { slug } = req.params;

            const resCol = await query(
                `SELECT * FROM collections 
                 WHERE tenant_id = $1 AND slug = $2 AND is_active = true`,
                [req.tenantId, slug]
            );

            if (!resCol.rows[0]) {
                return res.status(404).json({ error: 'Collection not found' });
            }

            const collection = resCol.rows[0];

            // Basic SEO fallback
            if (!collection.seo) collection.seo = {};
            if (typeof collection.seo === 'string') {
                try { collection.seo = JSON.parse(collection.seo); } catch (e) { }
            }
            if (!collection.seo.title) collection.seo.title = collection.name;

            res.json({ success: true, collection });
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
            // Simple fetch all (flat list)
            const result = await query(
                `SELECT * FROM categories WHERE tenant_id = $1 ORDER BY name`,
                [req.tenantId]
            );
            res.json({ success: true, categories: result.rows });
        }));

        // Get top-level categories only (Admin - for hierarchical navigation)
        router.get('/categories/top-level', authenticate, asyncHandler(async (req, res) => {
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

        // Get children of a specific category (Admin - for hierarchical navigation)
        router.get('/categories/:id/children', authenticate, asyncHandler(async (req, res) => {
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
                GROUP BY c.id
                ORDER BY c.name ASC
            `;
            const result = await query(sql, [req.tenantId, req.params.id]);
            res.json({ success: true, categories: result.rows });
        }));

        // Get comprehensive category details (Admin - for detail panel)
        router.get('/categories/:id/details', authenticate, asyncHandler(async (req, res) => {
            const categoryId = req.params.id;

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
                        SELECT id FROM categories WHERE id = $1 AND tenant_id = $2
                        UNION ALL
                        SELECT c.id FROM categories c
                        INNER JOIN category_tree ct ON c.parent_id = ct.id
                        WHERE c.tenant_id = $2
                    )
                    SELECT 
                        COUNT(DISTINCT CASE WHEN pc.category_id = $1 THEN pc.product_id END)::int as direct_product_count,
                        COUNT(DISTINCT pc.product_id)::int as total_product_count
                    FROM category_tree ct
                    LEFT JOIN product_categories pc ON pc.category_id = ct.id
                `;
                const countRes = await query(productCountSql, [categoryId, req.tenantId]);
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
                            WHERE c.tenant_id = $2
                        )
                        SELECT DISTINCT ON (a.id)
                            a.id, a.code, a.label, a.type, a.image_url, a.clauses, a.options,
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
                        `WITH category_tree AS (
                            SELECT id FROM categories WHERE id = $1 AND tenant_id = $2
                            UNION ALL
                            SELECT c.id FROM categories c
                            INNER JOIN category_tree ct ON c.parent_id = ct.id
                            WHERE c.tenant_id = $2
                        )
                        SELECT p.id, p.name, p.image_url, p.price, p.status,
                               CASE WHEN pc.category_id = $1 THEN 0 ELSE 1 END as sort_order
                        FROM products p
                        JOIN product_categories pc ON p.id = pc.product_id
                        JOIN category_tree ct ON pc.category_id = ct.id
                        WHERE p.tenant_id = $2
                        ORDER BY sort_order ASC, p.created_at DESC
                        LIMIT 10`,
                        [categoryId, req.tenantId]
                    );
                    category.recent_products = productsRes.rows || [];
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
                            WHERE c.tenant_id = $2
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

        // Get paginated products for a category (including subcategories)
        router.get('/categories/:id/products', authenticate, asyncHandler(async (req, res) => {
            const categoryId = req.params.id;
            const page = parseInt(req.query.page) || 1;
            const perPage = parseInt(req.query.per_page) || 20;
            const offset = (page - 1) * perPage;

            try {
                // Get total count
                const countSql = `
                    WITH RECURSIVE category_tree AS (
                        SELECT id FROM categories WHERE id = $1 AND tenant_id = $2
                        UNION ALL
                        SELECT c.id FROM categories c
                        INNER JOIN category_tree ct ON c.parent_id = ct.id
                        WHERE c.tenant_id = $2
                    )
                    SELECT COUNT(DISTINCT p.id)::int as total
                    FROM products p
                    JOIN product_categories pc ON p.id = pc.product_id
                    JOIN category_tree ct ON pc.category_id = ct.id
                    WHERE p.tenant_id = $2
                `;
                const countRes = await query(countSql, [categoryId, req.tenantId]);
                const total = countRes.rows[0]?.total || 0;

                // Get paginated products (direct products first)
                const productsSql = `
                    WITH RECURSIVE category_tree AS (
                        SELECT id FROM categories WHERE id = $1 AND tenant_id = $2
                        UNION ALL
                        SELECT c.id FROM categories c
                        INNER JOIN category_tree ct ON c.parent_id = ct.id
                        WHERE c.tenant_id = $2
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
                    ORDER BY p.id, sort_order ASC
                    OFFSET $3 LIMIT $4
                `;
                const productsRes = await query(productsSql, [categoryId, req.tenantId, offset, perPage]);

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
            // Note: Router is mounted at /products, so this becomes /products/categories/:id
            const category = await tenantUpdate('categories', req.tenantId, req.params.id, req.body);

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



        // ==========================================
        // Attributes (Decoupled)
        // ==========================================

        // List Global Attributes (All - for Admin dropdowns)
        router.get('/attributes/all', authenticate, asyncHandler(async (req, res) => {
            const result = await query(
                `SELECT * FROM attributes WHERE tenant_id = $1 ORDER BY label`,
                [req.tenantId]
            );
            res.json({ success: true, data: result.rows });
        }));

        // List Global Attributes
        router.get('/attributes', authenticate, asyncHandler(async (req, res) => {
            const result = await paginatedTenantQuery('attributes', req.tenantId, {});
            res.json({ success: true, ...result });
        }));

        // Create Global Attribute
        router.post('/attributes', authenticate, asyncHandler(async (req, res) => {
            let options = req.body.options;
            // Ensure options is a JSON string for DB
            if (options && typeof options === 'object') {
                options = JSON.stringify(options);
            }

            let clauses = req.body.clauses;
            // Ensure clauses is a JSON string for DB
            if (clauses && typeof clauses === 'object') {
                clauses = JSON.stringify(clauses);
            }

            const attribute = await tenantInsert('attributes', req.tenantId, {
                code: req.body.code,
                label: req.body.label,
                type: req.body.type,
                options: options || null,
                clauses: clauses || '[]',
                image_url: req.body.image_url
            });
            res.status(201).json({ success: true, attribute });
        }));

        // Update Global Attribute
        router.put('/attributes/:id', authenticate, asyncHandler(async (req, res) => {
            let options = req.body.options;
            // Ensure options is a JSON string for DB
            if (options && typeof options === 'object') {
                options = JSON.stringify(options);
            }

            let clauses = req.body.clauses;
            // Ensure clauses is a JSON string for DB
            if (clauses && typeof clauses === 'object') {
                clauses = JSON.stringify(clauses);
            }

            const attribute = await tenantUpdate('attributes', req.tenantId, req.params.id, {
                code: req.body.code,
                label: req.body.label,
                type: req.body.type,
                options: options || null,
                clauses: clauses || '[]',
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

        // Get ALL categories affected by this attribute (direct + inherited)
        router.get('/attributes/:id/affected-categories', authenticate, asyncHandler(async (req, res) => {
            const sql = `
                WITH RECURSIVE affected_tree AS (
                    -- Anchor: Direct links
                    SELECT c.id, c.name, c.parent_id, 0 as depth
                    FROM categories c
                    JOIN category_attributes ca ON ca.category_id = c.id
                    WHERE ca.attribute_id = $1 AND c.tenant_id = $2
                    
                    UNION ALL
                    
                    -- Recursive: Descendants
                    SELECT c.id, c.name, c.parent_id, at.depth + 1
                    FROM categories c
                    JOIN affected_tree at ON c.parent_id = at.id
                    WHERE c.tenant_id = $2
                )
                SELECT DISTINCT ON (id) id, name, parent_id, depth FROM affected_tree ORDER BY id, depth ASC
            `;
            const result = await query(sql, [req.params.id, req.tenantId]);
            res.json({ success: true, categories: result.rows });
        }));

        // Attach Attribute to Category
        router.post('/categories/:id/attributes', authenticate, asyncHandler(async (req, res) => {
            const { attribute_id, is_required, is_ignored } = req.body;

            await query(
                `INSERT INTO category_attributes (tenant_id, category_id, attribute_id, is_required, is_ignored)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (category_id, attribute_id) DO UPDATE SET 
                    is_required = EXCLUDED.is_required,
                    is_ignored = EXCLUDED.is_ignored`,
                [req.tenantId, req.params.id, attribute_id, is_required || false, is_ignored || false]
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

        // ==========================================
        // Category Routes
        // ==========================================







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
                    ca.is_ignored,
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
        // Collections Management (Admin)
        // ==========================================

        // List collections
        router.get('/collections/admin', authenticate, asyncHandler(async (req, res) => {
            const result = await paginatedTenantQuery('collections', req.tenantId, {
                page: parseInt(req.query.page) || 1,
                perPage: parseInt(req.query.per_page) || 50,
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
                thumbnail_url: req.body.thumbnail_url,
                rules: req.body.rules ? JSON.stringify(req.body.rules) : '[]',
                manual_product_ids: req.body.manual_product_ids || [],
                excluded_product_ids: req.body.excluded_product_ids || [],
                seo: req.body.seo ? JSON.stringify(req.body.seo) : '{}',
                is_active: req.body.is_active !== false
            });

            eventBus.emitEvent('collection.created', {
                tenantId: req.tenantId,
                collectionId: collection.id
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
                thumbnail_url: req.body.thumbnail_url,
                rules: req.body.rules ? JSON.stringify(req.body.rules) : undefined,
                manual_product_ids: req.body.manual_product_ids,
                excluded_product_ids: req.body.excluded_product_ids,
                seo: req.body.seo ? JSON.stringify(req.body.seo) : undefined,
                is_active: req.body.is_active
            });

            eventBus.emitEvent('collection.updated', {
                tenantId: req.tenantId,
                collectionId: req.params.id
            });

            res.json({ success: true, collection });
        }));

        // Delete collection
        router.delete('/collections/:id', authenticate, asyncHandler(async (req, res) => {
            await tenantDelete('collections', req.tenantId, req.params.id);

            eventBus.emitEvent('collection.deleted', {
                tenantId: req.tenantId,
                collectionId: req.params.id
            });

            res.json({ success: true, message: 'Collection deleted' });
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
