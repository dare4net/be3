/**
 * Shipping Module Bootstrapper
 * 
 * PRINCIPLE: All inter-module communication is event-based
 */

const express = require('express');
const { query } = require('../../config/database');
const { tenantInsert, paginatedTenantQuery } = require('../../utils/dbHelpers');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../middleware/errorHandler');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();
        router.use(subscriptionGuard('shipping'));

        // List Zones
        router.get('/zones', authenticate, asyncHandler(async (req, res) => {
            const result = await paginatedTenantQuery('shipping_zones', req.tenantId, {});
            res.json({ success: true, ...result });
        }));

        // Create Zone
        router.post('/zones', authenticate, asyncHandler(async (req, res) => {
            const zone = await tenantInsert('shipping_zones', req.tenantId, {
                name: req.body.name,
                regions: req.body.regions || []
            });
            res.status(201).json({ success: true, zone });
        }));

        // Add Rate to Zone
        router.post('/rates', authenticate, asyncHandler(async (req, res) => {
            const rate = await tenantInsert('shipping_rates', req.tenantId, {
                zone_id: req.body.zone_id,
                name: req.body.name,
                type: req.body.type,
                amount: req.body.amount,
                min_order_value: req.body.min_order_value
            });
            res.status(201).json({ success: true, rate });
        }));

        // Calculate Shipping (Public/Checkout)
        // Simple logic: returns all applicable rates for "US" (default)
        router.post('/calculate', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId } = req;
            const { country, subtotal } = req.body;

            // 1. Find matching zone
            // (Simplified: assuming 'US' is in the regions array)
            const zoneSql = `
                SELECT id FROM shipping_zones 
                WHERE tenant_id = $1 AND $2 = ANY(regions)
                LIMIT 1
            `;
            const zoneRes = await query(zoneSql, [tenantId, country || 'US']);

            if (!zoneRes.rows[0]) {
                // Return default rate if no zone found
                return res.json({ success: true, rates: [] });
            }

            const zoneId = zoneRes.rows[0].id;

            // 2. Get rates for zone
            const ratesSql = `SELECT * FROM shipping_rates WHERE zone_id = $1`;
            const ratesRes = await query(ratesSql, [zoneId]);

            // Filter by min order value
            const applicableRates = ratesRes.rows.filter(rate => {
                if (rate.min_order_value && subtotal < parseFloat(rate.min_order_value)) {
                    return false;
                }
                return true;
            });

            res.json({ success: true, rates: applicableRates });
        }));

        // ==========================================
        // Event Listeners
        // ==========================================

        // Order Created -> Create Pending Shipment
        eventBus.registerListener('order.created', async (event) => {
            const { tenantId, orderId, orderNumber } = event.data;

            // Simulate Courier Assignment
            const courier = 'DHL';
            const trackingNumber = 'TRK' + Math.floor(Math.random() * 1000000);
            const trackingUrl = `https://track.dhl.com?n=${trackingNumber}`;

            await tenantInsert('shipments', tenantId, {
                order_id: orderId,
                status: 'pending',
                courier_code: courier,
                tracking_number: trackingNumber,
                tracking_url: trackingUrl,
                estimated_delivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // +3 days
            });

            eventBus.emitEvent('shipping.shipment_created', {
                tenantId,
                orderId,
                trackingNumber,
                courier
            });

            console.log(`[Shipping] Created shipment ${trackingNumber} for Order ${orderNumber}`);
        }, 'shipping');

        app.use('/shipping', router);
        console.log('[Shipping] Module initialized');

        return true;
    } catch (error) {
        console.error('[Shipping] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
