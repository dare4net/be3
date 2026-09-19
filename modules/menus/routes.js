/**
 * Menu Routes
 * Public storefront endpoints and authenticated tenant admin endpoints
 */

const express = require('express');
const router = express.Router();
const MenuService = require('./service');
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../middleware/errorHandler');

/**
 * Public storefront endpoint: Get menu by location (e.g. 'header', 'footer', 'sidebar')
 */
router.get('/storefront/:location', asyncHandler(async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || req.tenantId || req.query.tenant_id;
    if (!tenantId) {
        return res.status(400).json({ success: false, message: 'Tenant ID required' });
    }

    const menu = await MenuService.getMenuByLocation(tenantId, req.params.location);
    if (!menu) {
        return res.json({ success: true, menu: null, items: [], tree: [] });
    }

    res.json({ success: true, menu, items: menu.items, tree: menu.tree });
}));

/**
 * Public storefront endpoint: Get menu by ID (no auth required, tenant via header)
 * Used by storefront footer to resolve menu-linked columns.
 */
router.get('/storefront-by-id/:id', asyncHandler(async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] || req.tenantId || req.query.tenant_id;
    if (!tenantId) {
        return res.status(400).json({ success: false, message: 'Tenant ID required' });
    }

    const menu = await MenuService.getMenu(tenantId, req.params.id);
    if (!menu) {
        return res.json({ success: true, menu: null, items: [], tree: [] });
    }

    res.json({ success: true, menu, items: menu.items, tree: menu.tree });
}));

/**
 * Tenant Admin: List all menus
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
    const menus = await MenuService.getMenus(req.tenantId);
    res.json({ success: true, data: menus });
}));

/**
 * Tenant Admin: Get catalog suggestions (categories, subcategories, attribute clauses) for Menu Builder
 */
router.get('/catalog-suggestions', authenticate, asyncHandler(async (req, res) => {
    const suggestions = await MenuService.getCatalogSuggestions(req.tenantId);
    res.json({ success: true, data: suggestions });
}));

/**
 * Tenant Admin: Get single menu
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
    const menu = await MenuService.getMenu(req.tenantId, req.params.id);
    if (!menu) {
        return res.status(404).json({ success: false, message: 'Menu not found' });
    }
    res.json({ success: true, data: menu });
}));

/**
 * Tenant Admin: Create menu
 */
router.post('/', authenticate, asyncHandler(async (req, res) => {
    const { name, location } = req.body;
    if (!name || !location) {
        return res.status(400).json({ success: false, message: 'Name and location are required' });
    }

    const menu = await MenuService.createMenu(req.tenantId, { name, location });
    res.status(201).json({ success: true, data: menu });
}));

/**
 * Tenant Admin: Update menu
 */
router.put('/:id', authenticate, asyncHandler(async (req, res) => {
    const menu = await MenuService.updateMenu(req.tenantId, req.params.id, req.body);
    if (!menu) {
        return res.status(404).json({ success: false, message: 'Menu not found' });
    }
    res.json({ success: true, data: menu });
}));

/**
 * Tenant Admin: Delete menu
 */
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
    const deleted = await MenuService.deleteMenu(req.tenantId, req.params.id);
    if (!deleted) {
        return res.status(404).json({ success: false, message: 'Menu not found' });
    }
    res.json({ success: true, message: 'Menu deleted successfully' });
}));

/**
 * Tenant Admin: Add menu item
 */
router.post('/:id/items', authenticate, asyncHandler(async (req, res) => {
    const item = await MenuService.createMenuItem(req.tenantId, req.params.id, req.body);
    res.status(201).json({ success: true, data: item });
}));

/**
 * Tenant Admin: Batch update / sync all menu items
 */
router.put('/:id/items/sync', authenticate, asyncHandler(async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) {
        return res.status(400).json({ success: false, message: 'Items array is required' });
    }
    const updatedItems = await MenuService.syncMenuItems(req.tenantId, req.params.id, items);
    res.json({ success: true, data: updatedItems });
}));

/**
 * Tenant Admin: Update menu item
 */
router.put('/:id/items/:itemId', authenticate, asyncHandler(async (req, res) => {
    const item = await MenuService.updateMenuItem(req.tenantId, req.params.id, req.params.itemId, req.body);
    if (!item) {
        return res.status(404).json({ success: false, message: 'Menu item not found' });
    }
    res.json({ success: true, data: item });
}));

/**
 * Tenant Admin: Delete menu item
 */
router.delete('/:id/items/:itemId', authenticate, asyncHandler(async (req, res) => {
    const deleted = await MenuService.deleteMenuItem(req.tenantId, req.params.id, req.params.itemId);
    if (!deleted) {
        return res.status(404).json({ success: false, message: 'Menu item not found' });
    }
    res.json({ success: true, message: 'Menu item deleted successfully' });
}));

module.exports = router;
