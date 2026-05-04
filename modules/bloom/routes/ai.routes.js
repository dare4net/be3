/**
 * Bloom AI Routes
 * 
 * AI-facing endpoints called by the be3_ai pipeline.
 * Secured by API key validation (not user auth).
 * 
 * - POST /bloom/ai/check — Batch token check (global + categories)
 */

const BloomFilterService = require('../services/BloomFilterService');

function registerAIRoutes(router) {
    const bloomService = new BloomFilterService();

    /**
     * POST /bloom/ai/check
     * 
     * Called by the AI pipeline during entity extraction (Steps 1-2).
     * Accepts tokens and optional category candidates, returns pass/fail per scope.
     * 
     * Body: {
     *   tenantId: string,          // Required: tenant scope
     *   tokens: string[],          // Required: query tokens to check
     *   candidateCategories: string[] // Optional: category IDs to check individually
     * }
     * 
     * Response: {
     *   global: { passed, hits, misses, source },
     *   categories: { [catId]: { passed, hits, misses, source } }
     * }
     */
    router.post('/ai/check', async (req, res) => {
        try {
            const { tenantId, tokens, candidateCategories = [] } = req.body;

            if (!tenantId) {
                return res.status(400).json({ error: 'tenantId is required' });
            }
            if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
                return res.status(400).json({ error: 'tokens must be a non-empty array' });
            }

            const result = await bloomService.batchCheck(tenantId, tokens, candidateCategories);
            res.json(result);
        } catch (error) {
            console.error('[Bloom:AI] Check failed:', error);
            // Fail-open: return all-pass so the AI pipeline isn't blocked
            res.json({
                global: { passed: true, hits: req.body.tokens || [], misses: [], source: 'error-failopen' },
                categories: {}
            });
        }
    });
}

module.exports = { registerAIRoutes };
