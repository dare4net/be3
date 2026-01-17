/**
 * Orders Module Bootstrapper
 * 
 * PRINCIPLE: All inter-module communication is event-based
 * Listens to payment.success event to create orders
 */

const express = require('express');
const { query } = require('../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate } = require('../../utils/dbHelpers');
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const authorize = require('../../platform/core/roles/middleware/authorize');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../middleware/errorHandler');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();

        router.use(subscriptionGuard('orders'));

        // List orders (Admin/Manager)
        router.get('/', authenticate, authorize('orders.view'), asyncHandler(async (req, res) => {
            const filters = {};
            if (req.query.status) filters.status = req.query.status;
            if (req.query.user_id) filters.user_id = req.query.user_id;
            if (req.query.search) filters.search = req.query.search;

            const result = await paginatedTenantQuery('orders', req.tenantId, {
                page: parseInt(req.query.page) || 1,
                perPage: parseInt(req.query.per_page) || 20,
                orderBy: 'created_at DESC',
                conditions: filters
            });
            res.json({ success: true, ...result });
        }));

        // Get orders for the current authenticated user
        router.get('/my-orders', authenticate, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;

            console.log('[My Orders] User ID:', user?.id);
            console.log('[My Orders] Tenant ID:', tenantId);

            const result = await paginatedTenantQuery('orders', tenantId, {
                page: parseInt(req.query.page) || 1,
                perPage: parseInt(req.query.per_page) || 20,
                orderBy: 'created_at DESC',
                conditions: { user_id: user.id }
            });

            console.log('[My Orders] Found orders:', result.data?.length || 0);
            console.log('[My Orders] Sample order user_ids:', result.data?.slice(0, 3).map(o => o.user_id));

            res.json({ success: true, ...result });
        }));

        // Get order by ID (Admin/Manager)
        router.get('/:id', authenticate, authorize('orders.view'), asyncHandler(async (req, res) => {
            const orderSql = `SELECT * FROM orders WHERE id = $1 AND tenant_id = $2`;
            const orderResult = await query(orderSql, [req.params.id, req.tenantId]);

            if (!orderResult.rows[0]) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const itemsSql = `SELECT * FROM order_items WHERE order_id = $1`;
            const itemsResult = await query(itemsSql, [req.params.id]);

            res.json({
                success: true,
                order: orderResult.rows[0],
                items: itemsResult.rows,
            });
        }));

        // Update order status
        router.patch('/:id/status', authenticate, authorize('orders.manage'), asyncHandler(async (req, res) => {
            const order = await tenantUpdate('orders', req.tenantId, req.params.id, {
                status: req.body.status,
            });

            eventBus.emitEvent('order.status_changed', {
                tenantId: req.tenantId,
                orderId: order.id,
                status: order.status,
            });

            res.json({ success: true, order });
        }));

        // PRINCIPLE: All inter-module communication is event-based
        // Listen for payment success to create orders
        eventBus.registerListener('payment.success', async (event) => {
            const { tenantId, cartId, paymentData } = event.data;

            try {
                // Generate order number
                const orderNumber = `ORD-${Date.now()}`;

                console.log('[Orders] Creating order with userId:', paymentData.userId);

                // Create order (would fetch cart data via event query pattern in production)
                const order = await tenantInsert('orders', tenantId, {
                    order_number: orderNumber,
                    user_id: paymentData.userId || null,
                    status: 'paid',
                    payment_status: 'paid',
                    subtotal: paymentData.subtotal,
                    total: paymentData.total,
                    customer_email: paymentData.email,
                    paid_at: new Date(),
                });

                console.log('[Orders] Created order with user_id:', order.user_id);

                eventBus.emitEvent('order.created', {
                    tenantId,
                    orderId: order.id,
                    orderNumber: order.order_number,
                });
            } catch (error) {
                console.error('[Orders] Failed to create order from payment:', error);
            }
        }, 'orders');

        app.use('/orders', router);
        console.log('[Orders] Module initialized');

        return true;
    } catch (error) {
        console.error('[Orders] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
