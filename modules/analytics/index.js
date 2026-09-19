const express = require('express');
const crypto = require('crypto');
const { query } = require('../../config/database');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../middleware/errorHandler');
const Permission = require('../../platform/core/roles/models/Permission');

function resolvePeriodToRange(period) {
    const now = new Date();
    let start = new Date();
    let end = new Date();

    // Default to end of today
    end.setHours(23, 59, 59, 999);

    switch (period) {
        case 'Today':
            start.setHours(0, 0, 0, 0);
            break;
        case 'Yesterday':
            start.setDate(now.getDate() - 1);
            start.setHours(0, 0, 0, 0);
            end.setDate(now.getDate() - 1);
            end.setHours(23, 59, 59, 999);
            break;
        case '7D':
            start.setDate(now.getDate() - 7);
            start.setHours(0, 0, 0, 0);
            break;
        case '30D':
            start.setDate(now.getDate() - 30);
            start.setHours(0, 0, 0, 0);
            break;
        case '90D':
            start.setDate(now.getDate() - 90);
            start.setHours(0, 0, 0, 0);
            break;
        case 'This Month':
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            break;
        case 'Last Month':
            // Start of last month
            start.setMonth(now.getMonth() - 1);
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            // End of last month (0th day of current month)
            end.setDate(0);
            end.setHours(23, 59, 59, 999);
            break;
        case 'Year to Date':
            start.setMonth(0);
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            break;
        default:
            start.setDate(now.getDate() - 30);
            start.setHours(0, 0, 0, 0);
            break;
    }

    return {
        start: start.toISOString(),
        end: end.toISOString()
    };
}

