/**
 * Authentication Module Bootstrapper
 * 
 * PRINCIPLE: Any module can be removed without crashing the system
 * PRINCIPLE: Modules do not import other modules
 * 
 * This module can be disabled without affecting core system operation
 */

const routes = require('./routes');
const { registerListeners } = require('./events/listeners');

/**
 * Bootstrap authentication module
 * @param {Object} context - Module context with app and eventBus
 */
async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        // Register routes
        app.use('/auth', routes);
        console.log('[Auth] Routes registered at /auth');

        // Register event listeners
        registerListeners();

        return true;
    } catch (error) {
        console.error('[Auth] Bootstrap failed:', error);
        // PRINCIPLE: Any module can be removed without crashing the system
        throw error; // Auth is core, so we do want to know if it fails
    }
}

module.exports = { bootstrap };
