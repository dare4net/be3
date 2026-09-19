/**
 * Variables Routes
 * Endpoints for listing and resolving variables (super-admin / internal use)
 */

const VariableRegistry = require('../services/VariableRegistry');
const { asyncHandler } = require('../../../middleware/errorHandler');

function registerVariableRoutes(router) {
    /**
     * GET /variables
     * List all registered variables (name + description)
     */
    router.get('/', asyncHandler(async (req, res) => {
        const variables = VariableRegistry.list();
        res.json({ success: true, variables });
    }));

    /**
     * POST /variables/resolve
     * Resolve a single variable or a text containing variables
     * Body: { name?: string, text?: string, context: { tenantId, userId, ... } }
     */
    router.post('/resolve', asyncHandler(async (req, res) => {
        const { name, text, context } = req.body;

        if (name) {
            const value = await VariableRegistry.resolve(name, context || {});
            return res.json({ success: true, name, value });
        }

        if (text) {
            const resolved = await VariableRegistry.resolveText(text, context || {});
            return res.json({ success: true, original: text, resolved });
        }

        res.status(400).json({ success: false, error: 'Provide either name or text to resolve' });
    }));
}

module.exports = { registerVariableRoutes };
