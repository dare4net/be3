/**
 * be3_ai Search Routes
 * 
 * AI-facing endpoints for the structured search interface.
 * Called by the be3_ai pipeline to execute the 4-stage search.
 */

const SearchInterfaceService = require('../services/SearchInterfaceService');

function registerSearchRoutes(router) {
    const searchInterface = new SearchInterfaceService();

    /**
     * POST /be3-ai/search
     * 
     * Execute structured search from the AI pipeline.
     * 
     * Body: {
     *   tenantId: string,
     *   query: string,
     *   categories: [{ id, slug, label, isWinner, isPartial }],
     *   categoryType: 'single' | 'none' | 'multiple',
     *   vendor: string | null,
     *   attributes: { code: value },
     *   priceFilter: { min, max } | null,
     *   limit: number,
     *   page: number,
     *   sort: string
     * }
     */
    router.post('/search', async (req, res) => {
        try {
            const { tenantId, ...spec } = req.body;

            if (!tenantId) {
                return res.status(400).json({ error: 'tenantId is required' });
            }

            const result = await searchInterface.execute(tenantId, spec);
            res.json(result);
        } catch (error) {
            console.error('[be3_ai:Search] Error:', error);
            res.status(500).json({
                error: 'Search execution failed',
                message: error.message,
                // Fail-safe: return empty result so pipeline can fall back gracefully
                products: [],
                total: 0,
                classification: 'none',
                vector_fallback_needed: true
            });
        }
    });
}

module.exports = { registerSearchRoutes };
