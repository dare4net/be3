/**
 * Storefront Module - Basic scaffold
 * PRINCIPLE: Modules do not import other modules
 */

const express = require('express');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../middleware/errorHandler');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();
        router.use(subscriptionGuard('storefront'));

        // Placeholder routes
        router.get('/pages', asyncHandler(async (req, res) => {
            res.json({ success: true, pages: [] });
        }));

        app.use('/storefront', router);
        console.log('[Storefront] Module initialized');

        return true;
    } catch (error) {
        console.error('[Storefront] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
