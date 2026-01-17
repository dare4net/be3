/**
 * Tenants Module Bootstrapper
 * 
 * PRINCIPLE: Any module can be removed without crashing the system
 * However, tenants is a core module that the system needs
 */

const routes = require('./routes');
const { registerListeners } = require('./events/listeners');

/**
 * Bootstrap tenants module
 */
async function bootstrap(context) {
    const { app } = context;

    try {
        // Register routes
        app.use('/tenants', routes);
        console.log('[Tenants] Routes registered at /tenants');

        // Register event listeners
        registerListeners();

        return true;
    } catch (error) {
        console.error('[Tenants] Bootstrap failed:', error);
        throw error; // Tenants is core, so we want to fail fast
    }
}

module.exports = { bootstrap };
