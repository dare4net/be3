/**
 * Variables Module Bootstrapper
 * 
 * PRINCIPLE: Modules do not import other modules
 * PRINCIPLE: All inter-module communication is event-based
 * PRINCIPLE: Any module can be removed without crashing the system
 * 
 * The Variables module provides a central registry for dynamic, 
 * context-aware text substitutions. Any module can register a variable 
 * (e.g. [BUSINESS_NAME]) and the registry resolves its value on demand.
 */

const express = require('express');
const VariableRegistry = require('./services/VariableRegistry');
const { registerVariableRoutes } = require('./routes/variables.routes');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();

        // Make the registry available to other modules via the shared context
        context.variableRegistry = VariableRegistry;

        // Listen for variable registrations from other modules
        // Any module can emit 'variable.register' with { name, description, resolver }
        eventBus.on('variable.register', (event) => {
            const { name, description, resolver } = event.data;
            VariableRegistry.register(name, description, resolver);
        });

        // Listen for bulk variable registrations
        eventBus.on('variable.register_many', (event) => {
            const { variables } = event.data;
            for (const v of variables) {
                VariableRegistry.register(v.name, v.description, v.resolver);
            }
        });

        // Register routes for listing/resolving variables (super-admin only)
        registerVariableRoutes(router);

        app.use('/variables', router);
        console.log('[Variables] Module initialized');

        // Notify other modules that the variable registry is ready
        eventBus.emitEvent('variables.ready', { registry: VariableRegistry });

        return true;
    } catch (error) {
        console.error('[Variables] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
