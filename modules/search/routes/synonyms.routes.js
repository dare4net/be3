/**
 * Synonym Management Routes
 * CRUD operations for search synonyms
 */

const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const authorize = require('../../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../../middleware/errorHandler');
const SearchSynonym = require('../models/SearchSynonym');

function registerSynonymRoutes(router) {
    // List synonyms
    router.get('/synonyms', authenticate, authorize('search.manage'), asyncHandler(async (req, res) => {
        const synonyms = await SearchSynonym.findAll(req.tenantId);
        res.json({ success: true, synonyms });
    }));

    // Create synonym
    router.post('/synonyms', authenticate, authorize('search.manage'), asyncHandler(async (req, res) => {
        const { term, synonyms, is_active = true } = req.body;

        if (!term || !synonyms || !Array.isArray(synonyms) || synonyms.length === 0) {
            return res.status(400).json({
                error: 'Invalid input',
                message: 'term and synonyms array are required'
            });
        }

        const synonym = await SearchSynonym.create(req.tenantId, {
            term,
            synonyms,
            is_active
        });

        res.status(201).json({ success: true, synonym });
    }));

    // Update synonym
    router.put('/synonyms/:id', authenticate, authorize('search.manage'), asyncHandler(async (req, res) => {
        const synonym = await SearchSynonym.update(req.tenantId, req.params.id, req.body);

        if (!synonym) {
            return res.status(404).json({ error: 'Synonym not found' });
        }

        res.json({ success: true, synonym });
    }));

    // Delete synonym
    router.delete('/synonyms/:id', authenticate, authorize('search.manage'), asyncHandler(async (req, res) => {
        await SearchSynonym.delete(req.tenantId, req.params.id);
        res.json({ success: true, message: 'Synonym deleted' });
    }));
}

module.exports = { registerSynonymRoutes };
