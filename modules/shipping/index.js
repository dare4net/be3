/**
 * Shipping Module Bootstrapper
 * 
 * PRINCIPLE: All inter-module communication is event-based
 */

const express = require('express');
const { query } = require('../../config/database');
const { tenantInsert, paginatedTenantQuery } = require('../../utils/dbHelpers');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../middleware/errorHandler');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();

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

        const { calculateSecureShipping } = require('./shippingService');

        // Advanced Calculate Shipping (Public/Checkout)
        router.post('/calculate', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId } = req;
            const { cart_items, destination } = req.body;

            if (!cart_items || cart_items.length === 0 || !destination) {
                return res.status(400).json({ error: 'Cart items and destination are required' });
            }

            // Fill missing overrides automatically before passing to secure engine if product object missing it
            for (const item of cart_items) {
                let pData = item.product;
                if (!pData || pData.shipping_base_fee_override === undefined) {
                    const pRes = await query(`
                        SELECT shipping_base_fee_override, disable_shipping_multiplier,
                        processing_min_override, processing_max_override,
                        transit_min_override, transit_max_override
                        FROM products WHERE id = $1 AND tenant_id = $2
                    `, [item.product_id, tenantId]);
                    if (pRes.rows[0]) item.product = { ...(item.product || {}), ...pRes.rows[0] };
                }
            }

            try {
                const { total_fee, breakdowns } = await calculateSecureShipping(tenantId, cart_items, destination);
                res.json({ success: true, total_fee, breakdowns });
            } catch (err) {
                if (err.message.includes('does not deliver')) {
                    const vIdMatch = err.message.match(/Vendor ([\w-]+)/);
                    return res.status(400).json({ error: err.message, vendor_id: vIdMatch ? vIdMatch[1] : null });
                }
                throw err;
            }
        }));

        // ==========================================
        // Vendor Zonal Shipping Rules & Topology
        // ==========================================

        router.get('/topology/countries', asyncHandler(async (req, res) => {
            const { vendor_id } = req.query;
            let sql = `SELECT id, name, code FROM countries WHERE tenant_id = $1 ORDER BY name ASC`;
            let params = [req.tenantId];
            let unconfigured = false;

            if (vendor_id) {
                const check = await query(`SELECT id FROM vendor_shipping_zones WHERE tenant_id=$1 AND vendor_id=$2 LIMIT 1`, [req.tenantId, vendor_id]);
                if (check.rows.length === 0) {
                    unconfigured = true;
                } else {
                    sql = `
                        SELECT DISTINCT c.id, c.name, c.code FROM countries c
                        LEFT JOIN states s ON s.country_id = c.id
                        LEFT JOIN landmarks l ON l.state_id = s.id
                        JOIN vendor_shipping_zones z ON 
                            (z.location_type = 'country' AND z.location_id = c.id) OR 
                            (z.location_type = 'state' AND z.location_id = s.id) OR 
                            (z.location_type = 'landmark' AND z.location_id = l.id)
                        WHERE c.tenant_id = $1 AND z.vendor_id = $2
                        ORDER BY c.name ASC
                    `;
                    params.push(vendor_id);
                }
            }
            const result = await query(sql, params);
            res.json({ success: true, countries: result.rows, unconfigured });
        }));

        router.post('/topology/countries', authenticate, asyncHandler(async (req, res) => {
            const { name, code } = req.body;
            if (!name || !code) return res.status(400).json({ error: 'name and code required' });
            const result = await query(`INSERT INTO countries (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id, name, code`, [req.tenantId, name, code]);
            res.json({ success: true, country: result.rows[0] });
        }));

        router.delete('/topology/countries/:id', authenticate, asyncHandler(async (req, res) => {
            await query(`DELETE FROM countries WHERE tenant_id = $1 AND id = $2`, [req.tenantId, req.params.id]);
            res.json({ success: true });
        }));

        router.get('/topology/states', asyncHandler(async (req, res) => {
            const countryId = req.query.country_id;
            const { vendor_id } = req.query;

            let sql = `SELECT id, name, code, country_id FROM states WHERE tenant_id = $1`;
            let params = [req.tenantId];

            if (vendor_id) {
                const check = await query(`SELECT id FROM vendor_shipping_zones WHERE tenant_id=$1 AND vendor_id=$2 LIMIT 1`, [req.tenantId, vendor_id]);
                if (check.rows.length > 0) {
                    sql = `
                        SELECT DISTINCT s.id, s.name, s.code, s.country_id FROM states s
                        LEFT JOIN landmarks l ON l.state_id = s.id
                        JOIN vendor_shipping_zones z ON 
                            (z.location_type = 'country' AND z.location_id = s.country_id) OR 
                            (z.location_type = 'state' AND z.location_id = s.id) OR 
                            (z.location_type = 'landmark' AND z.location_id = l.id)
                        WHERE s.tenant_id = $1 AND z.vendor_id = $2
                    `;
                    params = [req.tenantId, vendor_id];
                    if (countryId) {
                        sql += ` AND s.country_id = $3`;
                        params.push(countryId);
                    }
                } else if (countryId) {
                    sql += ` AND country_id = $2`;
                    params.push(countryId);
                }
            } else if (countryId) {
                sql += ` AND country_id = $2`;
                params.push(countryId);
            }
            sql += ` ORDER BY name ASC`;

            const result = await query(sql, params);
            res.json({ success: true, states: result.rows });
        }));

        router.post('/topology/states', authenticate, asyncHandler(async (req, res) => {
            const { country_id, name, code } = req.body;
            if (!country_id || !name) return res.status(400).json({ error: 'country_id and name required' });
            const result = await query(`INSERT INTO states (tenant_id, country_id, name, code) VALUES ($1, $2, $3, $4) RETURNING id, name, code, country_id`, [req.tenantId, country_id, name, code || null]);
            res.json({ success: true, state: result.rows[0] });
        }));

        router.delete('/topology/states/:id', authenticate, asyncHandler(async (req, res) => {
            await query(`DELETE FROM states WHERE tenant_id = $1 AND id = $2`, [req.tenantId, req.params.id]);
            res.json({ success: true });
        }));

        router.get('/topology/landmarks', asyncHandler(async (req, res) => {
            const stateId = req.query.state_id;
            const { vendor_id } = req.query;
            if (!stateId) return res.status(400).json({ error: 'state_id is required' });

            let sql = `SELECT id, name, state_id FROM landmarks WHERE tenant_id = $1 AND state_id = $2`;
            let params = [req.tenantId, stateId];

            if (vendor_id) {
                const check = await query(`SELECT id FROM vendor_shipping_zones WHERE tenant_id=$1 AND vendor_id=$2 LIMIT 1`, [req.tenantId, vendor_id]);
                if (check.rows.length > 0) {
                    sql = `
                        SELECT DISTINCT l.id, l.name, l.state_id FROM landmarks l
                        JOIN states s ON l.state_id = s.id
                        JOIN vendor_shipping_zones z ON 
                            (z.location_type = 'country' AND z.location_id = s.country_id) OR 
                            (z.location_type = 'state' AND z.location_id = s.id) OR 
                            (z.location_type = 'landmark' AND z.location_id = l.id)
                        WHERE l.tenant_id = $1 AND l.state_id = $2 AND z.vendor_id = $3
                    `;
                    params.push(vendor_id);
                }
            }
            sql += ` ORDER BY name ASC`;

            const result = await query(sql, params);
            res.json({ success: true, landmarks: result.rows });
        }));

        router.post('/topology/landmarks', authenticate, asyncHandler(async (req, res) => {
            const { state_id, name } = req.body;
            // Removed validation constraints to allow flexibility, but ensure parent exists natively by CASCADE/FKEY
            if (!state_id || !name) return res.status(400).json({ error: 'state_id and name required' });
            const result = await query(`INSERT INTO landmarks (tenant_id, state_id, name) VALUES ($1, $2, $3) RETURNING id, name, state_id`, [req.tenantId, state_id, name]);
            res.json({ success: true, landmark: result.rows[0] });
        }));

        router.delete('/topology/landmarks/:id', authenticate, asyncHandler(async (req, res) => {
            await query(`DELETE FROM landmarks WHERE tenant_id = $1 AND id = $2`, [req.tenantId, req.params.id]);
            res.json({ success: true });
        }));

        // Get Current Vendor's Shipping Config
        router.get('/vendor-config', authenticate, asyncHandler(async (req, res) => {
            const PermissionService = require('../../platform/core/roles/services/PermissionService');
            const { isVendor, permissions } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);
            if (!isVendor && !permissions.includes('*')) return res.status(403).json({ error: 'Only vendors can have a shipping config' });

            const vendorId = req.user.id;

            // 1. Get global config
            const configReq = await query(`SELECT * FROM vendor_shipping_configs WHERE tenant_id = $1 AND vendor_id = $2`, [req.tenantId, vendorId]);
            const config = configReq.rows[0] || { unconfigured: true, global_base_fee: 1500, global_processing_min: 1, global_processing_max: 2 };

            // 2. Get zones
            const zonesReq = await query(`
                SELECT z.*,
                        c.name as country_name,
                        s.name as state_name,
                        l.name as landmark_name
                FROM vendor_shipping_zones z
                LEFT JOIN countries c ON z.location_type = 'country' AND z.location_id = c.id
                LEFT JOIN states s ON z.location_type = 'state' AND z.location_id = s.id
                LEFT JOIN landmarks l ON z.location_type = 'landmark' AND z.location_id = l.id
                WHERE z.tenant_id = $1 AND z.vendor_id = $2
                        `, [req.tenantId, vendorId]);

            res.json({ success: true, config, zones: zonesReq.rows });
        }));

        // Upsert Vendor's Shipping Config
        router.put('/vendor-config', authenticate, asyncHandler(async (req, res) => {
            const PermissionService = require('../../platform/core/roles/services/PermissionService');
            const { isVendor, permissions } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);
            if (!isVendor && !permissions.includes('*')) return res.status(403).json({ error: 'Only vendors can have a shipping config' });

            const vendorId = req.user.id;
            const { global_base_fee, global_processing_min, global_processing_max } = req.body;
            // Note: base_fee comes from frontend as base_fee sometimes instead of global_base_fee
            const parsedBaseFee = req.body.base_fee !== undefined ? req.body.base_fee : global_base_fee;

            const client = await require('../../config/database').pool.connect();
            try {
                await client.query('BEGIN');

                // Upsert Config
                await client.query(`
                    INSERT INTO vendor_shipping_configs(tenant_id, vendor_id, global_base_fee, global_processing_min, global_processing_max, updated_at)
                    VALUES($1, $2, $3, $4, $5, NOW())
                    ON CONFLICT(tenant_id, vendor_id) DO UPDATE SET
                        global_base_fee = EXCLUDED.global_base_fee,
                        global_processing_min = EXCLUDED.global_processing_min,
                        global_processing_max = EXCLUDED.global_processing_max,
                        updated_at = NOW()
                            `, [req.tenantId, vendorId, parsedBaseFee || 1500, global_processing_min || 1, global_processing_max || 2]);

                await client.query('COMMIT');
                res.json({ success: true, message: 'Vendor Shipping configuration updated successfully' });
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }));

        // Add a singular Zone to Vendor Config
        router.post('/vendor-config/zones', authenticate, asyncHandler(async (req, res) => {
            const PermissionService = require('../../platform/core/roles/services/PermissionService');
            const { isVendor, permissions } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);
            if (!isVendor && !permissions.includes('*')) return res.status(403).json({ error: 'Only vendors can have a shipping config' });

            const vendorId = req.user.id;
            const { location_type, location_id, multiplier, transit_min, transit_max } = req.body;

            if (!location_type || !location_id) return res.status(400).json({ error: 'location_type and location_id required' });

            // Check if constraint exists, if so update it, else insert
            const result = await query(`
                INSERT INTO vendor_shipping_zones(tenant_id, vendor_id, location_type, location_id, multiplier, transit_min, transit_max)
                VALUES($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT(tenant_id, vendor_id, location_type, location_id) DO UPDATE SET
                    multiplier = EXCLUDED.multiplier,
                    transit_min = EXCLUDED.transit_min,
                    transit_max = EXCLUDED.transit_max
                RETURNING id
            `, [req.tenantId, vendorId, location_type, location_id, multiplier, transit_min, transit_max]);

            res.json({ success: true, zone_id: result.rows[0].id });
        }));

        // Delete a singular Zone from Vendor Config
        router.delete('/vendor-config/zones/:id', authenticate, asyncHandler(async (req, res) => {
            const PermissionService = require('../../platform/core/roles/services/PermissionService');
            const { isVendor, permissions } = await PermissionService.getUserPermissionContext(req.tenantId, req.user.id);
            if (!isVendor && !permissions.includes('*')) return res.status(403).json({ error: 'Only vendors can have a shipping config' });

            const vendorId = req.user.id;
            const zoneId = req.params.id;

            await query(`DELETE FROM vendor_shipping_zones WHERE tenant_id = $1 AND vendor_id = $2 AND id = $3`, [req.tenantId, vendorId, zoneId]);
            res.json({ success: true });
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
