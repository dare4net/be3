/**
 * Search Analytics Service
 * Tracks search queries and provides analytics
 */

const { query } = require('../../../config/database');

class SearchAnalyticsService {
    /**
     * Track a search query
     * @param {string} tenantId
     * @param {Object} params - { query, filters, resultCount, sessionId, userId }
     */
    async trackSearch(tenantId, params) {
        const {
            query: searchQuery,
            filters = {},
            resultCount = 0,
            sessionId = null,
            userId = null
        } = params;

        const sql = `
            INSERT INTO search_analytics 
            (tenant_id, query, filters, result_count, has_results, session_id, user_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        await query(sql, [
            tenantId,
            searchQuery,
            JSON.stringify(filters),
            resultCount,
            resultCount > 0,
            sessionId,
            userId
        ]);
    }

    /**
     * Track a click on a search result
     * @param {string} tenantId
     * @param {string} query
     * @param {string} contentId
     * @param {string} contentType
     * @param {string} sessionId
     * @param {string} userId
     */
    async trackClick(tenantId, query, contentId, contentType, sessionId = null, userId = null) {
        const sql = `
            UPDATE search_analytics
            SET clicked_result_id = $1,
                content_type = $2
            WHERE tenant_id = $3
            AND query = $4
            AND session_id = COALESCE($5, session_id)
            AND clicked_result_id IS NULL
            ORDER BY created_at DESC
            LIMIT 1
        `;

        await query(sql, [contentId, contentType, tenantId, query, sessionId]);
    }

    /**
     * Get popular queries
     * @param {string} tenantId
     * @param {number} limit
     * @param {number} days - Number of days to look back
     * @returns {Array}
     */
    async getPopularQueries(tenantId, limit = 10, days = 30) {
        const sql = `
            SELECT 
                query, 
                COUNT(*) as count,
                AVG(result_count)::int as avg_results,
                SUM(CASE WHEN clicked_result_id IS NOT NULL THEN 1 ELSE 0 END) as clicks
            FROM search_analytics
            WHERE tenant_id = $1
            AND created_at > NOW() - INTERVAL '${days} days'
            GROUP BY query
            ORDER BY count DESC
            LIMIT $2
        `;

        const results = await query(sql, [tenantId, limit]);
        return results.rows;
    }

    /**
     * Get queries with no results (content gaps)
     * @param {string} tenantId
     * @param {number} limit
     * @returns {Array}
     */
    async getNoResultsQueries(tenantId, limit = 10) {
        const sql = `
            SELECT 
                query, 
                COUNT(*) as count
            FROM search_analytics
            WHERE tenant_id = $1
            AND has_results = false
            AND created_at > NOW() - INTERVAL '30 days'
            GROUP BY query
            ORDER BY count DESC
            LIMIT $2
        `;

        const results = await query(sql, [tenantId, limit]);
        return results.rows;
    }

    /**
     * Get search analytics summary
     * @param {string} tenantId
     * @param {Object} params - { startDate, endDate, groupBy }
     * @returns {Object}
     */
    async getAnalytics(tenantId, params = {}) {
        const {
            startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            endDate = new Date().toISOString(),
            groupBy = 'day'
        } = params;

        let dateFormat = "DATE(created_at)";
        if (groupBy === 'hour') {
            dateFormat = "DATE_TRUNC('hour', created_at)";
        } else if (groupBy === 'week') {
            dateFormat = "DATE_TRUNC('week', created_at)";
        } else if (groupBy === 'month') {
            dateFormat = "DATE_TRUNC('month', created_at)";
        }

        const sql = `
            SELECT 
                ${dateFormat} as period,
                COUNT(*) as total_searches,
                COUNT(DISTINCT query) as unique_queries,
                COUNT(DISTINCT session_id) as unique_sessions,
                AVG(result_count)::numeric(10,2) as avg_results,
                SUM(CASE WHEN has_results = false THEN 1 ELSE 0 END) as no_result_searches,
                SUM(CASE WHEN clicked_result_id IS NOT NULL THEN 1 ELSE 0 END) as clicks
            FROM search_analytics
            WHERE tenant_id = $1
            AND created_at >= $2
            AND created_at <= $3
            GROUP BY period
            ORDER BY period ASC
        `;

        const results = await query(sql, [tenantId, startDate, endDate]);
        return results.rows;
    }
}

module.exports = SearchAnalyticsService;
