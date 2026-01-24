/**
 * Analytics Routes
 * Search analytics and tracking endpoints
 */

const { authenticate, optionalAuth } = require('../../../platform/core/auth/middleware/authenticate');
const authorize = require('../../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../../middleware/errorHandler');
const SearchAnalyticsService = require('../services/SearchAnalyticsService');

function registerAnalyticsRoutes(router) {
    // Get search analytics
    router.get('/analytics', authenticate, authorize('search.analytics'), asyncHandler(async (req, res) => {
        const analyticsService = new SearchAnalyticsService();
        const {
            start_date,
            end_date,
            group_by = 'day',
            type = 'summary'
        } = req.query;

        let data;
        if (type === 'popular') {
            data = await analyticsService.getPopularQueries(req.tenantId, 20, 30);
        } else if (type === 'no_results') {
            data = await analyticsService.getNoResultsQueries(req.tenantId, 20);
        } else {
            data = await analyticsService.getAnalytics(req.tenantId, {
                startDate: start_date,
                endDate: end_date,
                groupBy: group_by
            });
        }

        res.json({ success: true, data });
    }));

    // Track click on search result
    router.post('/analytics/click', optionalAuth, asyncHandler(async (req, res) => {
        const analyticsService = new SearchAnalyticsService();
        const { query: searchQuery, content_id, content_type } = req.body;

        if (!searchQuery || !content_id || !content_type) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'query, content_id, and content_type are required'
            });
        }

        await analyticsService.trackClick(
            req.tenantId,
            searchQuery,
            content_id,
            content_type,
            req.query.session_id || null,
            req.user?.id || null
        );

        res.json({ success: true, message: 'Click tracked' });
    }));
}

module.exports = { registerAnalyticsRoutes };
