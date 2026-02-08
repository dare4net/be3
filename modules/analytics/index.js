/**
 * Analytics Module Bootstrapper
 * 
 * PRINCIPLE: All inter-module communication is event-based
 * Aggregates data from various system events
 */

const express = require('express');
const { query } = require('../../config/database');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../middleware/errorHandler');
const Permission = require('../../platform/core/roles/models/Permission');

async function bootstrap(context) {
    const { app, eventBus } = context;

    // Helper to check for admin status
    const isAdmin = async (tenantId, userId) => {
        return await Permission.userHasPermission(tenantId, userId, '*');
    };

    try {
        const router = express.Router();
        router.use(subscriptionGuard('analytics'));

        // Get Dashboard Stats (Vendor Isolated)
        router.get('/dashboard', authenticate, asyncHandler(async (req, res) => {
            const isSuper = await isAdmin(req.tenantId, req.user.id);

            if (isSuper) {
                // Global view for admins
                const result = await query(
                    `SELECT * FROM daily_stats 
                     WHERE tenant_id = $1 
                     ORDER BY date DESC LIMIT 30`,
                    [req.tenantId]
                );

                const totals = result.rows.reduce((acc, curr) => ({
                    sales: acc.sales + parseFloat(curr.total_sales || 0),
                    orders: acc.orders + (curr.order_count || 0),
                    customers: acc.customers + (curr.new_customers || 0)
                }), { sales: 0, orders: 0, customers: 0 });

                // Add global events for admin view
                const eventsRes = await query(
                    `SELECT 
                        COUNT(*) FILTER (WHERE event_type = 'impression') as impressions,
                        COUNT(*) FILTER (WHERE event_type = 'click') as clicks
                     FROM analytics_events WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
                    [req.tenantId]
                );
                const evStats = eventsRes.rows[0] || { impressions: 0, clicks: 0 };
                totals.impressions = parseInt(evStats.impressions || 0);
                totals.clicks = parseInt(evStats.clicks || 0);

                return res.json({
                    success: true,
                    totals,
                    chart_data: result.rows
                });
            }

            // Vendor-specific on-the-fly aggregation
            try {
                // Fetch user business identity for precise matching
                const userRes = await query('SELECT business_name FROM users WHERE id = $1', [req.user.id]);
                const businessName = userRes.rows[0]?.business_name;

                // Trends & Totals from orders
                // Trends & Totals from orders
                const ordersSql = `
                    SELECT 
                        date_trunc('day', created_at)::date as date,
                        SUM(total) as total_sales,
                        COUNT(*) as order_count
                    FROM orders
                    WHERE tenant_id = $1 AND vendor_id = $2
                      AND created_at >= NOW() - INTERVAL '30 days'
                    GROUP BY 1
                    ORDER BY 1 DESC`;

                const ordersResult = await query(ordersSql, [req.tenantId, req.user.id]);

                // Aggregated events (Impressions/Clicks) for summary
                const end = new Date().toISOString().split('T')[0];
                const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                const eventsSql = `
                    SELECT 
                        COUNT(*) FILTER (WHERE ae.event_type = 'impression') as impressions,
                        COUNT(*) FILTER (WHERE ae.event_type = 'page_view') as page_views,
                        COUNT(*) FILTER (WHERE ae.event_type = 'click') as clicks
                    FROM analytics_events ae
                    LEFT JOIN products p ON ae.entity_type = 'product' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = p.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = p.handle OR SPLIT_PART(ae.entity_id, '?', 1) = p.name)
                            END
                        )
                        AND ae.tenant_id = p.tenant_id
                    LEFT JOIN categories c ON ae.entity_type = 'category' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = c.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = c.slug OR SPLIT_PART(ae.entity_id, '?', 1) = c.name)
                            END
                        )
                        AND ae.tenant_id = c.tenant_id
                    LEFT JOIN collections cl ON ae.entity_type = 'collection' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = cl.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = cl.slug OR SPLIT_PART(ae.entity_id, '?', 1) = cl.name)
                            END
                        )
                        AND ae.tenant_id = cl.tenant_id
                    WHERE ae.tenant_id = $1
                      AND ae.created_at >= NOW() - INTERVAL '30 days'
                      AND (
                          $3 = TRUE -- Admin check
                          OR (ae.entity_type = 'product' AND (p.created_by = $2 OR p.tags @> ARRAY[$4]::text[])) -- ID or Tag ownership
                          OR (ae.entity_type = 'category' AND c.id IS NOT NULL) -- Categories are tenant-wide
                          OR (ae.entity_type = 'collection' AND (cl.created_by = $2 OR cl.name = $4) AND $4 IS NOT NULL) -- Identity match
                      )`;

                const eventsResult = await query(eventsSql, [req.tenantId, req.user.id, isSuper, businessName]);
                const eventStats = eventsResult.rows[0] || { impressions: 0, clicks: 0 };

                const totals = ordersResult.rows.reduce((acc, curr) => ({
                    ...acc,
                    sales: acc.sales + parseFloat(curr.total_sales || 0),
                    orders: acc.orders + (parseInt(curr.order_count) || 0)
                }), {
                    sales: 0,
                    orders: 0,
                    customers: 0,
                    impressions: parseInt(eventStats.impressions || 0),
                    page_views: parseInt(eventStats.page_views || 0),
                    clicks: parseInt(eventStats.clicks || 0)
                });

                res.json({
                    success: true,
                    totals,
                    chart_data: ordersResult.rows
                });
            } catch (err) {
                console.error('[Analytics] Vendor dashboard summary failed:', err.message);
                res.status(500).json({ success: false, error: err.message });
            }
        }));

        // Advanced Analytics Stats (Vendor Isolated)
        router.get('/stats', authenticate, asyncHandler(async (req, res) => {
            const { startDate, endDate, limit = 1000, offset = 0, orderBy = 'ctr' } = req.query;
            const end = endDate || new Date().toISOString().split('T')[0];
            const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const isSuper = await isAdmin(req.tenantId, req.user.id);

            // Fetch user business identity
            const userRes = await query('SELECT business_name FROM users WHERE id = $1', [req.user.id]);
            const businessName = userRes.rows[0]?.business_name;

            // Whitelist orderBy to prevent injection
            const validSortColumns = ['impressions', 'clicks', 'ctr', 'global_rank', 'vendor_rank'];
            const sortCol = validSortColumns.includes(orderBy) ? orderBy : 'ctr';

            try {
                const sql = `
                    WITH base_events AS (
                        SELECT 
                            ae.entity_type, 
                            COALESCE(p.id::text, cl.id::text, c.id::text, ae.entity_id) as entity_id, 
                            ae.event_type, ae.tenant_id,
                            -- Products identified by created_by OR tag match, Collections by ID or Business Name match
                            CASE 
                                WHEN ae.entity_type = 'product' AND (p.created_by = $8 OR p.tags @> ARRAY[$7]::text[]) THEN $8::text
                                WHEN ae.entity_type = 'collection' AND (cl.created_by = $8 OR cl.name = $7) THEN $8::text
                                ELSE NULL
                            END as owner_id,
                            COALESCE(p.name, c.name, cl.name, pg.title, ae.metadata->>'page_title', ae.entity_id) as entity_name
                        FROM analytics_events ae
                        LEFT JOIN products p ON ae.entity_type = 'product' 
                            AND (
                                CASE 
                                    WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = p.id 
                                    ELSE (SPLIT_PART(ae.entity_id, '?', 1) = p.handle OR SPLIT_PART(ae.entity_id, '?', 1) = p.name)
                                END
                            )
                            AND ae.tenant_id = p.tenant_id
                        LEFT JOIN categories c ON ae.entity_type = 'category' 
                            AND (
                                CASE 
                                    WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = c.id 
                                    ELSE (SPLIT_PART(ae.entity_id, '?', 1) = c.slug OR SPLIT_PART(ae.entity_id, '?', 1) = c.name)
                                END
                            )
                            AND ae.tenant_id = c.tenant_id
                        LEFT JOIN collections cl ON ae.entity_type = 'collection' 
                            AND (
                                CASE 
                                    WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = cl.id 
                                    ELSE (SPLIT_PART(ae.entity_id, '?', 1) = cl.slug OR SPLIT_PART(ae.entity_id, '?', 1) = cl.name)
                                END
                            )
                            AND ae.tenant_id = cl.tenant_id
                        LEFT JOIN pages pg ON ae.entity_type = 'page'
                            AND (
                                CASE 
                                    WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = pg.id 
                                    ELSE (SPLIT_PART(ae.entity_id, '?', 1) = pg.slug OR SPLIT_PART(ae.entity_id, '?', 1) = pg.title)
                                END
                            )
                            AND ae.tenant_id = pg.tenant_id
                        WHERE ae.tenant_id = $1
                          AND ae.created_at >= $2::timestamp
                          AND ae.created_at <= $3::timestamp + INTERVAL '1 day'
                    ),
                    stats AS (
                        SELECT 
                            entity_type, entity_id, entity_name, owner_id,
                            COUNT(*) FILTER (WHERE event_type = 'impression') as impressions,
                            COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views,
                            COUNT(*) FILTER (WHERE event_type = 'click') as clicks
                        FROM base_events
                        GROUP BY entity_type, entity_id, entity_name, owner_id
                    ),
                    base_stats AS (
                        SELECT 
                            *,
                            CASE 
                                WHEN impressions > 0 THEN ROUND((clicks::decimal / impressions::decimal) * 100, 2)
                                ELSE 0 
                            END as ctr
                        FROM stats
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
                        FROM base_stats
                    )
                    SELECT * FROM ranked 
                    WHERE ($6 = TRUE OR (entity_type = 'product' AND owner_id = $8::text) OR (entity_type != 'product'))
                    AND (vendor_rank <= 100 OR vendor_rank IS NULL) -- Ensure we get top 100 of each kind, allow global benchmarking items
                    ORDER BY ${sortCol === 'ctr' ? 'ctr DESC, clicks DESC, impressions DESC' : sortCol + ' DESC'}
                    LIMIT $4 OFFSET $5`;

                const result = await query(sql, [
                    req.tenantId, start, end, parseInt(limit), parseInt(offset),
                    isSuper, businessName, req.user.id
                ]);
                res.json({ success: true, data: result.rows });
            } catch (err) {
                console.error('[Analytics] Stats Query Failed:', err.message);
                res.status(500).json({ success: false, error: err.message });
            }
        }));

        // Surface Analysis Heatmap (Vendor Isolated)
        router.get('/surfaces', authenticate, asyncHandler(async (req, res) => {
            const { startDate, endDate } = req.query;
            const end = endDate || new Date().toISOString().split('T')[0];
            const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const isSuper = await isAdmin(req.tenantId, req.user.id);

            try {
                const sql = `
                    SELECT 
                        CASE 
                            WHEN ae.placement_type IS NULL OR ae.placement_type = 'page' THEN 'general'
                            ELSE ae.placement_type
                        END as placement_type,
                        COUNT(*) FILTER (WHERE ae.event_type = 'impression') as impressions,
                        COUNT(*) FILTER (WHERE ae.event_type = 'page_view') as page_views,
                        COUNT(*) FILTER (WHERE ae.event_type = 'click') as clicks
                    FROM analytics_events ae
                    LEFT JOIN products p ON ae.entity_type = 'product' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = p.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = p.handle OR SPLIT_PART(ae.entity_id, '?', 1) = p.name)
                            END
                        )
                        AND ae.tenant_id = p.tenant_id
                    LEFT JOIN categories c ON ae.entity_type = 'category' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = c.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = c.slug OR SPLIT_PART(ae.entity_id, '?', 1) = c.name)
                            END
                        )
                        AND ae.tenant_id = c.tenant_id
                    LEFT JOIN collections cl ON ae.entity_type = 'collection' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = cl.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = cl.slug OR SPLIT_PART(ae.entity_id, '?', 1) = cl.name)
                            END
                        )
                        AND ae.tenant_id = cl.tenant_id
                    WHERE ae.tenant_id = $1
                      AND ae.created_at >= $2::timestamp
                      AND ae.created_at <= $3::timestamp + INTERVAL '1 day'
                      AND ($4 = TRUE OR p.created_by = $5 OR cl.created_by = $5 OR cl.name = (SELECT business_name FROM users WHERE id = $5))
                    GROUP BY 1
                    ORDER BY impressions DESC`;

                const result = await query(sql, [req.tenantId, start, end, isSuper, req.user.id]);
                res.json({ success: true, data: result.rows });
            } catch (err) {
                console.error('[Analytics] Surface Analysis Failed:', err.message);
                res.status(500).json({ success: false, error: err.message });
            }
        }));

        // Product Journey Analysis (The "Life of a Product")
        router.get('/journey/:type/:id', authenticate, asyncHandler(async (req, res) => {
            const { type, id } = req.params;
            const { tenantId } = req;

            try {
                // 1. Get all events for this specific entity
                // We use a CTE to resolve the identifier (id) regardless if it's a UUID or Handle
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

                // 2. Group into lifecycles
                const lifecycles = [];
                let sessionGroups = {};

                // Process events oldest to newest
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

                        // If cart turns 0, split the lifecycle
                        if (cycle.current_quantity <= 0 && cycle.first_add_date) {
                            cycle.status = 'empty';
                            lifecycles.push({ ...cycle });
                            sessionGroups[sid] = null; // Prepare for next add
                        }
                    } else if (event.event_type === 'checkout_success') {
                        if (cycle.first_add_date) {
                            cycle.status = 'purchased';
                            lifecycles.push({ ...cycle });
                        }
                        sessionGroups[sid] = null;
                    }
                });

                // Add remaining active/abandoned sessions
                const THRESHOLD_MINS = 60 * 24 * 7; // 1 week
                Object.values(sessionGroups).forEach(cycle => {
                    if (!cycle || !cycle.first_add_date) return;

                    const lastActive = new Date(cycle.last_activity);
                    const now = new Date();
                    const diffMins = (now - lastActive) / (1000 * 60);

                    cycle.status = diffMins > THRESHOLD_MINS ? 'abandoned' : 'shopping';
                    lifecycles.push(cycle);
                });

                // Final stats & format
                const finalLifecycles = lifecycles
                    .map(lc => {
                        const start = new Date(lc.first_add_date);
                        // If it's a shopping or abandoned session (still in cart), duration is relative to NOW
                        // If it's finalized (purchased/empty), it's relative to last activity
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

                res.json({
                    success: true,
                    lifecycles: finalLifecycles
                });

            } catch (err) {
                console.error('[Analytics] Journey Analysis Failed:', err.message);
                res.status(500).json({ success: false, error: err.message });
            }
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

        // Detail View (Vendor Isolated)
        router.get('/details/:type/:id', authenticate, asyncHandler(async (req, res) => {
            const { type, id } = req.params;
            const isSuper = await isAdmin(req.tenantId, req.user.id);

            try {
                // Ownership check
                if (!isSuper) {
                    let ownerRes;
                    const idIsUuid = id.match(/^[0-9a-fA-F-]{36}$/);

                    if (type === 'product') {
                        const sql = idIsUuid
                            ? 'SELECT created_by FROM products WHERE id = $1 AND tenant_id = $2'
                            : 'SELECT created_by FROM products WHERE handle = $1 AND tenant_id = $2';
                        ownerRes = await query(sql, [id, req.tenantId]);
                    } else if (type === 'collection') {
                        const sql = idIsUuid
                            ? 'SELECT created_by FROM collections WHERE id = $1 AND tenant_id = $2'
                            : 'SELECT created_by FROM collections WHERE slug = $1 AND tenant_id = $2';
                        ownerRes = await query(sql, [id, req.tenantId]);
                    }

                    if (ownerRes && ownerRes.rows[0] && ownerRes.rows[0].created_by !== req.user.id) {
                        return res.status(403).json({ success: false, error: 'Permission denied: This item belongs to another vendor' });
                    }
                }

                const result = await query(
                    `SELECT 
                        COALESCE(ae.placement_type, 'page') as placement_type,
                        COUNT(*) FILTER (WHERE ae.event_type = 'impression') as impressions,
                        COUNT(*) FILTER (WHERE ae.event_type = 'page_view') as page_views,
                        COUNT(*) FILTER (WHERE ae.event_type = 'click') as clicks
                    FROM analytics_events ae
                    LEFT JOIN products p ON ae.entity_type = 'product' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = p.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = p.handle OR SPLIT_PART(ae.entity_id, '?', 1) = p.name)
                            END
                        )
                    LEFT JOIN categories c ON ae.entity_type = 'category' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = c.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = c.slug OR SPLIT_PART(ae.entity_id, '?', 1) = c.name)
                            END
                        )
                    LEFT JOIN collections cl ON ae.entity_type = 'collection' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = cl.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = cl.slug OR SPLIT_PART(ae.entity_id, '?', 1) = cl.name)
                            END
                        )
                    WHERE ae.tenant_id = $1 
                      AND ae.entity_type = $2 
                      AND (
                          ae.entity_id = $3 
                          OR (ae.entity_id ~ '^[0-9a-fA-F-]{36}$' AND $3 ~ '^[0-9a-fA-F-]{36}$' AND ae.entity_id::uuid = $3::uuid)
                          OR p.id::text = $3 
                          OR c.id::text = $3
                          OR cl.id::text = $3
                          OR (SPLIT_PART(ae.entity_id, '?', 1) = $3)
                      )
                    GROUP BY 1`,
                    [req.tenantId, type, id]
                );

                const referrerResult = await query(
                    `SELECT 
                        COALESCE(
                            NULLIF(
                                SPLIT_PART(
                                    REPLACE(REPLACE(REPLACE(ae.referrer_url, 'https://', ''), 'http://', ''), 'www.', ''), 
                                    '/', 1
                                ), 
                                ''
                            ), 
                            'direct'
                        ) as source,
                        COUNT(*) as count
                    FROM analytics_events ae
                    LEFT JOIN products p ON ae.entity_type = 'product' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = p.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = p.handle OR SPLIT_PART(ae.entity_id, '?', 1) = p.name)
                            END
                        )
                    LEFT JOIN categories c ON ae.entity_type = 'category' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = c.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = c.slug OR SPLIT_PART(ae.entity_id, '?', 1) = c.name)
                            END
                        )
                    LEFT JOIN collections cl ON ae.entity_type = 'collection' 
                        AND (
                            CASE 
                                WHEN ae.entity_id ~ '^[0-9a-fA-F-]{36}$' THEN ae.entity_id::uuid = cl.id 
                                ELSE (SPLIT_PART(ae.entity_id, '?', 1) = cl.slug OR SPLIT_PART(ae.entity_id, '?', 1) = cl.name)
                            END
                        )
                    WHERE ae.tenant_id = $1 
                      AND ae.entity_type = $2 
                      AND (
                          ae.entity_id = $3 
                          OR (ae.entity_id ~ '^[0-9a-fA-F-]{36}$' AND $3 ~ '^[0-9a-fA-F-]{36}$' AND ae.entity_id::uuid = $3::uuid)
                          OR p.id::text = $3 
                          OR c.id::text = $3
                          OR cl.id::text = $3
                          OR (SPLIT_PART(ae.entity_id, '?', 1) = $3)
                      )
                      AND ae.event_type = 'page_view'
                    GROUP BY 1
                    ORDER BY count DESC
                    LIMIT 10`,
                    [req.tenantId, type, id]
                );

                res.json({
                    success: true,
                    surfaces: result.rows,
                    referrers: referrerResult.rows
                });
            } catch (err) {
                console.error('[Analytics] Entity detail failed:', err.message);
                res.status(500).json({ success: false, error: err.message });
            }
        }));

        router.post('/collect', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { batch, events, ...singleEvent } = req.body;

            const eventsToProcess = batch ? events : [{ ...singleEvent }];

            if (!eventsToProcess || eventsToProcess.length === 0) {
                return res.status(400).json({ success: false, error: 'No events provided' });
            }

            try {
                const ip_address = req.ip || req.connection.remoteAddress;
                const user_agent = req.get('user-agent');

                // Process batch (using sequential inserts for now, can optimize to bulk INSERT later if needed)
                for (const event of eventsToProcess) {
                    const {
                        event_type,
                        entity_type,
                        entity_id,
                        placement_id,
                        placement_type,
                        position,
                        referrer_entity_type,
                        referrer_entity_id,
                        referrer_url,
                        session_id,
                        metadata = {}
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
                            tenantId,
                            event_type,
                            entity_type,
                            entity_id.toString(),
                            user ? user.id : null,
                            session_id || 'anonymous',
                            ip_address,
                            user_agent,
                            placement_id || null,
                            placement_type || null,
                            position ? parseInt(position) : null,
                            referrer_entity_type || null,
                            referrer_entity_id || null,
                            referrer_url || null,
                            JSON.stringify(metadata)
                        ]
                    );

                    // Emit internal event
                    eventBus.emitEvent(`analytics.${event_type}`, {
                        tenantId,
                        entityType: entity_type,
                        entityId: entity_id,
                        metadata
                    });
                }

                res.json({ success: true, processed: eventsToProcess.length });
            } catch (err) {
                console.error('[Analytics] Event collection failed:', err.message);
                res.status(500).json({ success: false, error: err.message });
            }
        }));

        // Event Aggregators
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
            try {
                const { tenantId, orderId } = event.data;
                const orderRes = await query('SELECT total FROM orders WHERE id = $1', [orderId]);
                if (orderRes.rows[0]) {
                    const total = orderRes.rows[0].total;
                    await updateDailyStat(tenantId, 'order_count', 1);
                    await updateDailyStat(tenantId, 'total_sales', total);
                }
            } catch (err) {
                console.error('[Analytics] Failed to track order:', err);
            }
        }, 'analytics');

        eventBus.registerListener('user.registered', async (event) => {
            try {
                const { tenantId } = event.data;
                await updateDailyStat(tenantId, 'new_customers', 1);
            } catch (err) {
                console.error('[Analytics] Failed to track user registration:', err);
            }
        }, 'analytics');

        app.use('/analytics', router);
        console.log('[Analytics] Module initialized');
        return true;
    } catch (error) {
        console.error('[Analytics] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
