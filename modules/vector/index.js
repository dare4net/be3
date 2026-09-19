/**
 * Vector Module Bootstrapper
 * 
 * PRINCIPLE: Modules do not import other modules
 * PRINCIPLE: All inter-module communication is event-based
 * 
 * Provides vector/semantic search capabilities using pgvector + transformer embeddings.
 * This module exposes an internal API for other modules (like search) to consume.
 */

const express = require('express');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const VectorEngine = require('./services/VectorEngine');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();
        const vectorEngine = new VectorEngine();

        // Apply subscription guard
        router.use(subscriptionGuard('vector'));

        // ── Health check ──
        router.get('/status', async (req, res) => {
            try {
                const stats = await vectorEngine.getStats(req.tenantId);
                res.json({
                    status: 'online',
                    model: vectorEngine.modelName,
                    dimensions: vectorEngine.dimensions,
                    ...stats
                });
            } catch (err) {
                res.status(500).json({ error: 'Vector engine health check failed', details: err.message });
            }
        });

        // ── Semantic search ──
        router.get('/search', async (req, res) => {
            try {
                const { query: searchQuery, limit = 20, threshold = 0.3, category_id } = req.query;
                if (!searchQuery) {
                    return res.status(400).json({ error: 'query parameter is required' });
                }

                const results = await vectorEngine.semanticSearch(req.tenantId, searchQuery, {
                    limit: parseInt(limit),
                    threshold: parseFloat(threshold),
                    categoryId: category_id
                });

                res.json({
                    success: true,
                    data: {
                        results,
                        total: results.length,
                        query: searchQuery
                    }
                });
            } catch (err) {
                console.error('[Vector] Search error:', err.message);
                res.status(500).json({ error: 'Semantic search failed', details: err.message });
            }
        });
 
        // ── Hybrid search (Text Rank + Vector Similarity) ──
        router.get('/hybrid-search', async (req, res) => {
            try {
                const { query: searchQuery, limit = 20, alpha = 0.6 } = req.query;
                if (!searchQuery) {
                    return res.status(400).json({ error: 'query parameter is required' });
                }
 
                const results = await vectorEngine.hybridSearch(req.tenantId, searchQuery, {
                    limit: parseInt(limit),
                    alpha: parseFloat(alpha)
                });
 
                res.json({
                    success: true,
                    data: {
                        results,
                        total: results.length,
                        query: searchQuery
                    }
                });
            } catch (err) {
                console.error('[Vector] Hybrid search error:', err.message);
                res.status(500).json({ error: 'Hybrid search failed', details: err.message });
            }
        });

        // ── Generate embedding for a single product ──
        router.post('/embed/product/:productId', async (req, res) => {
            try {
                const result = await vectorEngine.embedProduct(req.tenantId, req.params.productId);
                res.json({ success: true, ...result });
            } catch (err) {
                console.error('[Vector] Embed product error:', err.message);
                res.status(500).json({ error: 'Failed to embed product', details: err.message });
            }
        });

        // ── Bulk embed all products for a tenant ──
        router.post('/embed/all', async (req, res) => {
            try {
                const { force = false } = req.body;
                const result = await vectorEngine.embedAllProducts(req.tenantId, { force });
                res.json({ success: true, ...result });
            } catch (err) {
                console.error('[Vector] Bulk embed error:', err.message);
                res.status(500).json({ error: 'Bulk embedding failed', details: err.message });
            }
        });

        // ── Find similar products ──
        router.get('/similar/:productId', async (req, res) => {
            try {
                const { limit = 5 } = req.query;
                const results = await vectorEngine.findSimilarProducts(req.tenantId, req.params.productId, {
                    limit: parseInt(limit)
                });
                res.json({ success: true, data: results });
            } catch (err) {
                console.error('[Vector] Similar products error:', err.message);
                res.status(500).json({ error: 'Failed to find similar products', details: err.message });
            }
        });

        // ── Delete embeddings for a tenant ──
        router.delete('/embeddings', async (req, res) => {
            try {
                const result = await vectorEngine.clearEmbeddings(req.tenantId);
                res.json({ success: true, ...result });
            } catch (err) {
                console.error('[Vector] Clear embeddings error:', err.message);
                res.status(500).json({ error: 'Failed to clear embeddings', details: err.message });
            }
        });

        // ── Listen for product events to keep embeddings in sync ──
        if (eventBus) {
            eventBus.on('product:created', async (data) => {
                try {
                    await vectorEngine.embedProduct(data.tenantId, data.productId);
                    console.log(`[Vector] Auto-embedded new product: ${data.productId}`);
                } catch (err) {
                    console.error(`[Vector] Failed to auto-embed product ${data.productId}:`, err.message);
                }
            });

            eventBus.on('product:updated', async (data) => {
                try {
                    await vectorEngine.embedProduct(data.tenantId, data.productId);
                    console.log(`[Vector] Re-embedded updated product: ${data.productId}`);
                } catch (err) {
                    console.error(`[Vector] Failed to re-embed product ${data.productId}:`, err.message);
                }
            });

            eventBus.on('product:deleted', async (data) => {
                try {
                    await vectorEngine.clearProductEmbedding(data.tenantId, data.productId);
                    console.log(`[Vector] Cleared embedding for deleted product: ${data.productId}`);
                } catch (err) {
                    console.error(`[Vector] Failed to clear embedding for product ${data.productId}:`, err.message);
                }
            });
        }

        // Mount router
        app.use('/vector', router);

        // Expose the engine instance on app for other modules to use
        app.set('vectorEngine', vectorEngine);

        console.log('[Vector] Module initialized');
        return true;
    } catch (error) {
        console.error('[Vector] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
