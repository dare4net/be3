/**
 * Discount / Coupons Module
 *
 * Handles coupon creation, validation, and application.
 * Integrates with orders via event bus and checkout via direct validation endpoint.
 *
 * Routes:
 *   GET    /discounts           — list coupons (admin/vendor scoped)
 *   POST   /discounts           — create coupon
 *   PATCH  /discounts/:id       — update coupon
 *   DELETE /discounts/:id       — deactivate coupon
 *   POST   /discounts/validate  — validate a coupon code (public, used at checkout)
 */

const express = require('express');
const { query } = require('../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate } = require('../../utils/dbHelpers');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const authorize = require('../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../middleware/errorHandler');

// ── DB Migration (runs once on bootstrap) ────────────────────────────────────
async function runMigration() {
    await query(`
        CREATE TABLE IF NOT EXISTS discounts (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL,
            code            VARCHAR(64) NOT NULL,
            description     TEXT,
            type            VARCHAR(32) NOT NULL DEFAULT 'percentage',  -- percentage | fixed | free_shipping
            value           NUMERIC(12,2) NOT NULL DEFAULT 0,           -- % or fixed amount
            min_order_value NUMERIC(12,2) DEFAULT 0,
            max_uses        INTEGER DEFAULT NULL,                        -- NULL = unlimited
            used_count      INTEGER NOT NULL DEFAULT 0,
            applicable_to   VARCHAR(32) DEFAULT 'all',                  -- all | products | categories
            applicable_ids  UUID[] DEFAULT '{}',
            vendor_id       UUID DEFAULT NULL,                          -- NULL = admin coupon
            starts_at       TIMESTAMPTZ DEFAULT NOW(),
            expires_at      TIMESTAMPTZ DEFAULT NULL,
            is_active       BOOLEAN NOT NULL DEFAULT true,
            created_by      UUID,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (tenant_id, code)
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_discounts_tenant_code ON discounts (tenant_id, code);`);
    console.log('[Discount] Migration complete');
}

// ── Validation helper ─────────────────────────────────────────────────────────
async function validateCoupon(tenantId, code, orderTotal = 0, productIds = []) {
    const result = await query(
        `SELECT * FROM discounts WHERE tenant_id = $1 AND UPPER(code) = UPPER($2) AND is_active = true`,
        [tenantId, code]
    );
    const coupon = result.rows[0];

    if (!coupon) return { valid: false, error: 'Coupon not found or inactive' };

    const now = new Date();
    if (coupon.starts_at && new Date(coupon.starts_at) > now) {
        return { valid: false, error: 'Coupon is not yet active' };
    }
    if (coupon.expires_at && new Date(coupon.expires_at) < now) {
        return { valid: false, error: 'Coupon has expired' };
    }
    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
        return { valid: false, error: 'Coupon usage limit reached' };
    }
    if (parseFloat(coupon.min_order_value) > 0 && orderTotal < parseFloat(coupon.min_order_value)) {
        return { valid: false, error: `Minimum order value of ${coupon.min_order_value} required` };
    }
    if (coupon.applicable_to === 'products' && coupon.applicable_ids.length > 0) {
        const applicable = productIds.some(id => coupon.applicable_ids.includes(id));
        if (!applicable) return { valid: false, error: 'Coupon not applicable to items in your order' };
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (coupon.type === 'percentage') {
        discountAmount = (orderTotal * parseFloat(coupon.value)) / 100;
    } else if (coupon.type === 'fixed') {
        discountAmount = Math.min(parseFloat(coupon.value), orderTotal);
    } else if (coupon.type === 'free_shipping') {
        discountAmount = 0; // handled at checkout level
    }

    return { valid: true, coupon, discount_amount: discountAmount };
}

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        await runMigration();

        const router = express.Router();

        // ── GET / — list coupons ───────────────────────────────────────────
        router.get('/', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;

            // Vendors only see their own coupons
            const Role = require('../../platform/core/roles/models/Role');
            const roles = await Role.getUserRoles(tenantId, user.id);
            const userIsVendor = roles.some(r => r.name === 'Vendor' || r === 'Vendor');
            const userIsAdmin = roles.some(r => r.name === 'Admin' || r === 'Admin' || r.name === 'Super Admin');

            let sql = `SELECT * FROM discounts WHERE tenant_id = $1`;
            const params = [tenantId];

            if (userIsVendor && !userIsAdmin) {
                sql += ` AND vendor_id = $2`;
                params.push(user.id);
            }

            if (req.query.active !== undefined) {
                sql += ` AND is_active = $${params.length + 1}`;
                params.push(req.query.active === 'true');
            }

            sql += ` ORDER BY created_at DESC`;
            const page = parseInt(req.query.page) || 1;
            const perPage = parseInt(req.query.per_page) || 20;
            sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(perPage, (page - 1) * perPage);

            const countRes = await query(`SELECT COUNT(*) FROM discounts WHERE tenant_id = $1`, [tenantId]);
            const { rows } = await query(sql, params);

            res.json({
                success: true,
                data: rows,
                pagination: {
                    page,
                    perPage,
                    total: parseInt(countRes.rows[0].count),
                    totalPages: Math.ceil(parseInt(countRes.rows[0].count) / perPage)
                }
            });
        }));

        // ── POST / — create coupon ─────────────────────────────────────────
        router.post('/', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const {
                code, description, type, value,
                min_order_value, max_uses,
                applicable_to, applicable_ids,
                starts_at, expires_at, is_active
            } = req.body;

            if (!code || !type || value === undefined) {
                return res.status(400).json({ error: 'code, type, and value are required' });
            }
            if (!['percentage', 'fixed', 'free_shipping'].includes(type)) {
                return res.status(400).json({ error: 'type must be percentage, fixed, or free_shipping' });
            }

            const Role = require('../../platform/core/roles/models/Role');
            const roles = await Role.getUserRoles(tenantId, user.id);
            const userIsVendor = roles.some(r => r.name === 'Vendor' || r === 'Vendor');
            const userIsAdmin = roles.some(r => r.name === 'Admin' || r === 'Admin' || r.name === 'Super Admin');

            const coupon = await tenantInsert('discounts', tenantId, {
                code: code.toUpperCase(),
                description,
                type,
                value: parseFloat(value),
                min_order_value: parseFloat(min_order_value || 0),
                max_uses: max_uses || null,
                applicable_to: applicable_to || 'all',
                applicable_ids: applicable_ids || [],
                vendor_id: (userIsVendor && !userIsAdmin) ? user.id : null,
                starts_at: starts_at || new Date().toISOString(),
                expires_at: expires_at || null,
                is_active: is_active !== false,
                created_by: user.id,
            });

            res.status(201).json({ success: true, coupon });
        }));

        // ── PATCH /:id — update coupon ─────────────────────────────────────
        router.patch('/:id', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId } = req;
            const { code, ...rest } = req.body;
            const updates = { ...rest };
            if (code) updates.code = code.toUpperCase();
            if (updates.value !== undefined) updates.value = parseFloat(updates.value);

            const coupon = await tenantUpdate('discounts', tenantId, req.params.id, updates);
            if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
            res.json({ success: true, coupon });
        }));

        // ── DELETE /:id — deactivate coupon ───────────────────────────────
        router.delete('/:id', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            await query(
                `UPDATE discounts SET is_active = false, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
                [req.params.id, req.tenantId]
            );
            res.json({ success: true, message: 'Coupon deactivated' });
        }));

        // ── POST /validate — validate a coupon code ────────────────────────
        // Public endpoint — used by storefront checkout before applying
        router.post('/validate', optionalAuth, asyncHandler(async (req, res) => {
            const { code, order_total, product_ids } = req.body;
            if (!code) return res.status(400).json({ error: 'code is required' });

            const result = await validateCoupon(
                req.tenantId,
                code,
                parseFloat(order_total || 0),
                product_ids || []
            );

            if (!result.valid) {
                return res.status(422).json({ success: false, ...result });
            }

            res.json({
                success: true,
                valid: true,
                coupon: {
                    code: result.coupon.code,
                    type: result.coupon.type,
                    value: result.coupon.value,
                    description: result.coupon.description,
                },
                discount_amount: result.discount_amount,
            });
        }));

        // ── POST /apply — apply coupon (increment used_count) ─────────────
        // Called by checkout/payments after successful order
        router.post('/apply', optionalAuth, asyncHandler(async (req, res) => {
            const { code, order_total, product_ids } = req.body;
            if (!code) return res.status(400).json({ error: 'code is required' });

            const result = await validateCoupon(
                req.tenantId, code,
                parseFloat(order_total || 0),
                product_ids || []
            );

            if (!result.valid) {
                return res.status(422).json({ success: false, ...result });
            }

            await query(
                `UPDATE discounts SET used_count = used_count + 1, updated_at = NOW()
                 WHERE tenant_id = $1 AND UPPER(code) = UPPER($2)`,
                [req.tenantId, code]
            );

            eventBus.emitEvent('coupon.applied', {
                tenantId: req.tenantId,
                code,
                discount_amount: result.discount_amount,
            });

            res.json({ success: true, discount_amount: result.discount_amount, coupon: result.coupon });
        }));

        app.use('/discounts', router);
        console.log('[Discount] Module initialized');
        return true;

    } catch (error) {
        console.error('[Discount] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
