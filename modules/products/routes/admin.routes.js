/**
 * Admin Routes
 * Super admin routes for managing products across tenants
 */

const { paginatedTenantQuery, tenantInsert } = require('../../../utils/dbHelpers');
const { asyncHandler } = require('../../../middleware/errorHandler');

function registerAdminRoutes(router) {
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
        //         `INSERT INTO product_images (tenant_id, product_id, url, \"order\", is_primary) VALUES ($1, $2, $3, 0, true)`,
        //         [tenantId, product.id, req.body.image_url]
        //     );
        // }

        res.json({ success: true, product });
    }));
}

module.exports = { registerAdminRoutes };
