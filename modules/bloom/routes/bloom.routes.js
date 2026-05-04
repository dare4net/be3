/**
 * Bloom Admin Routes
 * 
 * Admin-gated endpoints for managing Bloom filters.
 * - POST /rebuild — Full rebuild for a tenant
 * - GET /health — Filter stats and diagnostics
 * - POST /test — Debug: test tokens against filters
 */

const BloomFilterService = require('../services/BloomFilterService');

function registerBloomRoutes(router) {
    const bloomService = new BloomFilterService();

    /**
     * POST /bloom/rebuild
     * Full rebuild of global + all category filters for the authenticated tenant.
     */
    router.post('/rebuild', async (req, res) => {
        try {
            const tenantId = req.tenantId;
            if (!tenantId) return res.status(400).json({ error: 'Missing tenant context' });

            const result = await bloomService.rebuildAll(tenantId);
            res.json({ success: true, ...result });
        } catch (error) {
            console.error('[Bloom:Route] Rebuild failed:', error);
            res.status(500).json({ error: 'Rebuild failed', message: error.message });
        }
    });

    /**
     * GET /bloom/health
     * Returns filter statistics for the authenticated tenant.
     */
    router.get('/health', async (req, res) => {
        try {
            const tenantId = req.tenantId;
            if (!tenantId) return res.status(400).json({ error: 'Missing tenant context' });

            const health = await bloomService.getHealth(tenantId);
            res.json(health);
        } catch (error) {
            console.error('[Bloom:Route] Health check failed:', error);
            res.status(500).json({ error: 'Health check failed', message: error.message });
        }
    });

    /**
     * POST /bloom/test
     * Debug endpoint: test tokens against global/category filters.
     * Body: { tokens: string[], categoryId?: string }
     */
    router.post('/test', async (req, res) => {
        try {
            const tenantId = req.tenantId;
            if (!tenantId) return res.status(400).json({ error: 'Missing tenant context' });

            const { tokens, categoryId } = req.body;
            if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
                return res.status(400).json({ error: 'tokens must be a non-empty array of strings' });
            }

            const globalResult = await bloomService.testGlobal(tenantId, tokens);

            let categoryResult = null;
            if (categoryId) {
                categoryResult = await bloomService.testCategory(tenantId, categoryId, tokens);
            }

            res.json({
                tokens,
                global: globalResult,
                category: categoryResult
            });
        } catch (error) {
            console.error('[Bloom:Route] Test failed:', error);
            res.status(500).json({ error: 'Test failed', message: error.message });
        }
    });

    /**
     * POST /bloom/scan
     * Manually trigger the scanner to check all tenants.
     */
    router.post('/scan', async (req, res) => {
        try {
            const result = await bloomService.scan();
            res.json({ success: true, ...result });
        } catch (error) {
            console.error('[Bloom:Route] Scan failed:', error);
            res.status(500).json({ error: 'Scan failed', message: error.message });
        }
    });
}

module.exports = { registerBloomRoutes };
