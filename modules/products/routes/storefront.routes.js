/**
 * Storefront Routes
 * Public-facing product, category, and collection endpoints
 */

const { query } = require('../../../config/database');
const subscriptionGuard = require('../../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { mergeProductSEO, mergeCategorySEO } = require('../../../lib/seoHelpers');
const ProductService = require('../services/ProductService');
const { PRODUCT_SAFE_COLUMNS } = require('../../../utils/storefrontHelper');

function registerStorefrontRoutes(router) {
    // PUBLIC STOREFRONT ENDPOINT (No Auth, but requires Subscription/Module Access)
    router.get('/storefront', subscriptionGuard('products'), asyncHandler(async (req, res) => {
        const { featured, category, category_id, limit, exclude, sort, q, price_min, price_max, vendor_name } = req.query;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(limit || req.query.per_page) || 20;
        const offset = (page - 1) * perPage;

        let queryParams = [req.tenantId];
        let whereConditions = [
            `p.tenant_id = $1`,
            `p.status = 'active'`,
            `p.deleted_at IS NULL`
        ];

        // Hide variants by default in generic listings (unless a specific ID/Handle is likely intended)
        if (req.query.show_variants !== 'true') {
            whereConditions.push(`p.is_variant = false`);
        }

        if (q) {
            queryParams.push(`%${q}%`);
            whereConditions.push(`(p.name ILIKE $${queryParams.length} OR p.description ILIKE $${queryParams.length})`);
        }

        if (price_min) {
            queryParams.push(parseFloat(price_min));
            whereConditions.push(`p.price >= $${queryParams.length}`);
        }

        if (price_max) {
            queryParams.push(parseFloat(price_max));
            whereConditions.push(`p.price <= $${queryParams.length}`);
        }

        if (featured === 'true') {
            queryParams.push(true);
            whereConditions.push(`p.is_featured = $${queryParams.length}`);
        }

        if (exclude) {
            queryParams.push(exclude);
            whereConditions.push(`p.id != $${queryParams.length}`);
        }

        // Filter by vendor (stored in product attributes JSON)
        if (vendor_name) {
            queryParams.push(vendor_name);
            whereConditions.push(`p.attributes->>'vendor' = $${queryParams.length}`);
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
            SELECT ${PRODUCT_SAFE_COLUMNS.split(',').map(c => 'p.' + c.trim()).join(', ')} 
            FROM products p
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

        // Fetch categories/images and stats for each product
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

            // Get Stats (Impressions & Wishlist Count)
            const statsRes = await query(`
                SELECT 
                    (SELECT COUNT(*) FROM analytics_events WHERE entity_type = 'product' AND entity_id = $1 AND event_type = 'impression') as impressions,
                    (SELECT COUNT(*) FROM wishlists WHERE product_id = $1) as wishlist_count
            `, [product.id]);

            product.stats = {
                impressions: parseInt(statsRes.rows[0]?.impressions || 0),
                wishlist_count: parseInt(statsRes.rows[0]?.wishlist_count || 0)
            };

            // Get Rating Summary
            try {
                const ratingRes = await query(
                    `SELECT average_rating, total_ratings, total_reviews FROM product_rating_summary WHERE tenant_id = $1 AND product_id = $2`,
                    [req.tenantId, product.id]
                );
                product.rating_summary = ratingRes.rows[0] || null;
            } catch (e) {
                product.rating_summary = null;
            }
        }

        // Resolve dynamic tags (publicly using null userId context as resolve handles product.created_by)
        await ProductService.resolve(req.tenantId, null, result.rows);

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

    // PUBLIC STOREFRONT PRODUCT DETAIL TEMPORARY DEBUG ENDPOINT
    router.get('/storefront/debug', asyncHandler(async (req, res) => {
        res.json({
            success: true,
            tenantId: req.tenantId,
            headers: req.headers
        });
    }));

    // PUBLIC STOREFRONT PRODUCT DETAIL BY ID (used for parent product lookup on variant pages)
    router.get('/storefront/products/by-id/:id', subscriptionGuard('products'), asyncHandler(async (req, res) => {
        const productRes = await query(
            `SELECT ${PRODUCT_SAFE_COLUMNS} FROM products WHERE tenant_id = $1 AND id = $2 AND status = 'active' AND deleted_at IS NULL`,
            [req.tenantId, req.params.id]
        );
        if (!productRes.rows[0]) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const product = productRes.rows[0];
        await ProductService.resolve(req.tenantId, null, product);
        res.json({ success: true, product });
    }));

    // PUBLIC STOREFRONT PRODUCT DETAIL
    router.get('/storefront/products/:handle', subscriptionGuard('products'), asyncHandler(async (req, res) => {
        const { handle } = req.params;
        console.log(`[Products API] Fetching product: ${handle} for tenant: ${req.tenantId}`);

        // Get Product
        const productRes = await query(
            `SELECT ${PRODUCT_SAFE_COLUMNS} FROM products WHERE tenant_id = $1 AND (handle = $2 OR id::text = $2) AND status = 'active' AND deleted_at IS NULL`,
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
            `SELECT c.id, c.name, c.slug, c.parent_id FROM categories c
             JOIN product_categories pc ON c.id = pc.category_id
             WHERE pc.product_id = $1`,
            [product.id]
        );
        product.categories = catsRes.rows;

        // Get Vendor Locations (all)
        if (product.created_by) {
            const locationRes = await query(
                `SELECT id, scope, continent, country, state, city, address, is_primary
                 FROM vendor_locations 
                 WHERE tenant_id = $1 AND vendor_id = $2`,
                [req.tenantId, product.created_by]
            );

            const allLocs = locationRes.rows;
            product.vendor_location = allLocs.find(l => l.is_primary) || allLocs[0] || null;
            product.other_locations = allLocs.filter(l => l.id !== product.vendor_location?.id);
        }

        // Fetch breadcrumb for the first category found
        if (product.categories.length > 0) {
            const primaryCat = product.categories[0];
            const breadcrumbSql = `
                WITH RECURSIVE category_path AS (
                    SELECT id, name, slug, parent_id, 0 as level
                    FROM categories
                    WHERE id = $1 AND tenant_id = $2
                    UNION ALL
                    SELECT c.id, c.name, c.slug, c.parent_id, cp.level + 1
                    FROM categories c
                    INNER JOIN category_path cp ON c.id = cp.parent_id
                    WHERE c.tenant_id = $2
                )
                SELECT id, name, slug FROM category_path ORDER BY level DESC
            `;
            const breadcrumbRes = await query(breadcrumbSql, [primaryCat.id, req.tenantId]);
            product.categories[0].breadcrumb = breadcrumbRes.rows || [];
        }

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

        // Resolve dynamic tags (publicly using null userId context as resolve handles product.created_by)
        await ProductService.resolve(req.tenantId, null, product);
        const primaryCategory = product.categories[0] || null; // Fallback to first if no explicit primary
        // Ideally we'd match product.category_id but simpler logic for now matches first found

        // Fetch real rating summary (graceful fallback if reviews module not loaded)
        try {
            const summaryRes = await query(
                `SELECT * FROM product_rating_summary WHERE tenant_id = $1 AND product_id = $2`,
                [req.tenantId, product.id]
            );
            if (summaryRes.rows[0]) {
                product.rating_summary = summaryRes.rows[0];
            }
        } catch (e) {
            // Graceful: reviews module may not be installed
        }

        const baseUrl = req.headers['x-storefront-url'] || '';
        product.seo = mergeProductSEO(product, primaryCategory, baseUrl);

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

        // Get Subcategories
        const subRes = await query(
            `SELECT id, name, slug FROM categories 
             WHERE tenant_id = $1 AND parent_id = $2 AND is_active = true 
             ORDER BY name ASC`,
            [req.tenantId, category.id]
        );
        category.children = subRes.rows;

        // Get Breadcrumb path
        const breadcrumbSql = `
            WITH RECURSIVE category_path AS (
                SELECT id, name, slug, parent_id, 0 as level
                FROM categories
                WHERE id = $1 AND tenant_id = $2
                UNION ALL
                SELECT c.id, c.name, c.slug, c.parent_id, cp.level + 1
                FROM categories c
                INNER JOIN category_path cp ON c.id = cp.parent_id
                WHERE c.tenant_id = $2
            )
            SELECT id, name, slug FROM category_path ORDER BY level DESC
        `;
        const breadcrumbRes = await query(breadcrumbSql, [category.id, req.tenantId]);
        category.breadcrumb = breadcrumbRes.rows || [];

        // SEO
        const baseUrl = req.headers['x-storefront-url'] || '';
        category.seo = mergeCategorySEO(category, baseUrl);

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

    // Vendor category ledger — returns categories a vendor has active products in
    // Query params: vendor (required, vendor name string)
    router.get('/storefront/vendor-categories', asyncHandler(async (req, res) => {
        const { vendor } = req.query;
        if (!vendor) {
            return res.status(400).json({ error: 'vendor query param is required' });
        }

        // Resolve vendor ID from name for the ledger lookup
        const vendorRes = await query(
            'SELECT id FROM users WHERE tenant_id = $1 AND (LOWER(business_name) = LOWER($2)) LIMIT 1',
            [req.tenantId, vendor]
        );
        const vendorId = vendorRes.rows[0]?.id;

        const result = await query(
            `SELECT
                vcl.vendor_name,
                vcl.category_id,
                c.name    AS category_name,
                c.slug    AS category_slug,
                c.image_url AS category_image,
                vcl.product_count
             FROM vendor_category_ledger vcl
             JOIN categories c ON c.id = vcl.category_id AND c.tenant_id = vcl.tenant_id
             WHERE vcl.tenant_id = $1
               AND (vcl.vendor_id = $2 OR vcl.vendor_name = $3)
               AND vcl.product_count >= 1
             ORDER BY vcl.product_count DESC`,
            [req.tenantId, vendorId, vendor]
        );

        res.json({ success: true, categories: result.rows });
    }));
}

module.exports = { registerStorefrontRoutes };
