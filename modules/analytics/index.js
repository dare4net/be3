/**
 * Analytics Module Bootstrapper
 * 
 * PRINCIPLE: All inter-module communication is event-based
 * Aggregates data from various system events
 */

const express = require('express');
const { tenantInsert } = require('../../utils/dbHelpers');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../middleware/errorHandler');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();
        router.use(subscriptionGuard('analytics'));

        // Get Dashboard Stats
        router.get('/dashboard', authenticate, asyncHandler(async (req, res) => {
            // Get last 30 days
            const result = await query(
                `SELECT * FROM daily_stats 
                 WHERE tenant_id = $1 
                 ORDER BY date DESC LIMIT 30`,
                [req.tenantId]
            );

            // Calculate totals
            const totals = result.rows.reduce((acc, curr) => ({
                sales: acc.sales + parseFloat(curr.total_sales),
                orders: acc.orders + curr.order_count,
                customers: acc.customers + curr.new_customers
            }), { sales: 0, orders: 0, customers: 0 });

            res.json({
                success: true,
                totals,
                chart_data: result.rows
            });
        }));

        // Collect Raw Event (Public)
        router.post('/collect', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { event_type, metadata, session_id } = req.body;

            await tenantInsert('analytics_events', tenantId, {
                event_type,
                user_id: user ? user.id : null,
                session_id: session_id || 'unknown',
                metadata: metadata || {}
            });

            // Emit internal event for real-time triggers
            eventBus.emitEvent(`analytics.${event_type.toLowerCase()}`, {
                tenantId,
                eventType: event_type,
                metadata
            });

            res.json({ success: true });
        }));

        // ==========================================
        // Event Aggregators
        // ==========================================

        // Helper to update daily stats
        async function updateDailyStat(tenantId, column, value = 1) {
            const date = new Date().toISOString().split('T')[0];
            await query(
                `INSERT INTO daily_stats (tenant_id, date, ${column})
                 VALUES ($1, $2, $3)
                 ON CONFLICT (tenant_id, date)
                 DO UPDATE SET ${column} = daily_stats.${column} + $3, updated_at = NOW()`,
                [tenantId, date, value]
            );
        }

        // 1. Order Created -> +Sales, +OrderCount
        eventBus.registerListener('order.created', async (event) => {
            const { tenantId, orderId } = event.data;
            // Fetch order total (simulating an event enrichment or query)
            const orderRes = await query('SELECT total FROM orders WHERE id = $1', [orderId]);
            if (orderRes.rows[0]) {
                const total = orderRes.rows[0].total;
                await updateDailyStat(tenantId, 'order_count', 1);
                await updateDailyStat(tenantId, 'total_sales', total);
                console.log(`[Analytics] Updated stats for order (Tenant: ${tenantId})`);
            }
        }, 'analytics');

        // 2. User Registered -> +NewCustomers
        eventBus.registerListener('user.registered', async (event) => {
            const { tenantId } = event.data;
            await updateDailyStat(tenantId, 'new_customers', 1);
            console.log(`[Analytics] Tracked new customer (Tenant: ${tenantId})`);
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
