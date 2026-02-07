/**
 * Cart Module Bootstrapper
 * 
 * PRINCIPLE: Modules do not import other modules
 * PRINCIPLE: No cross-module database foreign keys
 */

const express = require('express');
const { query } = require('../../config/database');
const { tenantInsert } = require('../../utils/dbHelpers');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../middleware/errorHandler');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();
        router.use(subscriptionGuard('cart'));

        // Get cart (guest or authenticated)
        router.get('/', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            let cart;

            if (user) {
                // Get user's active cart
                const result = await query(
                    `SELECT * FROM carts WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
                    [tenantId, user.id]
                );
                cart = result.rows[0];
            } else if (req.query.session_id) {
                // Get guest cart by session
                const result = await query(
                    `SELECT * FROM carts WHERE tenant_id = $1 AND session_id = $2 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
                    [tenantId, req.query.session_id]
                );
                cart = result.rows[0];
            }

            if (!cart) {
                return res.json({ success: true, cart: null, items: [] });
            }

            // Get cart items with product and vendor details
            const itemsResult = await query(
                `SELECT 
                    ci.*, 
                    p.name as product_name, 
                    p.image_url,
                    p.created_by as vendor_id,
                    u.business_name,
                    u.checkout_style,
                    u.whatsapp_phone
                 FROM cart_items ci
                 JOIN products p ON ci.product_id = p.id
                 LEFT JOIN users u ON p.created_by = u.id
                 WHERE ci.cart_id = $1 AND ci.tenant_id = $2`,
                [cart.id, tenantId]
            );

            // Group items by vendor
            const vendorGroupsMap = new Map();
            itemsResult.rows.forEach(item => {
                const vendorId = item.vendor_id || 'platform';
                if (!vendorGroupsMap.has(vendorId)) {
                    vendorGroupsMap.set(vendorId, {
                        vendorId,
                        businessName: item.business_name || 'Generic',
                        checkoutStyle: item.checkout_style || 'inhouse',
                        whatsappPhone: item.whatsapp_phone || null,
                        items: []
                    });
                }
                vendorGroupsMap.get(vendorId).items.push(item);
            });

            const vendorGroups = Array.from(vendorGroupsMap.values());

            res.json({
                success: true,
                cart,
                items: itemsResult.rows,
                vendorGroups
            });
        }));

        // Add item to cart
        router.post('/items', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { product_id, variant_id, quantity, price, session_id } = req.body;

            // Get or create cart
            let cart;
            if (user) {
                const result = await query(
                    `SELECT * FROM carts WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
                    [tenantId, user.id]
                );
                cart = result.rows[0];

                if (!cart) {
                    cart = await tenantInsert('carts', tenantId, { user_id: user.id });
                }
            } else if (session_id) {
                const result = await query(
                    `SELECT * FROM carts WHERE tenant_id = $1 AND session_id = $2 AND status = 'active'ORDER BY created_at DESC LIMIT 1`,
                    [tenantId, session_id]
                );
                cart = result.rows[0];

                if (!cart) {
                    cart = await tenantInsert('carts', tenantId, { session_id });
                }
            } else {
                return res.status(400).json({ error: 'Session ID required for guest cart' });
            }

            // Add item
            const item = await tenantInsert('cart_items', tenantId, {
                cart_id: cart.id,
                product_id,
                variant_id,
                quantity,
                price,
            });

            eventBus.emitEvent('cart.item_added', {
                tenantId,
                cartId: cart.id,
                productId: product_id,
            });

            res.status(201).json({ success: true, item });
        }));

        // Update cart item quantity
        router.patch('/items/:id', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId } = req;
            const { quantity } = req.body;
            const { id } = req.params;

            // Update item
            // Check ownership via cart_id join could be added here for extra security
            const result = await query(
                `UPDATE cart_items SET quantity = $1, updated_at = NOW() 
                 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
                [quantity, id, tenantId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Item not found' });
            }

            const item = result.rows[0];

            eventBus.emitEvent('cart.updated', {
                tenantId,
                cartId: item.cart_id,
                action: 'update_item',
                itemId: id
            });

            res.json({ success: true, item });
        }));

        // Remove item from cart
        router.delete('/items/:id', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId } = req;
            const { id } = req.params;

            const result = await query(
                `DELETE FROM cart_items WHERE id = $1 AND tenant_id = $2 RETURNING *`,
                [id, tenantId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Item not found' });
            }

            const item = result.rows[0];

            eventBus.emitEvent('cart.updated', {
                tenantId,
                cartId: item.cart_id,
                action: 'remove_item',
                itemId: id
            });

            eventBus.emitEvent('cart.item_removed', {
                tenantId,
                cartId: item.cart_id,
                productId: item.product_id
            });

            res.json({ success: true, message: 'Item removed' });
        }));

        app.use('/cart', router);
        console.log('[Cart] Module initialized');

        return true;
    } catch (error) {
        console.error('[Cart] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
