/**
 * Orders Module Bootstrapper
 *
 * PRINCIPLE: All inter-module communication is event-based
 * PRINCIPLE: Order status is operational (fulfillment). Payment status is financial.
 *
 * Status taxonomy:
 *   order status:   pending → processing → shipped → delivered → returned
 *                   pending/processing → cancelled
 *   payment status: unpaid → processing → paid/failed → refunded  (platform)
 *                   unpaid → fulfilled → refunded                  (manual vendor confirm)
 *
 * Payment gate: order status CANNOT be advanced if payment_status is unpaid/failed/processing.
 * Exception: pending → processing with unpaid triggers a 402 prompt so the vendor can
 * manually confirm off-platform payment (sets payment_status = 'fulfilled').
 */

const express = require('express');
const { query } = require('../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate } = require('../../utils/dbHelpers');
const Role = require('../../platform/core/roles/models/Role');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const authorize = require('../../platform/core/roles/middleware/authorize');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../middleware/errorHandler');

// Valid one-way transitions. Any move not in this map is rejected.
const VALID_TRANSITIONS = {
    pending: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: ['returned'],
    returned: [],
    cancelled: [],
};

// Payment statuses that allow order status changes.
const PAYMENT_STATUSES_ALLOWING_ADVANCE = ['paid', 'fulfilled'];

// Helper: fetch user roles once
async function getUserRoles(tenantId, userId) {
    return Role.getUserRoles(tenantId, userId);
}

function isAdmin(roles) {
    return roles.some(r => r.name === 'Admin' || r === 'Admin' || r.name === 'Super Admin' || r === 'Super Admin');
}

function isVendor(roles) {
    return roles.some(r => r.name === 'Vendor' || r === 'Vendor');
}

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();

        router.use(subscriptionGuard('orders'));

        // List orders (Admin/Manager or Bot via session_id)
        router.get('/', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user, query: reqQuery } = req;
            const filters = {};
            if (reqQuery.status) filters.status = reqQuery.status;
            if (reqQuery.user_id) filters.user_id = reqQuery.user_id;
            if (reqQuery.search) filters.search = reqQuery.search;

            // If no user but session_id, filter by session or order number (for bot tracking)
            if (!user && reqQuery.session_id) {
                filters.session_id = reqQuery.session_id;
            }

            const result = await paginatedTenantQuery('orders', tenantId, {
                page: parseInt(reqQuery.page) || 1,
                perPage: parseInt(reqQuery.limit) || parseInt(reqQuery.per_page) || 20,
                orderBy: 'created_at DESC',
                conditions: filters
            });

            if (user) {
                // Fetch roles if not present on user object
                if (!user.roles) {
                    user.roles = await Role.getUserRoles(tenantId, user.id);
                }

                // Filter by vendor if user has Vendor role and is NOT an Admin/Super Admin
                const isVendor = user.roles.some(r => r.name === 'Vendor' || r === 'Vendor');
                const isAdmin = user.roles.some(r => r.name === 'Admin' || r === 'Admin' || r.name === 'Super Admin' || r === 'Super Admin');

                if (isVendor && !isAdmin) {
                    result.data = result.data.filter(o => o.vendor_id === user.id);
                    result.total = result.data.length;
                }
            }

            res.json({ success: true, ...result });
        }));

        // Get orders for the current authenticated user
        router.get('/my-orders', authenticate, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;

            const result = await paginatedTenantQuery('orders', tenantId, {
                page: parseInt(req.query.page) || 1,
                perPage: parseInt(req.query.per_page) || 20,
                orderBy: 'created_at DESC',
                conditions: { user_id: user.id }
            });

            // Enrich each order with first-item thumbnail + item count (single batch query)
            if (result.data && result.data.length > 0) {
                const orderIds = result.data.map(o => o.id);
                const enrichRes = await query(`
                    SELECT DISTINCT ON (oi.order_id)
                        oi.order_id,
                        COUNT(oi.id) OVER (PARTITION BY oi.order_id) AS item_count,
                        COALESCE(pm.url, p.image_url) AS thumbnail
                    FROM order_items oi
                    LEFT JOIN products p ON p.id = oi.product_id
                    LEFT JOIN product_media pm ON pm.product_id = oi.product_id AND pm.media_type = 'image'
                    WHERE oi.order_id = ANY($1) AND oi.tenant_id = $2
                    ORDER BY oi.order_id, oi.created_at ASC
                `, [orderIds, tenantId]);

                const enrichMap = {};
                enrichRes.rows.forEach(r => {
                    enrichMap[r.order_id] = { thumbnail: r.thumbnail, item_count: parseInt(r.item_count) };
                });

                result.data = result.data.map(o => ({
                    ...o,
                    thumbnail: enrichMap[o.id]?.thumbnail || null,
                    item_count: enrichMap[o.id]?.item_count || 0,
                }));
            }

            res.json({ success: true, ...result });
        }));

        // Get order by ID or Number
        router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
            const { id } = req.params;
            const { tenantId, user } = req;

            // Try ID first, then order_number (cast ID to text for string comparison)
            let orderSql = `SELECT * FROM orders WHERE (id::text = $1 OR order_number = $1) AND tenant_id = $2`;
            let orderResult = await query(orderSql, [id, tenantId]);

            if (!orderResult.rows[0]) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderResult.rows[0];
            const orderSessionId = order.session_id || order.metadata?.session_id || null;

            // Security: If session_id is provided, must match
            if (!user && req.query.session_id && orderSessionId !== req.query.session_id) {
                // For now, allow bot to see it if it has the number, but in production we'd be stricter
            }

            const itemsSql = `SELECT * FROM order_items WHERE order_id = $1 AND tenant_id = $2`;
            const itemsResult = await query(itemsSql, [order.id, tenantId]);

            res.json({
                success: true,
                order,
                items: itemsResult.rows,
            });
        }));

        // ── PATCH /:id/status ──────────────────────────────────────────────────
        // Update order status with full transition validation + payment gate.
        router.patch('/:id/status', authenticate, authorize('orders.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const orderId = req.params.id;
            const { status: newStatus } = req.body;

            if (!newStatus) {
                return res.status(400).json({ error: 'ValidationError', message: 'status is required' });
            }

            // 1. Fetch current order
            const orderResult = await query(
                `SELECT * FROM orders WHERE id = $1 AND tenant_id = $2`,
                [orderId, tenantId]
            );
            if (!orderResult.rows[0]) {
                return res.status(404).json({ error: 'OrderNotFound', message: 'Order not found' });
            }
            const order = orderResult.rows[0];

            // 2. Vendor ownership check
            if (!user.roles) user.roles = await getUserRoles(tenantId, user.id);
            const userIsVendor = isVendor(user.roles);
            const userIsAdmin = isAdmin(user.roles);

            if (userIsVendor && !userIsAdmin && order.vendor_id !== user.id) {
                return res.status(403).json({ error: 'Forbidden', message: 'You can only manage your own orders' });
            }

            // 3. Transition validation — one-way, permanent
            const allowed = VALID_TRANSITIONS[order.status] || [];
            if (!allowed.includes(newStatus)) {
                return res.status(400).json({
                    error: 'InvalidTransition',
                    message: `Cannot move order from '${order.status}' to '${newStatus}'`,
                    current: order.status,
                    allowed,
                });
            }

            // 4. Payment gate — cannot advance status without payment
            //    Exception: pending → processing when unpaid triggers the manual confirm prompt (402)
            if (!PAYMENT_STATUSES_ALLOWING_ADVANCE.includes(order.payment_status)) {
                // Special case: vendor is moving pending → processing on an unpaid order
                if (order.status === 'pending' && newStatus === 'processing' &&
                    (order.payment_status === 'unpaid' || order.payment_status === 'failed')) {
                    return res.status(402).json({
                        error: 'PaymentRequired',
                        action: 'confirm_manual_payment',
                        message: 'This order has no confirmed payment. Did the customer pay outside the platform?',
                        orderId: order.id,
                        targetStatus: newStatus,
                    });
                }

                // All other blocked transitions
                return res.status(402).json({
                    error: 'PaymentRequired',
                    message: `Cannot change order status while payment is '${order.payment_status}'. Resolve payment first.`,
                    payment_status: order.payment_status,
                });
            }

            // 5. Apply update with relevant timestamps (updated_at is added automatically by tenantUpdate)
            const updates = { status: newStatus };
            if (newStatus === 'shipped') updates.shipped_at = new Date();
            if (newStatus === 'delivered') updates.delivered_at = new Date();
            if (newStatus === 'cancelled') updates.cancelled_at = new Date();

            const updated = await tenantUpdate('orders', tenantId, orderId, updates);

            eventBus.emitEvent('order.status_changed', {
                tenantId,
                orderId: updated.id,
                orderNumber: updated.order_number,
                userId: updated.user_id || null,
                vendorId: updated.vendor_id || null,
                oldStatus: order.status,
                newStatus: updated.status,
            });

            res.json({ success: true, order: updated });
        }));

        // ── PATCH /:id/payment-status ──────────────────────────────────────────
        // Vendor/admin manually sets payment status (fulfilled or refunded labels).
        // Platform payment statuses (paid, failed, processing) are set by webhook only.
        router.patch('/:id/payment-status', authenticate, authorize('orders.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const orderId = req.params.id;
            const { payment_status: newPaymentStatus } = req.body;

            const MANUAL_ALLOWED = ['fulfilled', 'refunded'];
            if (!MANUAL_ALLOWED.includes(newPaymentStatus)) {
                return res.status(400).json({
                    error: 'ValidationError',
                    message: `Manual payment status must be one of: ${MANUAL_ALLOWED.join(', ')}`,
                });
            }

            const orderResult = await query(
                `SELECT * FROM orders WHERE id = $1 AND tenant_id = $2`,
                [orderId, tenantId]
            );
            if (!orderResult.rows[0]) {
                return res.status(404).json({ error: 'OrderNotFound', message: 'Order not found' });
            }
            const order = orderResult.rows[0];

            // Vendor ownership
            if (!user.roles) user.roles = await getUserRoles(tenantId, user.id);
            if (isVendor(user.roles) && !isAdmin(user.roles) && order.vendor_id !== user.id) {
                return res.status(403).json({ error: 'Forbidden', message: 'You can only manage your own orders' });
            }

            // Transition rules for manual payment status
            if (newPaymentStatus === 'fulfilled' && !['unpaid', 'failed'].includes(order.payment_status)) {
                return res.status(400).json({
                    error: 'InvalidTransition',
                    message: `Cannot mark as fulfilled when payment is already '${order.payment_status}'`,
                });
            }
            if (newPaymentStatus === 'refunded' && !['paid', 'fulfilled'].includes(order.payment_status)) {
                return res.status(400).json({
                    error: 'InvalidTransition',
                    message: `Cannot refund when payment status is '${order.payment_status}'`,
                });
            }

            // updated_at is added automatically by tenantUpdate
            const updates = {
                payment_status: newPaymentStatus,
            };

            // Record audit trail for fulfilled confirmation
            if (newPaymentStatus === 'fulfilled') {
                updates.confirmed_by = user.id;
                updates.payment_confirmed_at = new Date();
            }

            const updated = await tenantUpdate('orders', tenantId, orderId, updates);

            res.json({ success: true, order: updated });
        }));

        // Cancel order (Public/Guest with session match or Auth)
        router.post('/:id/cancel', optionalAuth, asyncHandler(async (req, res) => {
            const { id } = req.params;
            const { tenantId, user } = req;
            const { session_id } = req.query;

            // Find order (cast ID to text for string comparison)
            const orderSql = `SELECT * FROM orders WHERE (id::text = $1 OR order_number = $1) AND tenant_id = $2`;
            const orderResult = await query(orderSql, [id, tenantId]);

            if (!orderResult.rows[0]) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderResult.rows[0];
            const orderSessionId = order.session_id || order.metadata?.session_id || null;

            // Security check
            if (user) {
                if (order.user_id !== user.id) {
                    // Check if admin
                    if (!user.roles) user.roles = await Role.getUserRoles(tenantId, user.id);
                    const isAdmin = user.roles.some(r => r.name === 'Admin' || r.name === 'Super Admin');
                    if (!isAdmin) return res.status(403).json({ error: 'Unauthorized' });
                }
            } else if (session_id) {
                if (orderSessionId !== session_id) {
                    // In a simulation/bot environment, we might be more lenient if the order_number matches exactly
                    // For now, let's allow it if the number is specific enough
                }
            } else {
                // return res.status(401).json({ error: 'Authentication or Session ID required' });
            }

            // Update status to cancelled
            const updatedOrder = await tenantUpdate('orders', tenantId, order.id, {
                status: 'cancelled',
            });

            eventBus.emitEvent('order.cancelled', {
                tenantId,
                orderId: order.id,
                orderNumber: order.order_number,
                userId: order.user_id || null,
                vendorId: order.vendor_id || null,
            });

            res.json({ success: true, message: 'Order cancelled', order: updatedOrder });
        }));

        // Record WhatsApp order
        router.post('/whatsapp', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { cartId, vendorId, items, total, customerName, customerEmail, shippingAddress, session_id } = req.body;

            console.log(`[Orders] Recording WhatsApp order for vendor: ${vendorId}`);

            const orderNumber = `WA-${Date.now()}`;

            // Convert "platform" string to null for database UUID compatibility
            const dbVendorId = vendorId === 'platform' ? null : vendorId;

            const order = await tenantInsert('orders', tenantId, {
                order_number: orderNumber,
                user_id: user ? user.id : null,
                session_id: session_id || null,
                vendor_id: dbVendorId,
                checkout_type: 'whatsapp',
                status: 'pending',
                payment_status: 'unpaid',
                subtotal: total,
                total: total,
                currency: 'NGN',
                customer_email: customerEmail || (user ? user.email : null),
                customer_name: customerName || null,
                shipping_address: shippingAddress ? JSON.stringify(shippingAddress) : null,
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
                userId: order.user_id || null,
                vendorId: order.vendor_id || null,
                isWhatsapp: true,
            });

            // If we have a cartId, mark those specific items as removed/completed
            // or let the frontend handles clearing them.
            // For now, we'll return the order.
            res.json({ success: true, order });
        }));

        // Record In-House Pre-Order (Bot checkout for vendors with dashboard)
        router.post('/inhouse-preorder', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { cartId, vendorId, items, total, customerName, customerEmail, session_id } = req.body;

            console.log(`[Orders] Recording in-house pre-order for vendor: ${vendorId}`);

            const orderNumber = `PRE-${Date.now()}`;

            // Convert "platform" string to null for database UUID compatibility
            const dbVendorId = vendorId === 'platform' ? null : vendorId;

            const order = await tenantInsert('orders', tenantId, {
                order_number: orderNumber,
                user_id: user ? user.id : null,
                session_id: session_id || null,
                vendor_id: dbVendorId,
                checkout_type: 'platform',
                status: 'pending',
                payment_status: 'unpaid',
                subtotal: total,
                total: total,
                currency: 'NGN',
                customer_email: customerEmail || (user ? user.email : null),
                metadata: {
                    is_bot_preorder: true,
                    customer_name: customerName,
                    cart_id: cartId,
                    session_id: session_id
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
                isPreOrder: true
            });

            res.json({ success: true, order });
        }));

        // PRINCIPLE: All inter-module communication is event-based
        // Listen for payment success to create orders
        eventBus.registerListener('payment.success', async (event) => {
            const { tenantId, cartId, paymentData, orderId: existingOrderId } = event.data;

            try {
                // If the order was pre-created during payment initialization (Paystack flow),
                // we just need to emit the order.created event — the order already exists.
                if (paymentData?.fromExistingOrder && existingOrderId) {
                    console.log(`[Orders] Payment confirmed for pre-created order: ${existingOrderId}`);
                    const orderResult = await query(
                        `SELECT order_number FROM orders WHERE id = $1 AND tenant_id = $2`,
                        [existingOrderId, tenantId]
                    );
                    if (orderResult.rows[0]) {
                        eventBus.emitEvent('order.created', {
                            tenantId,
                            orderId: existingOrderId,
                            orderNumber: orderResult.rows[0].order_number,
                        });
                    }
                    return; // Do NOT create a duplicate order
                }
                // We should group items by vendorId
                const itemsByVendor = {};
                for (const item of paymentData.items || []) {
                    const vId = item.vendorId || 'platform';
                    if (!itemsByVendor[vId]) itemsByVendor[vId] = [];
                    itemsByVendor[vId].push(item);
                }

                // Create an order for each vendor
                for (const [vId, vendorItems] of Object.entries(itemsByVendor)) {
                    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                    const dbVendorId = vId === 'platform' ? null : vId;

                    let vendorSubtotal = 0;
                    for (const item of vendorItems) {
                        vendorSubtotal += parseFloat(item.price) * item.quantity;
                    }
                    const vendorTax = vendorSubtotal * 0.1; // Simple mock fraction
                    const vendorShipping = vendorItems.length > 0 ? 15.0 : 0; // Simple mock

                    console.log(`[Orders] Creating order for vendor: ${dbVendorId || 'platform'}, userId: ${paymentData.userId || 'guest'}`);

                    const order = await tenantInsert('orders', tenantId, {
                        order_number: orderNumber,
                        user_id: paymentData.userId || null,
                        vendor_id: dbVendorId,
                        status: 'paid',
                        payment_status: 'paid',
                        subtotal: vendorSubtotal,
                        total: vendorSubtotal + vendorTax + vendorShipping,
                        customer_email: paymentData.email,
                        paid_at: new Date(),
                    });

                    // NOW INSERT ORDER ITEMS
                    for (const item of vendorItems) {
                        await tenantInsert('order_items', tenantId, {
                            order_id: order.id,
                            product_id: item.productId,
                            variant_id: item.variantId,
                            product_name: item.product_name,
                            quantity: item.quantity,
                            price: item.price,
                            total: parseFloat(item.price) * item.quantity,
                            image_url: item.image_url
                        });
                    }

                    console.log('[Orders] Created order with ID:', order.id);

                    eventBus.emitEvent('order.created', {
                        tenantId,
                        orderId: order.id,
                        orderNumber: order.order_number,
                    });
                }
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
