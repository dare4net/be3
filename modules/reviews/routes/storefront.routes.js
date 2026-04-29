/**
 * Reviews Storefront Routes
 * Public-facing endpoints for reading reviews and rating summaries
 */

const { query } = require('../../../config/database');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ReviewService = require('../services/ReviewService');

function registerStorefrontRoutes(router) {

    // Get paginated reviews for a product (public)
    // Optional: pass x-user-id header (from storefront auth) for personalization
    router.get('/product/:productId', asyncHandler(async (req, res) => {
        const { productId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 10;
        
        // Optional user context for "has voted" and "is own" flags
        const requestingUserId = req.headers['x-user-id'] || null;

        const result = await ReviewService.getProductReviews(
            req.tenantId, productId,
            { page, perPage, requestingUserId }
        );

        // Also include the summary
        const summary = await ReviewService.getSummary(req.tenantId, productId);

        res.json({
            success: true,
            ...result,
            summary
        });
    }));

    // Get rating summary only (lightweight, for product cards/headers)
    router.get('/product/:productId/summary', asyncHandler(async (req, res) => {
        const summary = await ReviewService.getSummary(req.tenantId, req.params.productId);
        res.json({ success: true, summary });
    }));
}

module.exports = { registerStorefrontRoutes };
