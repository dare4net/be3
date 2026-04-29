/**
 * Checkout Module - Basic scaffold
 * PRINCIPLE: All inter-module communication is event-based
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
        router.use(subscriptionGuard('checkout'));

        // Initialize checkout
        router.post('/initialize', authenticate, asyncHandler(async (req, res) => {
            // Would fetch cart data and calculate totals
            eventBus.emitEvent('checkout.initialized', {
                tenantId: req.tenantId,
                userId: req.user.id,
            });
            res.json({ success: true, message: 'Checkout initialized' });
        }));

        // Process Checkout (Mock Payment - Allow Guests)
        router.post('/process', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { cartId, billingAddress, shippingAddress, paymentMethod, email, vendorId } = req.body;

            console.log(`[Checkout] Processing request for tenant: ${tenantId}, user: ${user?.id || 'guest'}, cart: ${cartId}, vendor: ${vendorId || 'ALL'}`);

            // 1. Get Cart
            const { query } = require('../../config/database');
            const cartSql = `SELECT * FROM carts WHERE id = $1 AND tenant_id = $2`;
            const cartResult = await query(cartSql, [cartId, tenantId]);

            if (!cartResult.rows[0]) {
                return res.status(404).json({ error: 'Cart not found' });
            }

            // 2. Get items — filtered by vendor if provided
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
                return res.status(400).json({ error: 'Cart is empty' });
            }

            // 3. Calculate Totals (only for this vendor's items)
            let subtotal = 0;
            items.forEach(item => {
                subtotal += parseFloat(item.price) * item.quantity;
            });

            // Mock tax/shipping logic
            const tax = subtotal * 0.1;
            const shipping = 15.00;
            const total = subtotal + tax + shipping;

            // 4. Mock Payment Processing
            console.log('[Checkout] Processing payment...');

            // 5. Emit Payment Success (Triggers Order Creation)
            const paymentData = {
                transactionId: `txn_${Date.now()}`,
                amount: total,
                currency: 'USD',
                subtotal,
                tax,
                shipping,
                total,
                userId: user ? user.id : null,
                email: user ? user.email : email,
                billingAddress,
                shippingAddress,
                vendorId: vendorId || null,
                items: items.map(item => ({
                    productId: item.product_id,
                    variantId: item.variant_id,
                    quantity: item.quantity,
                    price: item.price,
                    product_name: item.product_name,
                    vendorId: item.vendor_id,
                    image_url: item.image_url
                }))
            };

            eventBus.emitEvent('payment.success', {
                tenantId,
                cartId,
                paymentData
            });

            // 6. Remove only the checked-out items from the cart (not the whole cart)
            const checkedOutItemIds = items.map(i => i.id);
            await query(
                `DELETE FROM cart_items WHERE id = ANY($1::uuid[])`,
                [checkedOutItemIds]
            );

            // Check if cart still has items from other vendors
            const remainingItems = await query(
                `SELECT COUNT(*) as count FROM cart_items WHERE cart_id = $1`,
                [cartId]
            );
            
            // Only mark cart as completed if no items remain
            if (parseInt(remainingItems.rows[0].count) === 0) {
                await query(`UPDATE carts SET status = 'completed' WHERE id = $1`, [cartId]);
            }

            res.json({
                success: true,
                message: 'Order processing',
                transactionId: paymentData.transactionId
            });
        }));

        // Calculate totals
        router.post('/calculate-totals', authenticate, asyncHandler(async (req, res) => {
            const { subtotal, tax, shipping } = req.body;
            const total = (subtotal || 0) + (tax || 0) + (shipping || 0);

            res.json({ success: true, subtotal, tax, shipping, total });
        }));

        app.use('/checkout', router);
        console.log('[Checkout] Module initialized');

        return true;
    } catch (error) {
        console.error('[Checkout] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
