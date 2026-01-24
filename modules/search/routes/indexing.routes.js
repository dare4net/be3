/**
 * Indexing Routes
 * Search index management and rebuilding
 */

const { query } = require('../../../config/database');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const authorize = require('../../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../../middleware/errorHandler');
const IndexService = require('../services/IndexService');
const FilterService = require('../services/FilterService');

function registerIndexingRoutes(router) {
    // Rebuild search index
    router.post('/index/rebuild', authenticate, authorize('search.index'), asyncHandler(async (req, res) => {
        const indexService = new IndexService();

        try {
            const result = await indexService.rebuildIndex(req.tenantId);
            res.json({
                success: true,
                message: 'Index rebuild completed successfully.',
                indexedCount: result.indexedCount
            });
        } catch (error) {
            console.error('[Search] Error rebuilding index:', error);
            res.status(500).json({
                success: false,
                error: 'Index rebuild failed',
                message: error.message
            });
        }
    }));

    // Index a specific product
    router.post('/index/product/:productId', authenticate, authorize('search.index'), asyncHandler(async (req, res) => {
        const indexService = new IndexService();
        const { productId } = req.params;

        const productResult = await query(
            `SELECT * FROM products WHERE id = $1 AND tenant_id = $2`,
            [productId, req.tenantId]
        );

        if (productResult.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
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

        await indexService.indexProduct(req.tenantId, product);
        res.json({ success: true, message: 'Product indexed' });
    }));

    // Index a specific category
    router.post('/index/category/:categoryId', authenticate, authorize('search.index'), asyncHandler(async (req, res) => {
        const indexService = new IndexService();
        const { categoryId } = req.params;

        const categoryResult = await query(
            `SELECT * FROM categories WHERE id = $1 AND tenant_id = $2`,
            [categoryId, req.tenantId]
        );

        if (categoryResult.rows.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }

        await indexService.indexCategory(req.tenantId, categoryResult.rows[0]);
        res.json({ success: true, message: 'Category indexed' });
    }));

    // Index a specific page
    router.post('/index/page/:pageId', authenticate, authorize('search.index'), asyncHandler(async (req, res) => {
        const indexService = new IndexService();
        const { pageId } = req.params;

        const pageResult = await query(
            `SELECT * FROM pages WHERE id = $1 AND tenant_id = $2`,
            [pageId, req.tenantId]
        );

        if (pageResult.rows.length === 0) {
            return res.status(404).json({ error: 'Page not found' });
        }

        await indexService.indexPage(req.tenantId, pageResult.rows[0]);
        res.json({ success: true, message: 'Page indexed' });
    }));

    // List filters (admin)
    router.get('/filters/admin', authenticate, authorize('search.manage'), asyncHandler(async (req, res) => {
        const filterService = new FilterService();
        const filters = await filterService.getFilters(req.tenantId);
        res.json({ success: true, filters });
    }));

    // Create filter
    router.post('/filters', authenticate, authorize('search.manage'), asyncHandler(async (req, res) => {
        const filterService = new FilterService();
        const filter = await filterService.createFilter(req.tenantId, req.body);
        res.status(201).json({ success: true, filter });
    }));

    // Update filter
    router.put('/filters/:id', authenticate, authorize('search.manage'), asyncHandler(async (req, res) => {
        const filterService = new FilterService();
        const filter = await filterService.updateFilter(req.tenantId, req.params.id, req.body);

        if (!filter) {
            return res.status(404).json({ error: 'Filter not found' });
        }

        res.json({ success: true, filter });
    }));

    // Delete filter
    router.delete('/filters/:id', authenticate, authorize('search.manage'), asyncHandler(async (req, res) => {
        const filterService = new FilterService();
        await filterService.deleteFilter(req.tenantId, req.params.id);
        res.json({ success: true, message: 'Filter deleted' });
    }));
}

module.exports = { registerIndexingRoutes };
