/**
 * Reviews Module Bootstrapper
 * 
 * PRINCIPLE: Modules do not import other modules
 * PRINCIPLE: All inter-module communication is event-based
 * PRINCIPLE: Any module can be removed without crashing the system
 */

const express = require('express');

const { registerReviewRoutes } = require('./routes/reviews.routes');
const { registerStorefrontRoutes } = require('./routes/storefront.routes');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();

        // Public storefront routes (no auth required)
        registerStorefrontRoutes(router);

        // Authenticated routes (ratings, reviews, votes, replies)
        registerReviewRoutes(router);

        // Mount router
        app.use('/reviews', router);
        console.log('[Reviews] Module initialized ✓');

        return true;
    } catch (error) {
        console.error('[Reviews] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
