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
            deleted_at      TIMESTAMPTZ DEFAULT NULL
        );
    `);
    
    // Schema updates
    try {
        await query(`ALTER TABLE discounts ADD COLUMN IF NOT EXISTS max_uses_per_user INTEGER DEFAULT NULL;`);
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(64);`);
        await query(`ALTER TABLE discounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;`);
        
        // Update constraint to allow vendor-scoped coupons with same code and soft deletes
        await query(`ALTER TABLE discounts DROP CONSTRAINT IF EXISTS discounts_tenant_id_code_key CASCADE;`);
        await query(`ALTER TABLE discounts DROP CONSTRAINT IF EXISTS discounts_tenant_id_code_vendor_id_key CASCADE;`);
        await query(`DROP INDEX IF EXISTS idx_discounts_tenant_code_vendor;`);
        await query(`CREATE UNIQUE INDEX idx_discounts_tenant_code_vendor ON discounts (tenant_id, code, COALESCE(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE deleted_at IS NULL;`);
    } catch (e) {
        console.warn('[Discount] Migration alter warnings:', e.message);
    }

    await query(`CREATE INDEX IF NOT EXISTS idx_discounts_tenant_code ON discounts (tenant_id, code);`);
    console.log('[Discount] Migration complete');
}

// ── Validation helper ─────────────────────────────────────────────────────────
async function validateCoupon(tenantId, code, items = [], vendorId = null, userId = null) {
    let discountQuery = `SELECT * FROM discounts WHERE tenant_id = $1 AND UPPER(code) = UPPER($2) AND is_active = true AND deleted_at IS NULL`;
    let queryParams = [tenantId, code];

    // Debugging
    console.log('[DEBUG validateCoupon] Received code:', code, 'vendorId:', vendorId, 'tenantId:', tenantId);

    if (vendorId && vendorId !== 'null' && vendorId !== 'undefined') {
        // Order so that the correct vendor's coupon is picked first, then platform, then others
        discountQuery += ` ORDER BY CASE WHEN vendor_id = $3 THEN 0 WHEN vendor_id IS NULL THEN 1 ELSE 2 END ASC LIMIT 1`;
        queryParams.push(vendorId);
    } else {
        // If no vendorId passed (e.g. mixed cart), still try to find the coupon
        discountQuery += ` ORDER BY vendor_id NULLS FIRST LIMIT 1`;
    }

    const result = await query(discountQuery, queryParams);
    const coupon = result.rows[0];

    if (!coupon) {
        console.log('[DEBUG validateCoupon] Coupon not found for code:', code);
        return { valid: false, error: 'Coupon not found or inactive' };
    }
    
    // Explicitly reject if checkout is for Vendor A but coupon belongs to Vendor B
    if (vendorId && vendorId !== 'null' && vendorId !== 'undefined') {
        if (coupon.vendor_id && coupon.vendor_id !== vendorId) {
            console.log('[DEBUG validateCoupon] Vendor mismatch. Checkout vendor:', vendorId, 'Coupon vendor:', coupon.vendor_id);
            return { valid: false, error: 'This coupon belongs to a different vendor' };
        }
    }
    
    console.log('[DEBUG validateCoupon] Found coupon:', coupon.id, 'with vendor_id:', coupon.vendor_id);

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
    
    const productIds = items.map(i => i.product_id);
    
    // Scoping to vendor if it's a vendor coupon
    let scopedProductIds = productIds;
    if (coupon.vendor_id && productIds.length > 0) {
        const vpQuery = await query(`
            SELECT id FROM products WHERE id = ANY($1) AND created_by = $2
        `, [productIds, coupon.vendor_id]);
        scopedProductIds = vpQuery.rows.map(r => r.id);
        
        if (scopedProductIds.length === 0) {
            return { valid: false, error: 'Coupon is specific to a vendor not in your cart' };
        }
    }

    let eligibleProductIds = [];
    let eligibleSubtotal = 0;

    if (coupon.applicable_to === 'products' && coupon.applicable_ids.length > 0) {
        eligibleProductIds = scopedProductIds.filter(id => coupon.applicable_ids.includes(id));
        if (eligibleProductIds.length === 0) {
            return { valid: false, error: 'Coupon not applicable to any items in your cart' };
        }
    } else if (coupon.applicable_to === 'categories' && coupon.applicable_ids.length > 0) {
        if (scopedProductIds.length > 0) {
            // Expand applicable categories to include all sub-categories using a recursive CTE
            const expandedIdsRes = await query(`
                WITH RECURSIVE cat_tree AS (
                    SELECT id FROM categories WHERE id = ANY($2) AND tenant_id = $1
                    UNION
                    SELECT c.id FROM categories c
                    INNER JOIN cat_tree ct ON c.parent_id = ct.id
                )
                SELECT id FROM cat_tree
            `, [tenantId, coupon.applicable_ids]);
            
            const expandedApplicableIds = expandedIdsRes.rows.map(r => r.id);

            // Check both products table (native category_id) and product_categories table
            const catQuery = await query(`
                SELECT id AS product_id, category_id 
                FROM products 
                WHERE id = ANY($1) AND tenant_id = $2 AND category_id IS NOT NULL
                UNION
                SELECT pc.product_id, pc.category_id 
                FROM product_categories pc 
                WHERE pc.product_id = ANY($1) AND pc.tenant_id = $2
            `, [scopedProductIds, tenantId]);
            
            for (const row of catQuery.rows) {
                if (expandedApplicableIds.includes(row.category_id)) {
                    if (!eligibleProductIds.includes(row.product_id)) {
                        eligibleProductIds.push(row.product_id);
                    }
                }
            }
            if (eligibleProductIds.length === 0) {
                return { valid: false, error: 'Coupon not applicable to any items in your cart' };
            }
        } else {
             return { valid: false, error: 'Coupon not applicable to an empty order' };
        }
    } else {
        eligibleProductIds = [...scopedProductIds];
    }

    items.forEach(item => {
        if (eligibleProductIds.includes(item.product_id)) {
            eligibleSubtotal += parseFloat(item.price) * parseInt(item.quantity);
        }
    });

    if (parseFloat(coupon.min_order_value) > 0 && eligibleSubtotal < parseFloat(coupon.min_order_value)) {
        return { valid: false, error: `Minimum eligible value of ${coupon.min_order_value} required` };
    }

    if (coupon.max_uses_per_user !== null && userId) {
        // Count previous usages by this user that are not cancelled
        const usageQuery = await query(`
            SELECT COUNT(*) FROM orders 
            WHERE tenant_id = $1 AND user_id = $2 AND UPPER(coupon_code) = UPPER($3)
            AND status != 'cancelled'
        `, [tenantId, userId, coupon.code]);
        if (parseInt(usageQuery.rows[0].count) >= coupon.max_uses_per_user) {
            return { valid: false, error: 'You have reached the maximum usage limit for this coupon' };
        }
    } else if (coupon.max_uses_per_user !== null && !userId) {
        return { valid: false, error: 'You must be logged in to use this coupon' };
    }

    // Calculate discount amount against eligible items only
    let discountAmount = 0;
    if (coupon.type === 'percentage') {
        discountAmount = (eligibleSubtotal * parseFloat(coupon.value)) / 100;
    } else if (coupon.type === 'fixed') {
        discountAmount = Math.min(parseFloat(coupon.value), eligibleSubtotal);
    } else if (coupon.type === 'free_shipping') {
        discountAmount = 0; // handled at checkout level
    }

    return { valid: true, coupon, discount_amount: discountAmount, eligible_product_ids: eligibleProductIds };
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

            let whereClause = `WHERE d.tenant_id = $1 AND d.deleted_at IS NULL`;
            const params = [tenantId];

            if (userIsVendor && !userIsAdmin) {
                params.push(user.id);
                whereClause += ` AND d.vendor_id = $${params.length}`;
            }

            if (req.query.active !== undefined) {
                params.push(req.query.active === 'true');
                whereClause += ` AND d.is_active = $${params.length}`;
            }

            const countRes = await query(`SELECT COUNT(*) FROM discounts d ${whereClause}`, params);
            
            let sql = `
                SELECT d.*, u.business_name as vendor_name 
                FROM discounts d
                LEFT JOIN users u ON d.vendor_id = u.id
                ${whereClause}
                ORDER BY d.created_at DESC
            `;

            const page = parseInt(req.query.page) || 1;
            const perPage = parseInt(req.query.per_page) || 20;
            sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(perPage, (page - 1) * perPage);

            const { rows } = await query(sql, params);

            // Fetch category names for specific categories
            const categoryIdsToFetch = new Set();
            for (const row of rows) {
                if (row.applicable_to === 'categories' && row.applicable_ids?.length > 0) {
                    row.applicable_ids.forEach(id => categoryIdsToFetch.add(id));
                }
            }

            let categoryMap = {};
            if (categoryIdsToFetch.size > 0) {
                const catRes = await query(
                    `SELECT id, name FROM categories WHERE id = ANY($1) AND tenant_id = $2`,
                    [Array.from(categoryIdsToFetch), tenantId]
                );
                catRes.rows.forEach(c => {
                    categoryMap[c.id] = c.name;
                });
            }

            const enrichedRows = rows.map(row => {
                if (row.applicable_to === 'categories' && row.applicable_ids?.length > 0) {
                    row.applicable_names = row.applicable_ids.map(id => categoryMap[id] || id);
                }
                return row;
            });

            res.json({
                success: true,
                data: enrichedRows,
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
                min_order_value, max_uses, max_uses_per_user,
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
                max_uses_per_user: max_uses_per_user || null,
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

        // ── DELETE /:id — deactivate and soft delete coupon ───────────
        router.delete('/:id', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            await query(
                `UPDATE discounts SET is_active = false, deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
                [req.params.id, req.tenantId]
            );
            res.json({ success: true, message: 'Coupon deleted successfully' });
        }));

        // ── POST /validate — validate a coupon code ────────────────────────
        // Public endpoint — used by storefront checkout before applying
        router.post('/validate', optionalAuth, asyncHandler(async (req, res) => {
            const { code, items, vendor_id } = req.body;
            if (!code) return res.status(400).json({ error: 'code is required' });

            const result = await validateCoupon(
                req.tenantId,
                code,
                items || [],
                vendor_id || null,
                req.user?.id || null
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
                    applicable_to: result.coupon.applicable_to
                },
                discount_amount: result.discount_amount,
                eligible_product_ids: result.eligible_product_ids
            });
        }));

        // Remove POST /apply and replace with event listeners
        
        eventBus.registerListener('order.payment_status_changed', async (event) => {
            const { tenantId, orderId, newStatus, newPaymentStatus } = event.data;
            if (newPaymentStatus === 'paid' || newPaymentStatus === 'fulfilled') {
                const orderResult = await query(
                    `SELECT coupon_code, vendor_id FROM orders WHERE id = $1 AND tenant_id = $2`,
                    [orderId, tenantId]
                );
                const order = orderResult.rows[0];
                if (order && order.coupon_code) {
                    let updateQuery = `UPDATE discounts SET used_count = used_count + 1, updated_at = NOW() WHERE tenant_id = $1 AND UPPER(code) = UPPER($2)`;
                    let queryParams = [tenantId, order.coupon_code];
                    
                    if (order.vendor_id) {
                        updateQuery += ` AND (vendor_id = $3 OR vendor_id IS NULL)`;
                        queryParams.push(order.vendor_id);
                    } else {
                        updateQuery += ` AND vendor_id IS NULL`;
                    }
                    
                    await query(updateQuery, queryParams);
                    console.log(`[Discount] Incremented usage for coupon ${order.coupon_code} via payment_status_changed`);
                }
            }
        });



        app.use('/discounts', router);
        console.log('[Discount] Module initialized');
        return true;

    } catch (error) {
        console.error('[Discount] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
