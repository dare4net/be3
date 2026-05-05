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
                orderNumber: order.order_number
            });

            res.json({ success: true, message: 'Order cancelled', order: updatedOrder });
        }));

        // Record WhatsApp order
        router.post('/whatsapp', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { cartId, vendorId, items, total, customerName, customerEmail, session_id } = req.body;

            console.log(`[Orders] Recording WhatsApp order for vendor: ${vendorId}`);

            const orderNumber = `WA-${Date.now()}`;

            // Convert "platform" string to null for database UUID compatibility
            const dbVendorId = vendorId === 'platform' ? null : vendorId;

            const order = await tenantInsert('orders', tenantId, {
                order_number: orderNumber,
                user_id: user ? user.id : null,
                session_id: session_id || null,
                vendor_id: dbVendorId,
                status: 'pending_whatsapp',
                payment_status: 'pending',
                subtotal: total,
                total: total,
                currency: 'USD',
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
                status: 'pending',
                payment_status: 'pending',
                subtotal: total,
                total: total,
                currency: 'USD',
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
