const express = require('express');
const { query } = require('../../config/database');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../middleware/errorHandler');

async function bootstrap(context) {
    const { app, eventBus } = context;

    // --- Routes ---
    const router = express.Router();

    // Add to Wishlist
    router.post('/', optionalAuth, asyncHandler(async (req, res) => {
        const { tenantId, user } = req;
        const { productId, sessionId, metadata } = req.body;

        if (!productId) {
            return res.status(400).json({ success: false, error: 'Product ID is required' });
        }

        const userId = user ? user.id : null;
        const finalSessionId = sessionId || (req.headers['x-session-id']);

        if (!userId && !finalSessionId) {
            return res.status(400).json({ success: false, error: 'User ID or Session ID required' });
        }

        // Logic to handle potential duplicates handled by DB constraint, but let's be graceful
        const result = await query(
            `INSERT INTO wishlists (tenant_id, user_id, session_id, product_id, metadata)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [tenantId, userId, finalSessionId, productId, metadata ? JSON.stringify(metadata) : null]
        );

        if (result.rowCount > 0 && eventBus) {
            eventBus.emitEvent('wishlist.add', { tenantId, userId, sessionId: finalSessionId, productId });
        }

        res.json({ success: true, message: 'Added to wishlist' });
    }));

    // Remove from Wishlist
    router.delete('/:productId', optionalAuth, asyncHandler(async (req, res) => {
        const { tenantId, user } = req;
        const { productId } = req.params;
        const sessionId = req.query.sessionId || req.headers['x-session-id'];

        const userId = user ? user.id : null;

        if (!userId && !sessionId) {
            return res.status(400).json({ success: false, error: 'User ID or Session ID required' });
        }

        const condition = userId
            ? 'tenant_id = $1 AND user_id = $2 AND product_id = $3'
            : 'tenant_id = $1 AND session_id = $2 AND product_id = $3';

        const params = userId
            ? [tenantId, userId, productId]
            : [tenantId, sessionId, productId];

        await query(`DELETE FROM wishlists WHERE ${condition}`, params);

        if (eventBus) {
            eventBus.emitEvent('wishlist.remove', { tenantId, userId, sessionId, productId });
        }

        res.json({ success: true, message: 'Removed from wishlist' });
    }));

    // Get Wishlist
    router.get('/', optionalAuth, asyncHandler(async (req, res) => {
        const { tenantId, user } = req;
        const sessionId = req.query.sessionId || req.headers['x-session-id'];
        const userId = user ? user.id : null;

        if (!userId && !sessionId) {
            return res.json({ success: true, wishlist: [] });
        }

        const condition = userId
            ? 'tenant_id = $1 AND user_id = $2'
            : 'tenant_id = $1 AND session_id = $2';

        const params = userId ? [tenantId, userId] : [tenantId, sessionId];

        const result = await query(
            `SELECT product_id as id, created_at, metadata FROM wishlists WHERE ${condition} ORDER BY created_at DESC`,
            params
        );

        // Ideally, we might want to hydrate these products, but for now return IDs
        // The frontend usually has the product data or can fetch it. 
        // If we need hydration, we'd join with products table.

        res.json({ success: true, wishlist: result.rows });
    }));

    // Check specific product
    router.get('/:productId/check', optionalAuth, asyncHandler(async (req, res) => {
        const { tenantId, user } = req;
        const { productId } = req.params;
        const sessionId = req.query.sessionId || req.headers['x-session-id'];
        const userId = user ? user.id : null;

        if (!userId && !sessionId) {
            return res.json({ success: true, inWishlist: false });
        }

        const condition = userId
            ? 'tenant_id = $1 AND user_id = $2 AND product_id = $3'
            : 'tenant_id = $1 AND session_id = $2 AND product_id = $3';

        const params = userId
            ? [tenantId, userId, productId]
            : [tenantId, sessionId, productId];

        const result = await query(`SELECT 1 FROM wishlists WHERE ${condition}`, params);

        res.json({ success: true, inWishlist: (result.rowCount > 0) });
    }));


    app.use('/wishlist', router);
}

module.exports = { bootstrap };
