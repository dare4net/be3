/**
 * Storefront Routes
 * Public-facing product, category, and collection endpoints
 */

const { query } = require('../../../config/database');
const subscriptionGuard = require('../../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { mergeProductSEO, mergeCategorySEO } = require('../../../lib/seoHelpers');

function registerStorefrontRoutes(router) {
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
}

module.exports = { registerStorefrontRoutes };
