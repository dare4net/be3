/**
 * Admin Routes
 * Super admin routes for managing products and attributes across tenants
 */

const { query } = require('../../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate, tenantDelete } = require('../../../utils/dbHelpers');
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

        res.json({ success: true, product });
    }));

    // ─── Super Admin Attribute Routes ─────────────────────────────────

    // List all attributes for a tenant (includes system attributes)
    router.get('/admin/tenants/:tenantId/attributes', asyncHandler(async (req, res) => {
        const { tenantId } = req.params;
        const result = await query(
            `SELECT * FROM attributes WHERE tenant_id = $1 ORDER BY label ASC`,
            [tenantId]
        );
        res.json({ success: true, data: result.rows });
    }));

    // Create attribute for a tenant (super admin)
    router.post('/admin/tenants/:tenantId/attributes', asyncHandler(async (req, res) => {
        const { tenantId } = req.params;
        let options = req.body.options;
        if (options && typeof options === 'object') {
            options = JSON.stringify(options);
        }

        const attribute = await tenantInsert('attributes', tenantId, {
            code: req.body.code,
            label: req.body.label,
            type: req.body.type,
            options: options || null,
            is_system: req.body.is_system || false,
            is_filterable: req.body.is_filterable || false,
            is_searchable: req.body.is_searchable || false
        });
        res.status(201).json({ success: true, attribute });
    }));

    // Update attribute for a tenant (super admin, bypasses is_system check)
    router.put('/admin/tenants/:tenantId/attributes/:id', asyncHandler(async (req, res) => {
        const { tenantId, id } = req.params;
        let options = req.body.options;
        if (options && typeof options === 'object') {
            options = JSON.stringify(options);
        }

        const attribute = await tenantUpdate('attributes', tenantId, id, {
            code: req.body.code,
            label: req.body.label,
            type: req.body.type,
            options: options || null,
            is_system: req.body.is_system ?? undefined,
            is_filterable: req.body.is_filterable || false,
            is_searchable: req.body.is_searchable || false
        });
        res.json({ success: true, attribute });
    }));

    // Delete attribute for a tenant (super admin, bypasses is_system check)
    router.delete('/admin/tenants/:tenantId/attributes/:id', asyncHandler(async (req, res) => {
        const { tenantId, id } = req.params;
        await tenantDelete('attributes', tenantId, id);
        res.json({ success: true, message: 'Attribute deleted' });
    }));
}

module.exports = { registerAdminRoutes };
