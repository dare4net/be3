/**
 * Menus Module
 * Manages header, footer, and custom navigation menus
 */

const routes = require('./routes');
const MenuService = require('./service');

async function bootstrap(context) {
    const { app } = context;

    // Mount admin and module routes
    app.use('/menus', routes);
    app.use('/modules/menus', routes);

    // Mount public storefront menu endpoint directly for easy proxying
    app.get('/api/storefront/menus/:location', async (req, res, next) => {
        try {
            const tenantId = req.headers['x-tenant-id'] || req.tenantId || req.query.tenant_id;
            if (!tenantId) {
                return res.status(400).json({ success: false, message: 'Tenant ID required' });
            }

            const menu = await MenuService.getMenuByLocation(tenantId, req.params.location);
            if (!menu) {
                return res.json({ success: true, menu: null, items: [], tree: [] });
            }

            res.json({ success: true, menu, items: menu.items, tree: menu.tree });
        } catch (err) {
            next(err);
        }
    });

    console.log('✓ Menus module routes mounted at /menus, /modules/menus, and /api/storefront/menus/:location');
    return true;
}

module.exports = {
    name: 'menus',
    description: 'Manage storefront navigation menus',
    version: '1.0.0',
    bootstrap,
    service: MenuService,
};