async function bootstrap(context) {
    const { app, eventBus } = context;

    // Helper to check for admin status
    const isAdmin = async (tenantId, userId) => {
        return await Permission.userHasPermission(tenantId, userId, '*');
    };

    /**
     * Cache Helper: getOrComputeCachedReport
     * Implements SWR (Stale-While-Revalidate) and manual refresh throttling
     */
    async function getOrComputeCachedReport({
        tenantId,
        userId,
        reportName,
        queryParams,
        computeFn,
        isSuper = false,
        forceRefresh = false
    }) {
        const cacheKey = crypto.createHash('md5')
            .update(`${reportName}:${isSuper ? 'admin' : userId}:${JSON.stringify(queryParams)}`)
            .digest('hex');

        // 1. Check existing cache
        const cacheRes = await query(
            'SELECT data, updated_at, expires_at FROM analytics_cache WHERE tenant_id = $1 AND cache_key = $2',
            [tenantId, cacheKey]
        );

        const cached = cacheRes.rows[0];
        const now = new Date();

        if (cached) {
            const updatedAt = new Date(cached.updated_at);
            const expiresAt = new Date(cached.expires_at);
            const minsSinceUpdate = (now - updatedAt) / (1000 * 60);
            const isStale = now >= expiresAt;

            // Manual Refresh Throttle (5 mins)
            if (forceRefresh && minsSinceUpdate < 5) {
                console.log(`[Analytics] Refresh throttled for ${reportName} (${minsSinceUpdate.toFixed(1)}m ago)`);
                return { data: cached.data, source: 'cache', throttled: true, updated_at: cached.updated_at };
            }

            // If forced refresh OR stale, trigger revalidation
            if (forceRefresh || isStale) {
                console.log(`[Analytics] ${forceRefresh ? 'Manual' : 'SWR'} trigger for ${reportName}`);

                // Background revalidation (fire-and-forget)
                // Use a simplified background task to avoid blocking the response
                const backgroundRevalidate = async () => {
                    try {
                        const newData = await computeFn();
                        await persistCache(tenantId, cacheKey, newData);
                        console.log(`[Analytics] Background revalidation complete for ${reportName}`);
                    } catch (err) {
                        console.error(`[Analytics] Background revalidation failed for ${reportName}:`, err.message);
                    }
                };

                if (forceRefresh) {
                    // For manual refresh, we actually wait (as per user requirement "return the new aggregate")
                    const newData = await computeFn();
                    await persistCache(tenantId, cacheKey, newData);
                    return { data: newData, source: 'fresh', updated_at: new Date() };
                } else {
                    // For SWR, return stale data immediately and revalidate in background
                    backgroundRevalidate();
                    return { data: cached.data, source: 'stale', updated_at: cached.updated_at };
                }
            }

            return { data: cached.data, source: 'cache', updated_at: cached.updated_at };
        }

        // 2. Absolute MISS: Compute fresh
        console.log(`[Analytics] Cache MISS for ${reportName}. Computing fresh...`);
        const data = await computeFn();
        await persistCache(tenantId, cacheKey, data);
        return { data, source: 'fresh', updated_at: new Date() };
    }

    async function persistCache(tenantId, cacheKey, data) {
        const expiry = new Date(Date.now() + 30 * 60 * 1000); // 30 mins TTL
        await query(
            `INSERT INTO analytics_cache (tenant_id, cache_key, data, expires_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (tenant_id, cache_key) 
             DO UPDATE SET data = $3, expires_at = $4, updated_at = NOW()`,
            [tenantId, cacheKey, JSON.stringify(data), expiry]
        );
    }

    // --- Report Computation Functions ---

    async function computeDashboardStats(tenantId, userId, isSuper, params = {}) {
        const { period = '30D', startDate, endDate } = params;
        let start, end;

        if (period && period !== 'Custom') {
            const range = resolvePeriodToRange(period);
            start = range.start;
            end = range.end;
        } else {
            end = endDate || new Date().toISOString().split('T')[0];
            start = startDate || new Date(new Date(end).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }

        if (isSuper) {
            // Determine limit based on period for daily_stats
            let limit = 30;
            if (period === 'Today') limit = 1;
            else if (period === 'Yesterday') limit = 1;
            else if (period === '7D') limit = 7;
            else if (period === '90D') limit = 90;
            else {
                // Calculate days between start and end
                const diffTime = Math.abs(new Date(end) - new Date(start));
                limit = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                if (limit > 365) limit = 365; // Sanity cap
            }

            const result = await query(
                `SELECT * FROM daily_stats 
                 WHERE tenant_id = $1 
                   AND date >= $2::date
                   AND date <= $3::date
                 ORDER BY date ASC`,
                [tenantId, start.split('T')[0], end.split('T')[0]]
            );


            // Daily traffic stats for Chart
            const dailyTrafficRes = await query(
                `SELECT 
                    date_trunc('day', created_at)::date as date,
                    COUNT(*) FILTER (WHERE event_type = 'impression') as impressions,
                    COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views,
                    COUNT(*) FILTER (WHERE event_type = 'click') as clicks
                 FROM analytics_events 
                 WHERE tenant_id = $1 
                   AND created_at >= $2::timestamp 
                   AND created_at <= $3::timestamp + INTERVAL '1 day'
                 GROUP BY 1 ORDER BY 1 ASC`,
                [tenantId, start, end]
            );

            // Merge daily stats with traffic
            const dailyStats = result.rows;
            const dailyTraffic = dailyTrafficRes.rows;

            // Robust merge of all dates
            const allDates = [...new Set([
                ...dailyStats.map(r => r.date.toISOString().split('T')[0]),
                ...dailyTraffic.map(r => r.date.toISOString().split('T')[0])
            ])].sort();

            const finalChartData = allDates.map(d => {
                const s = dailyStats.find(row => row.date.toISOString().split('T')[0] === d) || { order_count: 0, total_sales: 0, new_customers: 0 };
                const t = dailyTraffic.find(row => row.date.toISOString().split('T')[0] === d) || { impressions: 0, page_views: 0, clicks: 0 };
                return {
                    date: d,
                    order_count: parseInt(s.order_count || 0),
                    total_sales: parseFloat(s.total_sales || 0),
                    new_customers: parseInt(s.new_customers || 0),
                    impressions: parseInt(t.impressions || 0),
                    page_views: parseInt(t.page_views || 0),
                    clicks: parseInt(t.clicks || 0)
                };
            });

            const finalTotals = finalChartData.reduce((acc, curr) => ({
                sales: acc.sales + curr.total_sales,
                orders: acc.orders + curr.order_count,
                customers: acc.customers + curr.new_customers,
                impressions: acc.impressions + curr.impressions,
                page_views: acc.page_views + curr.page_views,
                clicks: acc.clicks + curr.clicks
            }), { sales: 0, orders: 0, customers: 0, impressions: 0, page_views: 0, clicks: 0 });

            return { totals: finalTotals, chart_data: finalChartData };
        }

        // Vendor-specific: Fetch products first to avoid slow JOIN
        const productsRes = await query(
            'SELECT id::text, handle, name FROM products WHERE tenant_id = $1 AND created_by::text = $2',
            [tenantId, userId]
        );
        const pIds = productsRes.rows.map(p => p.id);
        const pHandles = productsRes.rows.map(p => p.handle);
        const pNames = productsRes.rows.map(p => p.name);

        const ordersSql = `
            SELECT 
                date_trunc('day', created_at)::date as date,
                SUM(total) as total_sales,
                COUNT(*) as order_count
            FROM orders
            WHERE tenant_id = $1 AND vendor_id = $2
              AND created_at >= $3::timestamp
              AND created_at <= $4::timestamp + INTERVAL '1 day'
            GROUP BY 1
            ORDER BY 1 ASC`;

        const ordersResult = await query(ordersSql, [tenantId, userId, start, end]);

        const eventsSql = `
            SELECT 
                date_trunc('day', created_at)::date as date,
                COUNT(*) FILTER (WHERE event_type = 'impression') as impressions,
                COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views,
                COUNT(*) FILTER (WHERE event_type = 'click') as clicks
            FROM analytics_events
            WHERE tenant_id = $1
              AND created_at >= $2::timestamp
              AND created_at <= $3::timestamp + INTERVAL '1 day'
              AND (
                  (entity_type = 'product' AND (entity_id = ANY($4) OR entity_id = ANY($5) OR entity_id = ANY($6)))
                  OR (entity_type != 'product') -- Simple ownership for now
              )
            GROUP BY 1 ORDER BY 1 ASC`;

        const eventsResult = await query(eventsSql, [tenantId, start, end, pIds, pHandles, pNames]);

        // Merge stats
        const allDates = [...new Set([
            ...ordersResult.rows.map(r => r.date.toISOString().split('T')[0]),
            ...eventsResult.rows.map(r => r.date.toISOString().split('T')[0])
        ])].sort();

        const mergedChartData = allDates.map(d => {
            const o = ordersResult.rows.find(row => row.date.toISOString().split('T')[0] === d) || { order_count: 0, total_sales: 0 };
            const e = eventsResult.rows.find(row => row.date.toISOString().split('T')[0] === d) || { impressions: 0, page_views: 0, clicks: 0 };
            return {
                date: d,
                order_count: parseInt(o.order_count || 0),
                total_sales: parseFloat(o.total_sales || 0),
                impressions: parseInt(e.impressions || 0),
                page_views: parseInt(e.page_views || 0),
                clicks: parseInt(e.clicks || 0)
            };
        });

        const totals = mergedChartData.reduce((acc, curr) => ({
            ...acc,
            sales: acc.sales + curr.total_sales,
            orders: acc.orders + curr.order_count,
            impressions: acc.impressions + curr.impressions,
            page_views: acc.page_views + curr.page_views,
            clicks: acc.clicks + curr.clicks
        }), {
            sales: 0,
            orders: 0,
            customers: 0,
            impressions: 0,
            page_views: 0,
            clicks: 0
        });

        return { totals, chart_data: mergedChartData };
    }

    async function computeAdvancedStats(tenantId, userId, isSuper, params) {
        const { startDate, endDate, period, limit = 1000, offset = 0, orderBy = 'ctr' } = params;
        let start, end;

        if (period) {
            const range = resolvePeriodToRange(period);
            start = range.start;
            end = range.end;
        } else {
            end = endDate || new Date().toISOString().split('T')[0];
            start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }

        const userRes = await query('SELECT business_name FROM users WHERE id = $1', [userId]);
        const businessName = userRes.rows[0]?.business_name;

        const validSortColumns = ['impressions', 'clicks', 'ctr', 'global_rank', 'vendor_rank'];
        const sortCol = validSortColumns.includes(orderBy) ? orderBy : 'ctr';

        // Optimized computeAdvancedStats: Aggregate first, then join metadata
        const sql = `
            WITH event_counts AS (
                SELECT 
                    entity_type, 
                    entity_id, 
                    COUNT(*) FILTER (WHERE event_type = 'impression') as impressions,
                    COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views,
                    COUNT(*) FILTER (WHERE event_type = 'click') as clicks
                FROM analytics_events
                WHERE tenant_id = $1
                  AND created_at >= $2::timestamp
                  AND created_at <= $3::timestamp + INTERVAL '1 day'
                GROUP BY 1, 2
            ),
            metadata AS (
                SELECT 'product' as type, id::text as eid, name, image_url as thumbnail, created_by::text as owner_id FROM products WHERE tenant_id = $1
                UNION ALL
                SELECT 'category' as type, id::text as eid, name, NULL::text as thumbnail, NULL::text as owner_id FROM categories WHERE tenant_id = $1
                UNION ALL
                SELECT 'collection' as type, id::text as eid, name, NULL::text as thumbnail, created_by::text as owner_id FROM collections WHERE tenant_id = $1
                UNION ALL
                SELECT 'page' as type, id::text as eid, title as name, NULL::text as thumbnail, NULL::text as owner_id FROM pages WHERE tenant_id = $1
            ),
            combined_stats AS (
                SELECT 
                    ec.entity_type,
                    ec.entity_id,
                    COALESCE(m.name, ec.entity_id) as entity_name,
                    m.thumbnail,
                    m.owner_id,
                    ec.impressions,
                    ec.page_views,
                    ec.clicks,
                    CASE 
                        WHEN ec.impressions > 0 THEN ROUND((ec.clicks::decimal / ec.impressions::decimal) * 100, 2)
                        ELSE 0 
                    END as ctr
                FROM event_counts ec
                LEFT JOIN metadata m ON ec.entity_type = m.type AND ec.entity_id = m.eid
            ),
            ranked AS (
                SELECT 
                    *,
                    RANK() OVER (PARTITION BY entity_type ORDER BY ctr DESC, clicks DESC, impressions DESC) as global_rank,
                    CASE 
                        WHEN owner_id IS NOT NULL THEN RANK() OVER (PARTITION BY entity_type, owner_id ORDER BY ctr DESC, clicks DESC, impressions DESC)
                        ELSE NULL
                    END as vendor_rank,
                    COUNT(*) OVER (PARTITION BY entity_type) as total_in_type,
                    CASE 
                        WHEN owner_id IS NOT NULL THEN COUNT(*) OVER (PARTITION BY entity_type, owner_id)
                        ELSE NULL
                    END as total_in_vendor
                FROM combined_stats
            )
            SELECT * FROM ranked 
            WHERE ($6 = TRUE OR (entity_type = 'product' AND owner_id = $7::text) OR (entity_type != 'product'))
            AND (vendor_rank <= 100 OR vendor_rank IS NULL)
            ORDER BY ${sortCol === 'ctr' ? 'ctr DESC, clicks DESC, impressions DESC' : sortCol + ' DESC'}
            LIMIT $4 OFFSET $5`;

        const result = await query(sql, [
            tenantId, start, end, parseInt(limit), parseInt(offset),
            isSuper, userId
        ]);
        if (result.rows.length > 0) {
            console.log('[Analytics Debug] First Row:', JSON.stringify(result.rows[0], null, 2));
        }
        return result.rows;
    }

    async function computeDetailsStats(tenantId, type, id, params = {}) {
        const { period = '30D', startDate, endDate } = params;
        let start, end;

        if (period && period !== 'Custom') {
            const range = resolvePeriodToRange(period);
            start = range.start;
            end = range.end;
        } else {
            end = endDate || new Date().toISOString().split('T')[0];
            start = startDate || new Date(new Date(end).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }

        // Resolve identifiers for the target entity
        let identifiers = [id];
        if (type === 'product') {
            const pRes = await query(
                'SELECT id::text, handle, name FROM products WHERE (id::text = $1 OR handle = $1 OR name = $1) AND tenant_id = $2',
                [id, tenantId]
            );
            if (pRes.rows[0]) {
                const p = pRes.rows[0];
                identifiers = [...new Set([p.id, p.handle, p.name, id])];
            }
        }

        const statsSql = `
            SELECT 
                COALESCE(placement_type, 'page') as placement_type,
                COUNT(*) FILTER (WHERE event_type = 'impression') as impressions,
                COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views,
                COUNT(*) FILTER (WHERE event_type = 'click') as clicks
            FROM analytics_events 
            WHERE tenant_id = $1 
              AND entity_type = $2 
              AND entity_id = ANY($3)
              AND created_at >= $4::timestamp
              AND created_at <= $5::timestamp + INTERVAL '1 day'
            GROUP BY 1`;

        const result = await query(statsSql, [tenantId, type, identifiers, start, end]);

        const referrerSql = `
            SELECT 
                COALESCE(NULLIF(SPLIT_PART(REPLACE(REPLACE(REPLACE(referrer_url, 'https://', ''), 'http://', ''), 'www.', ''), '/', 1), ''), 'direct') as source,
                COUNT(*) as count
            FROM analytics_events 
            WHERE tenant_id = $1 
              AND entity_type = $2 
              AND entity_id = ANY($3)
              AND event_type = 'page_view'
              AND created_at >= $4::timestamp
              AND created_at <= $5::timestamp + INTERVAL '1 day'
            GROUP BY 1
            ORDER BY count DESC
            LIMIT 10`;

        const referrerResult = await query(referrerSql, [tenantId, type, identifiers, start, end]);

        return { surfaces: result.rows, referrers: referrerResult.rows };
    }

    async function computeSurfacesStats(tenantId, userId, isSuper, params) {
        const { startDate, endDate, period } = params;
        let start, end;

        if (period) {
            const range = resolvePeriodToRange(period);
            start = range.start;
            end = range.end;
        } else {
            end = endDate || new Date().toISOString().split('T')[0];
            start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }

        let vendorProductIds = null;
        if (!isSuper) {
            const productsRes = await query(
                'SELECT id::text, handle, name FROM products WHERE tenant_id = $1 AND created_by::text = $2',
                [tenantId, userId]
            );
            // Collect all possible identifiers used in entity_id
            vendorProductIds = productsRes.rows.flatMap(p => [p.id, p.handle, p.name]);
        }

        const sql = `
            SELECT 
                CASE 
                    WHEN placement_type IS NULL OR placement_type = 'page' THEN 'general'
                    ELSE placement_type
                END as placement_type,
                COUNT(*) FILTER (WHERE event_type = 'impression') as impressions,
                COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views,
                COUNT(*) FILTER (WHERE event_type = 'click') as clicks
            FROM analytics_events
            WHERE tenant_id = $1
              AND created_at >= $2::timestamp
              AND created_at <= $3::timestamp + INTERVAL '1 day'
              AND ($4 = TRUE OR (entity_type = 'product' AND entity_id = ANY($5)))
            GROUP BY 1
            ORDER BY impressions DESC`;

        const result = await query(sql, [tenantId, start, end, isSuper, vendorProductIds]);
        return result.rows;
    }

    // --- Routes ---

    try {
        const router = express.Router();
        router.use(subscriptionGuard('analytics'));

        // Get Dashboard Stats (SWR + Cache)
        router.get('/dashboard', authenticate, asyncHandler(async (req, res) => {
            const isSuper = await isAdmin(req.tenantId, req.user.id);
            const refresh = req.query.refresh === 'true';
            const { period = '30D', startDate, endDate } = req.query;
            const params = { period, startDate, endDate };

            const report = await getOrComputeCachedReport({
                tenantId: req.tenantId,
                userId: req.user.id,
                reportName: 'dashboard_summary',
                queryParams: params,
                isSuper,
                forceRefresh: refresh,
                computeFn: () => computeDashboardStats(req.tenantId, req.user.id, isSuper, params)
            });

            res.json({
                success: true,
                ...report.data,
                _meta: { source: report.source, throttled: report.throttled, updated_at: report.updated_at }
            });
        }));

        // Advanced Analytics Stats (SWR + Cache)
        router.get('/stats', authenticate, asyncHandler(async (req, res) => {
            const isSuper = await isAdmin(req.tenantId, req.user.id);
            const refresh = req.query.refresh === 'true';
            const { startDate, endDate, limit, offset, orderBy, period = '30D' } = req.query;
            const params = { startDate, endDate, limit, offset, orderBy, period };

            const report = await getOrComputeCachedReport({
                tenantId: req.tenantId,
                userId: req.user.id,
                reportName: 'advanced_stats',
                queryParams: params,
                isSuper,
                forceRefresh: refresh,
                computeFn: () => computeAdvancedStats(req.tenantId, req.user.id, isSuper, params)
            });

            res.json({
                success: true,
                data: report.data,
                _meta: { source: report.source, throttled: report.throttled, updated_at: report.updated_at }
            });
        }));

        // Surface Analysis (SWR + Cache)
        router.get('/surfaces', authenticate, asyncHandler(async (req, res) => {
            const isSuper = await isAdmin(req.tenantId, req.user.id);
            const refresh = req.query.refresh === 'true';
            const { startDate, endDate, period = '30D' } = req.query;
            const params = { startDate, endDate, period };

            const report = await getOrComputeCachedReport({
                tenantId: req.tenantId,
                userId: req.user.id,
                reportName: 'surface_analysis',
                queryParams: params,
                isSuper,
                forceRefresh: refresh,
                computeFn: () => computeSurfacesStats(req.tenantId, req.user.id, isSuper, params)
            });

            res.json({
                success: true,
                data: report.data,
                _meta: { source: report.source, throttled: report.throttled, updated_at: report.updated_at }
            });
        }));

        // Product Real-time Stats (Public/Optional Auth)
        router.get('/product-stats', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId } = req;
            const { productIds } = req.query; // Comma separated IDs

            if (!productIds) {
                return res.json({ success: true, data: {} });
            }

            const ids = productIds.split(',').filter(id => id);

            if (ids.length === 0) {
                return res.json({ success: true, data: {} });
            }

            // 1. Get Impressions (All time)
            const impressionsRes = await query(
                `SELECT entity_id, COUNT(*) as count 
                 FROM analytics_events 
                 WHERE tenant_id = $1 
                   AND event_type = 'impression' 
                   AND entity_type = 'product' 
                   AND entity_id = ANY($2)
                 GROUP BY entity_id`,
                [tenantId, ids]
            );

            // 2. Get Wishlist Counts
            const wishlistRes = await query(
                `SELECT product_id, COUNT(*) as count 
                 FROM wishlists 
                 WHERE tenant_id = $1 
                   AND product_id = ANY($2)
                 GROUP BY product_id`,
                [tenantId, ids]
            );

            // Map results
            const stats = {};
            ids.forEach(id => {
                const imp = impressionsRes.rows.find(r => r.entity_id === id);
                const wish = wishlistRes.rows.find(r => r.product_id === id);

                stats[id] = {
                    impressions: parseInt(imp?.count || 0),
                    wishlist_count: parseInt(wish?.count || 0)
                };
            });

            res.json({ success: true, data: stats });
        }));

        // Detail View (SWR + Cache)
        router.get('/details/:type/:id', authenticate, asyncHandler(async (req, res) => {
            const { type, id } = req.params;
            const isSuper = await isAdmin(req.tenantId, req.user.id);
            const refresh = req.query.refresh === 'true';
            const { period = '30D', startDate, endDate } = req.query;
            const params = { period, startDate, endDate };

            const report = await getOrComputeCachedReport({
                tenantId: req.tenantId,
                userId: req.user.id,
                reportName: 'entity_details',
                queryParams: { type, id, ...params },
                isSuper,
                forceRefresh: refresh,
                computeFn: () => computeDetailsStats(req.tenantId, type, id, params)
            });
            res.json({
                success: true,
                ...report.data,
                _meta: { source: report.source, throttled: report.throttled, updated_at: report.updated_at }
            });
        }));

        // Product Journey Analysis
        router.get('/journey/:type/:id', authenticate, asyncHandler(async (req, res) => {
            const { type, id } = req.params;
            const { tenantId } = req;

            const eventsRes = await query(
                `WITH target_id AS (
                    SELECT id FROM products WHERE (id::text = $3 OR handle = $3) AND tenant_id = $1
                    UNION ALL
                    SELECT id FROM categories WHERE (id::text = $3 OR slug = $3) AND tenant_id = $1
                    UNION ALL
                    SELECT id FROM collections WHERE (id::text = $3 OR slug = $3) AND tenant_id = $1
                )
                SELECT 
                    event_type, 
                    session_id, 
                    created_at, 
                    metadata
                 FROM analytics_events 
                 WHERE tenant_id = $1 
                   AND (
                       (entity_type = $2 AND (
                           entity_id = $3 
                           OR entity_id IN (SELECT id::text FROM target_id)
                       ))
                       OR (event_type = 'checkout_success' AND session_id IN (
                           SELECT session_id FROM analytics_events 
                           WHERE tenant_id = $1 AND entity_type = $2 AND (
                               entity_id = $3 
                               OR entity_id IN (SELECT id::text FROM target_id)
                           ) AND event_type = 'add_to_cart'
                       ))
                   )
                 ORDER BY created_at DESC`,
                [tenantId, type, id]
            );

            const events = eventsRes.rows;
            const lifecycles = [];
            let sessionGroups = {};

            [...events].reverse().forEach(event => {
                const sid = event.session_id;
                if (!sessionGroups[sid]) {
                    sessionGroups[sid] = {
                        session_id: sid,
                        first_add_date: null,
                        last_activity: event.created_at,
                        total_added: 0,
                        total_removed: 0,
                        current_quantity: 0,
                        status: 'shopping'
                    };
                }

                const cycle = sessionGroups[sid];
                cycle.last_activity = event.created_at;

                if (event.event_type === 'add_to_cart') {
                    if (!cycle.first_add_date) cycle.first_add_date = event.created_at;
                    const qty = parseInt(event.metadata?.quantity || 1);
                    cycle.total_added += qty;
                    cycle.current_quantity += qty;
                } else if (event.event_type === 'remove_from_cart') {
                    const qty = parseInt(event.metadata?.quantity || 1);
                    cycle.total_removed += qty;
                    cycle.current_quantity -= qty;
                    if (cycle.current_quantity <= 0 && cycle.first_add_date) {
                        cycle.status = 'empty';
                        lifecycles.push({ ...cycle });
                        sessionGroups[sid] = null;
                    }
                } else if (event.event_type === 'checkout_success') {
                    if (cycle.first_add_date) {
                        cycle.status = 'purchased';
                        lifecycles.push({ ...cycle });
                    }
                    sessionGroups[sid] = null;
                }
            });

            const THRESHOLD_MINS = 60 * 24 * 7;
            Object.values(sessionGroups).forEach(cycle => {
                if (!cycle || !cycle.first_add_date) return;
                const lastActive = new Date(cycle.last_activity);
                const now = new Date();
                const diffMins = (now - lastActive) / (1000 * 60);
                cycle.status = diffMins > THRESHOLD_MINS ? 'abandoned' : 'shopping';
                lifecycles.push(cycle);
            });

            const finalLifecycles = lifecycles
                .map(lc => {
                    const start = new Date(lc.first_add_date);
                    const end = (lc.status === 'shopping' || lc.status === 'abandoned') ? new Date() : new Date(lc.last_activity);
                    const durationMs = end - start;
                    return {
                        session_id: lc.session_id,
                        date: lc.first_add_date,
                        added: lc.total_added,
                        removed: lc.total_removed,
                        in_cart: Math.max(0, lc.current_quantity),
                        duration: formatDuration(durationMs),
                        status: lc.status
                    };
                })
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            res.json({ success: true, lifecycles: finalLifecycles });
        }));

        function formatDuration(ms) {
            if (ms < 0) return '0s';
            const seconds = Math.floor((ms / 1000) % 60);
            const minutes = Math.floor((ms / (1000 * 60)) % 60);
            const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
            const days = Math.floor(ms / (1000 * 60 * 60 * 24));
            const parts = [];
            if (days > 0) parts.push(`${days}d`);
            if (hours > 0) parts.push(`${hours}h`);
            if (minutes > 0) parts.push(`${minutes}m`);
            if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
            return parts.join(' ');
        }

        // Collection Endpoint
        router.post('/collect', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { batch, events, ...singleEvent } = req.body;
            const eventsToProcess = batch ? events : [{ ...singleEvent }];

            if (!eventsToProcess || eventsToProcess.length === 0) {
                return res.status(400).json({ success: false, error: 'No events provided' });
            }

            const ip_address = req.ip || req.connection.remoteAddress;
            const user_agent = req.get('user-agent');

            for (const event of eventsToProcess) {
                const {
                    event_type, entity_type, entity_id,
                    placement_id, placement_type, position,
                    referrer_entity_type, referrer_entity_id, referrer_url,
                    session_id, metadata = {}
                } = event;

                if (!event_type || !entity_type || !entity_id) continue;

                await query(
                    `INSERT INTO analytics_events (
                        tenant_id, event_type, entity_type, entity_id,
                        user_id, session_id, ip_address, user_agent,
                        placement_id, placement_type, position,
                        referrer_entity_type, referrer_entity_id, referrer_url,
                        metadata
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                    [
                        tenantId, event_type, entity_type, entity_id.toString(),
                        user ? user.id : null, session_id || 'anonymous', ip_address, user_agent,
                        placement_id || null, placement_type || null, position ? parseInt(position) : null,
                        referrer_entity_type || null, referrer_entity_id || null, referrer_url || null,
                        JSON.stringify(metadata)
                    ]
                );

                eventBus.emitEvent(`analytics.${event_type}`, {
                    tenantId, entityType: entity_type, entityId: entity_id, metadata
                });
            }

            res.json({ success: true, processed: eventsToProcess.length });
        }));

        async function updateDailyStat(tenantId, column, value = 1) {
            try {
                const date = new Date().toISOString().split('T')[0];
                await query(
                    `INSERT INTO daily_stats (tenant_id, date, ${column})
                     VALUES ($1, $2, $3)
                     ON CONFLICT (tenant_id, date)
                     DO UPDATE SET ${column} = daily_stats.${column} + $3, updated_at = NOW()`,
                    [tenantId, date, value]
                );
            } catch (err) {
                console.error('[Analytics] updateDailyStat failed:', err.message);
            }
        }

        eventBus.registerListener('order.created', async (event) => {
            const { tenantId, orderId } = event.data;
            const orderRes = await query('SELECT total FROM orders WHERE id = $1', [orderId]);
            if (orderRes.rows[0]) {
                const total = orderRes.rows[0].total;
                await updateDailyStat(tenantId, 'order_count', 1);
                await updateDailyStat(tenantId, 'total_sales', total);
            }
        }, 'analytics');

        eventBus.registerListener('user.registered', async (event) => {
            await updateDailyStat(event.data.tenantId, 'new_customers', 1);
        }, 'analytics');

        app.use('/analytics', router);
        console.log('[Analytics] Module initialized with SWR Cache');
        return true;
    } catch (error) {
        console.error('[Analytics] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };

