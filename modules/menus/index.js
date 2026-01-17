const express = require('express');
const { query } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

/**
 * Helper: Async Handler
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Helper: Verify Menu Ownership
 */
const verifyMenuOwnership = async (menuId, tenantId) => {
    const result = await query(
        'SELECT id FROM menus WHERE id = $1 AND tenant_id = $2',
        [menuId, tenantId]
    );
    return result.rows.length > 0;
};

// --- API Routes (Admin) ---

// List Menus
router.get('/menus', asyncHandler(async (req, res) => {
    const result = await query(
        'SELECT * FROM menus WHERE tenant_id = $1 ORDER BY created_at DESC',
        [req.tenantId]
    );
    res.json({ success: true, menus: result.rows });
}));

// Create Menu
router.post('/menus', asyncHandler(async (req, res) => {
    const { name, location } = req.body;

    // Check if location is taken
    if (location) {
        const existing = await query(
            'SELECT id FROM menus WHERE tenant_id = $1 AND location = $2',
            [req.tenantId, location]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Location already assigned to another menu' });
        }
    }

    const result = await query(
        'INSERT INTO menus (tenant_id, name, location) VALUES ($1, $2, $3) RETURNING *',
        [req.tenantId, name, location]
    );
    res.status(201).json({ success: true, menu: result.rows[0] });
}));

// Update Menu
router.put('/menus/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, location } = req.body;

    if (!await verifyMenuOwnership(id, req.tenantId)) {
        return res.status(404).json({ error: 'Menu not found' });
    }

    // If changing location, check uniqueness
    if (location) {
        const existing = await query(
            'SELECT id FROM menus WHERE tenant_id = $1 AND location = $2 AND id != $3',
            [req.tenantId, location, id]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Location already assigned to another menu' });
        }
    }

    const result = await query(
        'UPDATE menus SET name = COALESCE($1, name), location = COALESCE($2, location), updated_at = NOW() WHERE id = $3 RETURNING *',
        [name, location, id]
    );
    res.json({ success: true, menu: result.rows[0] });
}));

// Delete Menu
router.delete('/menus/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!await verifyMenuOwnership(id, req.tenantId)) {
        return res.status(404).json({ error: 'Menu not found' });
    }

    await query('DELETE FROM menus WHERE id = $1', [id]);
    res.json({ success: true, message: 'Menu deleted' });
}));

// Get Menu Items
router.get('/menus/:id/items', asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!await verifyMenuOwnership(id, req.tenantId)) {
        return res.status(404).json({ error: 'Menu not found' });
    }

    const result = await query(
        'SELECT * FROM menu_items WHERE menu_id = $1 ORDER BY position ASC',
        [id]
    );
    res.json({ success: true, items: result.rows });
}));

// Batch Update Items (Save Menu Structure)
router.post('/menus/:id/items', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { items } = req.body; // Expects array of item objects

    if (!await verifyMenuOwnership(id, req.tenantId)) {
        return res.status(404).json({ error: 'Menu not found' });
    }

    // Transactional replace
    const client = await require('../../config/database').pool.connect();
    try {
        await client.query('BEGIN');

        // Delete valid existing items
        await client.query('DELETE FROM menu_items WHERE menu_id = $1', [id]);

        // Insert new items
        // Note: nesting/parent_id needs to be handled by the frontend sending correct parent_ids or recursively inserting.
        // For simplicity, we assume the frontend sends a flat list with parent_id set.

        if (items && items.length > 0) {
            for (const item of items) {
                await client.query(
                    `INSERT INTO menu_items (menu_id, parent_id, label, url, type, reference_id, position)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [id, item.parent_id || null, item.label, item.url, item.type, item.reference_id, item.position]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Menu updated' });
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}));

// --- Storefront Routes ---

// Get Menu by Location (Public)
router.get('/storefront/menus/:location', asyncHandler(async (req, res) => {
    const { location } = req.params;

    // Find menu by location
    const menuRes = await query(
        'SELECT id, name FROM menus WHERE tenant_id = $1 AND location = $2',
        [req.tenantId, location]
    );

    if (menuRes.rows.length === 0) {
        return res.json({ success: true, items: [] });
    }

    const menuId = menuRes.rows[0].id;

    // Get items
    const itemsRes = await query(
        'SELECT * FROM menu_items WHERE menu_id = $1 ORDER BY position ASC',
        [menuId]
    );

    // Build hierarchy
    const items = itemsRes.rows;
    const rootItems = items.filter(i => !i.parent_id);
    const buildTree = (parents) => {
        return parents.map(parent => {
            const children = items.filter(i => i.parent_id === parent.id);
            return {
                ...parent,
                children: buildTree(children)
            };
        });
    };

    res.json({ success: true, menu: menuRes.rows[0], items: buildTree(rootItems) });
}));

module.exports = {
    bootstrap: async ({ app }) => {
        app.use('/api', router); // Admin routes
        app.use('/api', router); // Storefront routes (overlap path for simplicity)
    }
};
