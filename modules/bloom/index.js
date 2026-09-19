/**
 * Bloom Module Bootstrapper
 * 
 * PRINCIPLE: Modules do not import other modules
 * PRINCIPLE: All inter-module communication is event-based
 * PRINCIPLE: Any module can be removed without crashing the system
 */

const express = require('express');
const { initializeListeners } = require('./events/listeners');
const { registerBloomRoutes } = require('./routes/bloom.routes');
const { registerAIRoutes } = require('./routes/ai.routes');
const BloomFilterService = require('./services/BloomFilterService');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();

        // Initialize event listeners (product/category/collection CRUD → filter updates)
        initializeListeners(eventBus);

        // Register admin routes
        registerBloomRoutes(router);

        // Register AI-facing routes (no subscription guard — AI service uses API key)
        registerAIRoutes(router);

        // Mount router
        app.use('/bloom', router);

        // Start the background scanner (checks for missing/stale filters every 6 hours)
        const bloomService = new BloomFilterService();
        bloomService.startScanner();

        console.log('[Bloom] Module initialized');
        return true;
    } catch (error) {
        console.error('[Bloom] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
