/**
 * Orders Module Bootstrapper
 * 
 * PRINCIPLE: All inter-module communication is event-based
 * Listens to payment.success event to create orders
 */

const express = require('express');
const { query } = require('../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate } = require('../../utils/dbHelpers');
const Role = require('../../platform/core/roles/models/Role');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
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

            // Fetch roles if not present on user object
            if (!req.user.roles) {
                req.user.roles = await Role.getUserRoles(req.tenantId, req.user.id);
            }

            // Filter by vendor if user has Vendor role and is NOT an Admin/Super Admin
            const isVendor = req.user.roles.some(r => r.name === 'Vendor' || r === 'Vendor');
            const isAdmin = req.user.roles.some(r => r.name === 'Admin' || r === 'Admin' || r.name === 'Super Admin' || r === 'Super Admin');

            if (isVendor && !isAdmin) {
                result.data = result.data.filter(o => o.vendor_id === req.user.id);
                result.total = result.data.length;
                // Note: Pagination counts might be off after filtering, but it's a quick fix for now
                // In a perfect world, we'd add vendor_id to the paginatedTenantQuery conditions
            }

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
            const { tenantId, user } = req;
            const orderId = req.params.id;

            // 1. Fetch order to check ownership if vendor
            const checkSql = `SELECT vendor_id FROM orders WHERE id = $1 AND tenant_id = $2`;
            const checkResult = await query(checkSql, [orderId, tenantId]);

            if (checkResult.rows.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const orderToUpdate = checkResult.rows[0];

            // 2. Security: If user is Vendor, they must own the order
            if (!user.roles) {
                user.roles = await Role.getUserRoles(tenantId, user.id);
            }
            const isVendor = user.roles.some(r => r.name === 'Vendor' || r === 'Vendor');
            const isAdmin = user.roles.some(r => r.name === 'Admin' || r === 'Admin' || r.name === 'Super Admin' || r === 'Super Admin');

            if (isVendor && !isAdmin) {
                if (orderToUpdate.vendor_id !== user.id) {
                    return res.status(403).json({ error: 'Unauthorized: You can only manage your own orders' });
                }
            }

            // 3. Update
            const order = await tenantUpdate('orders', tenantId, orderId, {
                status: req.body.status,
            });

            eventBus.emitEvent('order.status_changed', {
                tenantId,
                orderId: order.id,
                status: order.status,
            });

            res.json({ success: true, order });
        }));

        // Record WhatsApp order
        router.post('/whatsapp', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { cartId, vendorId, items, total, customerName, customerEmail } = req.body;

            console.log(`[Orders] Recording WhatsApp order for vendor: ${vendorId}`);

            const orderNumber = `WA-${Date.now()}`;

            const order = await tenantInsert('orders', tenantId, {
                order_number: orderNumber,
                user_id: user ? user.id : null,
                vendor_id: vendorId,
                status: 'pending_whatsapp',
                payment_status: 'pending',
                subtotal: total, // For WhatsApp orders, subtotal == total for now
                total: total,
                currency: 'USD', // Default to USD or fetch from tenant settings
                customer_email: customerEmail || (user ? user.email : null),
                metadata: {
                    is_whatsapp: true,
                    customer_name: customerName,
                    cart_id: cartId
                }
            });

            // Insert order items
            for (const item of items) {
                await tenantInsert('order_items', tenantId, {
                    order_id: order.id,
                    product_id: item.product_id,
                    variant_id: item.variant_id,
                    product_name: item.product_name,
                    quantity: item.quantity,
                    price: item.price,
                    total: parseFloat(item.price) * item.quantity,
                    image_url: item.image_url
                });
            }

            // Emit event
            eventBus.emitEvent('order.created', {
                tenantId,
                orderId: order.id,
                orderNumber: order.order_number,
                isWhatsapp: true
            });

            // If we have a cartId, mark those specific items as removed/completed
            // or let the frontend handles clearing them.
            // For now, we'll return the order.
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
