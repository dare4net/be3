/**
 * Products Module Bootstrapper
 * 
 * PRINCIPLE: Modules do not import other modules
 * PRINCIPLE: All inter-module communication is event-based
 * PRINCIPLE: Any module can be removed without crashing the system
 */

const express = require('express');
const subscriptionGuard = require('../../middleware/subscriptionGuard');

// Import route modules
const { registerStorefrontRoutes } = require('./routes/storefront.routes');
const { registerAdminRoutes } = require('./routes/admin.routes');
const { registerCategoryRoutes } = require('./routes/categories.routes');
const { registerAttributeRoutes } = require('./routes/attributes.routes');
const { registerProductRoutes } = require('./routes/products.routes');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();

        // Register public storefront routes (no subscription guard yet)
        registerStorefrontRoutes(router);

        // Register admin routes (super admin, no tenant auth)
        registerAdminRoutes(router);

        // Apply subscription guard for all other routes
        // PRINCIPLE: All feature access is subscription-gated
        // TEMPORARILY DISABLED FOR TESTING - Re-enable after adding subscription during signup
        router.use(subscriptionGuard('products'));

        // Register authenticated routes
        registerCategoryRoutes(router, eventBus);
        registerAttributeRoutes(router);
        registerProductRoutes(router, eventBus);

        // Mount router
        app.use('/products', router);
        console.log('[Products] Module initialized ');

        return true;
    } catch (error) {
        console.error('[Products] Bootstrap failed:', error);
        // PRINCIPLE: Any module can be removed without crashing the system
        return false;
    }
}

module.exports = { bootstrap };
