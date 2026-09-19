/**
 * Search Module Bootstrapper
 * 
 * PRINCIPLE: Modules do not import other modules
 * PRINCIPLE: All inter-module communication is event-based
 * PRINCIPLE: All feature access is subscription-gated
 */

const express = require('express');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { initializeListeners } = require('./events/listeners');

// Import route modules
const { registerSearchRoutes } = require('./routes/search.routes');
const { registerSynonymRoutes } = require('./routes/synonyms.routes');
const { registerAnalyticsRoutes } = require('./routes/analytics.routes');
const { registerIndexingRoutes } = require('./routes/indexing.routes');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();

        // Initialize event listeners
        initializeListeners(eventBus);

        // Apply subscription guard for all routes
        router.use(subscriptionGuard('search'));

        // Register route modules
        registerSearchRoutes(router);
        registerSynonymRoutes(router);
        registerAnalyticsRoutes(router);
        registerIndexingRoutes(router);

        // Mount router
        app.use('/search', router);
        console.log('[Search] Module initialized');

        return true;
    } catch (error) {
        console.error('[Search] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
