/**
 * Payments Module
 *
 * PRINCIPLE: All inter-module communication is event-based
 * PRINCIPLE: Webhook is the ONLY source of truth for payment completion
 *
 * IDEMPOTENCY DESIGN:
 *   1. We generate the `reference` UUID ourselves before calling Paystack.
 *   2. This reference is stored in the `payments` table with a UNIQUE constraint.
 *   3. On every webhook hit, we attempt to acquire a DB-level lock using
 *      `SELECT FOR UPDATE SKIP LOCKED` on the payment row.
 *   4. If the row is locked (another webhook handler is running), we skip.
 *   5. If the row is already in `succeeded` state, we return 200 immediately.
 *   6. Only ONE code path can ever transition a payment from pending → succeeded.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../../config/database');
const { tenantInsert } = require('../../utils/dbHelpers');
const { optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../middleware/errorHandler');
const PaystackService = require('./services/PaystackService');

const FLAT_SHIPPING_NGN = 1500; // ₦1,500 flat shipping

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        // =====================================================================
        // PUBLIC ROUTER — No auth, no tenant, no subscriptionGuard
        // The Paystack webhook MUST be here — Paystack sends no tenant headers.
        // tenantId is extracted from the metadata we embedded at initialization.
        // =====================================================================
        const publicRouter = express.Router();

        publicRouter.post('/webhooks/paystack', asyncHandler(async (req, res) => {
            const signature = req.headers['x-paystack-signature'];
            const rawBody = req.body; // Buffer — provided by express.raw() registered in server.js

            // === LAYER 1: Signature Verification ===
            const isValid = PaystackService.verifyWebhookSignature(rawBody, signature);
            if (!isValid) {
                console.warn('[Payments/Webhook] Rejected: Invalid Paystack signature');
                return res.status(401).json({ error: 'Invalid signature' });
            }

            let event;
            try {
                event = JSON.parse(rawBody.toString());
            } catch (e) {
                console.warn('[Payments/Webhook] Rejected: Could not parse body');
                return res.status(400).json({ error: 'Invalid JSON body' });
            }

            const { event: eventName, data } = event;
            const reference = data?.reference;
            // tenantId comes from the metadata we embedded during initializeTransaction
            const tenantId = data?.metadata?.tenantId;

            if (!reference || !tenantId) {
                console.warn('[Payments/Webhook] Missing reference or tenantId, ignoring:', eventName);
                return res.status(200).json({ received: true });
            }

            console.log(`[Payments/Webhook] Event: ${eventName}, ref: ${reference}, tenant: ${tenantId}`);

            // === LAYER 2: DB-level Lock (SELECT FOR UPDATE SKIP LOCKED) ===
            const client = await require('../../config/database').pool.connect();
            try {
                await client.query('BEGIN');

                const lockResult = await client.query(
                    `SELECT id, status, tenant_id, order_id
                     FROM payments
                     WHERE reference = $1
                     FOR UPDATE SKIP LOCKED`,
                    [reference]
                );

                if (lockResult.rows.length === 0) {
                    // Row doesn't exist or already locked by a concurrent handler
                    await client.query('ROLLBACK');
                    console.log(`[Payments/Webhook] Ref ${reference}: Skipped (not found or concurrent lock)`);
                    return res.status(200).json({ received: true, note: 'skipped' });
                }

                const payment = lockResult.rows[0];

                // === LAYER 3: Terminal State Check ===
                if (payment.status === 'succeeded' || payment.status === 'failed') {
                    await client.query('ROLLBACK');
                    console.log(`[Payments/Webhook] Ref ${reference}: Already '${payment.status}'. Idempotency guard triggered.`);
                    return res.status(200).json({ received: true, note: 'already_processed' });
                }

                const orderId = payment.order_id;

                if (eventName === 'charge.success') {
                    await client.query(
                        `UPDATE payments
                         SET status = 'succeeded',
                             provider_payment_id = $1,
                             processed_at = NOW(),
                             gateway_response = $2,
                             updated_at = NOW()
                         WHERE reference = $3`,
                        [data.id?.toString() || null, JSON.stringify(data), reference]
                    );

                    await client.query(
                        `UPDATE orders
                         SET status = 'processing',
                             payment_status = 'paid',
                             paid_at = NOW(),
                             updated_at = NOW()
                         WHERE id = $1`,
                        [orderId]
                    );

                    // Clear cart
                    const orderResult = await client.query(
                        `SELECT metadata FROM orders WHERE id = $1`, [orderId]
                    );
                    const cartId = orderResult.rows[0]?.metadata?.cart_id;
                    if (cartId) {
                        await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
                        await client.query(`UPDATE carts SET status = 'completed' WHERE id = $1`, [cartId]);
                    }

                    await client.query('COMMIT');
                    console.log(`[Payments/Webhook] ✓ charge.success — ref: ${reference}, orderId: ${orderId}`);

                    // Side effects OUTSIDE transaction (non-critical async)
                    eventBus.emitEvent('payment.success', {
                        tenantId,
                        orderId,
                        reference,
                        paymentData: {
                            userId: data.metadata?.userId || null,
                            email: data.customer?.email,
                            amount: data.amount / 100,
                            currency: data.currency,
                            fromExistingOrder: true,
                        },
                    });

                    const io = app.get('io');
                    if (io) {
                        io.to(`payment:${reference}`).emit('payment.confirmed', {
                            reference, orderId, status: 'succeeded',
                        });
                    }

                } else if (eventName === 'charge.failed') {
                    await client.query(
                        `UPDATE payments
                         SET status = 'failed',
                             processed_at = NOW(),
                             gateway_response = $1,
                             error_message = $2,
                             updated_at = NOW()
                         WHERE reference = $3`,
                        [JSON.stringify(data), data.gateway_response?.message || 'Payment failed', reference]
                    );

                    await client.query(
                        `UPDATE orders
                         SET status = 'payment_failed',
                             payment_status = 'failed',
                             updated_at = NOW()
                         WHERE id = $1`,
                        [orderId]
                    );

                    await client.query('COMMIT');
                    console.log(`[Payments/Webhook] charge.failed — ref: ${reference}`);

                    eventBus.emitEvent('payment.failed', { tenantId, orderId, reference });

                    const io = app.get('io');
                    if (io) {
                        io.to(`payment:${reference}`).emit('payment.failed', { reference, orderId });
                    }

                } else {
                    await client.query('ROLLBACK');
                    console.log(`[Payments/Webhook] Unhandled event type: ${eventName}`);
                }

            } catch (err) {
                await client.query('ROLLBACK');
                console.error('[Payments/Webhook] CRITICAL ERROR:', err.message);
                // Return 200 so Paystack doesn't stop retrying — manual reconciliation via logs
            } finally {
                client.release();
            }

            return res.status(200).json({ received: true });
        }));

        // Mount public router (no tenant/subscriptionGuard middleware)
        app.use('/payments', publicRouter);

        // =====================================================================
        // PROTECTED ROUTER — requires tenant context + subscriptionGuard
        // =====================================================================
        const router = express.Router();
        router.use(subscriptionGuard('payments'));

        // =====================================================================
        // POST /payments/paystack/initialize
        // Initializes a Paystack transaction and creates a pending order + payment
        // =====================================================================
        router.post('/paystack/initialize', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { cartId, email: guestEmail, shippingAddress, vendorId } = req.body;

            const email = user?.email || guestEmail;

            if (!email) {
                return res.status(400).json({ error: 'ValidationError', message: 'Email is required' });
            }
            if (!cartId) {
                return res.status(400).json({ error: 'ValidationError', message: 'Cart ID is required' });
            }

            // 1. Fetch cart
            const cartResult = await query(
                `SELECT * FROM carts WHERE id = $1 AND tenant_id = $2`,
                [cartId, tenantId]
            );
            if (!cartResult.rows[0]) {
                return res.status(404).json({ error: 'CartNotFound', message: 'Cart not found' });
            }

            // 2. Fetch items
            let itemsSql, itemsParams;
            if (vendorId) {
                itemsSql = `
                    SELECT ci.*, p.name as product_name, p.created_by as vendor_id, p.image_url
                    FROM cart_items ci
                    LEFT JOIN products p ON ci.product_id = p.id
                    WHERE ci.cart_id = $1 AND p.created_by = $2
                `;
                itemsParams = [cartId, vendorId];
            } else {
                itemsSql = `
                    SELECT ci.*, p.name as product_name, p.created_by as vendor_id, p.image_url
                    FROM cart_items ci
                    LEFT JOIN products p ON ci.product_id = p.id
                    WHERE ci.cart_id = $1
                `;
                itemsParams = [cartId];
            }
            const itemsResult = await query(itemsSql, itemsParams);
            const items = itemsResult.rows;

            if (items.length === 0) {
                return res.status(400).json({ error: 'EmptyCart', message: 'Cart has no items' });
            }

            // 3. Calculate totals SERVER-SIDE (never trust the frontend for amounts)
            const subtotalNGN = items.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
            const shippingNGN = FLAT_SHIPPING_NGN;
            const totalNGN = subtotalNGN + shippingNGN;
            const totalKobo = Math.round(totalNGN * 100);

            // 4. Generate OUR idempotency reference BEFORE any DB or Paystack call
            const reference = `be3_${uuidv4().replace(/-/g, '')}`;
            const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const dbVendorId = !vendorId || vendorId === 'platform' ? null : vendorId;

            // 5. Create order with status `pending_payment`
            const order = await tenantInsert('orders', tenantId, {
                order_number: orderNumber,
                user_id: user?.id || null,
                vendor_id: dbVendorId,
                status: 'pending_payment',
                payment_status: 'pending',
                paystack_reference: reference,
                subtotal: subtotalNGN,
                total: totalNGN,
                currency: 'NGN',
                customer_email: email,
                metadata: {
                    cart_id: cartId,
                    shipping_address: shippingAddress || null,
                }
            });

            // 6. Insert order items
            for (const item of items) {
                await tenantInsert('order_items', tenantId, {
                    order_id: order.id,
                    product_id: item.product_id,
                    variant_id: item.variant_id || null,
                    product_name: item.product_name,
                    quantity: item.quantity,
                    price: item.price,
                    total: parseFloat(item.price) * item.quantity,
                    image_url: item.image_url || null,
                });
            }

            // 7. Create payment record
            await tenantInsert('payments', tenantId, {
                order_id: order.id,
                user_id: user?.id || null,
                provider: 'paystack',
                reference,
                idempotency_key: reference,
                amount: totalNGN,
                currency: 'NGN',
                status: 'processing',
                metadata: JSON.stringify({ cartId, orderNumber }),
            });

            // 8. Remove only the checked-out items from the cart (surgical checkout).
            //    The cart itself and any remaining items are untouched.
            const orderedProductIds = items.map(i => i.product_id);
            if (orderedProductIds.length > 0) {
                await query(
                    `DELETE FROM cart_items
                     WHERE cart_id = $1
                       AND product_id = ANY($2::uuid[])`,
                    [cartId, orderedProductIds]
                );
            }

            // 9. Call Paystack API
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3003';
            const callbackUrl = `${frontendUrl}/checkout/verify`;

            const paystackData = await PaystackService.initializeTransaction({
                reference,
                email,
                amountKobo: totalKobo,
                callbackUrl,
                metadata: {
                    tenantId,
                    orderId: order.id,
                    cartId,
                    userId: user?.id || null,
                    orderNumber: order.order_number,
                },
            });

            return res.status(201).json({
                success: true,
                authorization_url: paystackData.authorization_url,
                reference,
                orderId: order.id,
                orderNumber: order.order_number,
                total: totalNGN,
            });
        }));

        // =====================================================================
        // GET /payments/paystack/status/:reference
        // Verify page polls this — returns payment + order state
        // =====================================================================
        router.get('/paystack/status/:reference', optionalAuth, asyncHandler(async (req, res) => {
            const { reference } = req.params;
            const { tenantId } = req;

            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');

            const result = await query(
                `SELECT p.status as p_status, p.processed_at,
                        o.id as order_id, o.order_number, o.status as order_status,
                        o.payment_status as o_p_status, o.created_at as order_created_at
                 FROM payments p
                 LEFT JOIN orders o ON p.order_id = o.id
                 WHERE p.reference = $1 AND p.tenant_id = $2
                 ORDER BY p.created_at DESC
                 LIMIT 1`,
                [reference, tenantId]
            );

            if (!result.rows[0]) {
                return res.status(404).json({ error: 'NotFound', message: 'Payment not found' });
            }

            const row = result.rows[0];

            // Derive effective status for the frontend state machine
            // Normalize: payments table uses 'succeeded', orders table uses 'paid'
            let effectiveStatus = row.p_status; // 'processing' | 'succeeded' | 'failed'
            if (row.o_p_status === 'paid') effectiveStatus = 'succeeded';

            // If still processing after 30 minutes, flag as timed_out
            if (effectiveStatus === 'processing' && row.order_created_at) {
                const ageMinutes = (Date.now() - new Date(row.order_created_at).getTime()) / 60000;
                if (ageMinutes > 30) effectiveStatus = 'timed_out';
            }

            return res.json({
                success: true,
                status: effectiveStatus,
                orderId: row.order_id,
                orderNumber: row.order_number,
            });
        }));

        // =====================================================================
        // POST /payments/paystack/retry/:orderId
        // Retry payment — ONLY allowed if payment_status is explicitly 'failed'
        // Blocked for: processing, pending, timed_out, succeeded
        // =====================================================================
        router.post('/paystack/retry/:orderId', optionalAuth, asyncHandler(async (req, res) => {
            const { orderId } = req.params;
            const { tenantId, user } = req;
            const { email: guestEmail } = req.body;

            // 1. Fetch the order
            const orderResult = await query(
                `SELECT * FROM orders WHERE id = $1 AND tenant_id = $2`,
                [orderId, tenantId]
            );
            if (!orderResult.rows[0]) {
                return res.status(404).json({ error: 'OrderNotFound', message: 'Order not found' });
            }
            const order = orderResult.rows[0];

            // 2. Hard block: only retry if payment_status is 'failed'
            if (order.payment_status !== 'failed') {
                const messages = {
                    paid: 'This order has already been paid.',
                    pending: 'Payment is still being verified. Please wait.',
                    processing: 'Payment is still processing. Please wait before retrying.',
                };
                return res.status(409).json({
                    error: 'RetryNotAllowed',
                    message: messages[order.payment_status] || 'Retry is not allowed for this order.',
                    payment_status: order.payment_status,
                });
            }

            const email = user?.email || guestEmail || order.customer_email;
            if (!email) {
                return res.status(400).json({ error: 'ValidationError', message: 'Email is required' });
            }

            // 3. Generate a fresh reference for this retry attempt
            const reference = `be3_${uuidv4().replace(/-/g, '')}`;

            // 4. Reset order status to pending_payment and update reference
            await query(
                `UPDATE orders
                 SET status = 'pending_payment',
                     payment_status = 'pending',
                     paystack_reference = $1,
                     updated_at = NOW()
                 WHERE id = $2`,
                [reference, orderId]
            );

            // 5. Create new payment attempt record
            await tenantInsert('payments', tenantId, {
                order_id: orderId,
                user_id: user?.id || null,
                provider: 'paystack',
                reference,
                idempotency_key: reference,
                amount: parseFloat(order.total),
                currency: order.currency || 'NGN',
                status: 'processing',
                metadata: JSON.stringify({ retry: true, orderId }),
            });

            // 6. Initialize with Paystack
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3003';
            const callbackUrl = `${frontendUrl}/checkout/verify`;
            const totalKobo = Math.round(parseFloat(order.total) * 100);

            const paystackData = await PaystackService.initializeTransaction({
                reference,
                email,
                amountKobo: totalKobo,
                callbackUrl,
                metadata: {
                    tenantId,
                    orderId,
                    userId: user?.id || null,
                    orderNumber: order.order_number,
                    isRetry: true,
                },
            });

            return res.status(201).json({
                success: true,
                authorization_url: paystackData.authorization_url,
                reference,
                orderId,
            });
        }));


        app.use('/payments', router);
        console.log('[Payments] Paystack module initialized');

        return true;
    } catch (error) {
        console.error('[Payments] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
