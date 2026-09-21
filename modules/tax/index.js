/**
 * Tax Module
 *
 * Manages tax rates at both tenant-wide and vendor level.
 * Mirrors the same scoping pattern as discounts/coupons.
 *
 * Routes:
 *   GET    /tax           — list active tax rates (vendor-scoped)
 *   POST   /tax           — create a tax rate
 *   PATCH  /tax/:id       — update a tax rate
 *   DELETE /tax/:id       — deactivate a tax rate
 *   POST   /tax/compute   — compute tax for a cart/order (used by checkout + POS)
 */

const express = require('express');
const { query } = require('../../config/database');
const { tenantInsert, tenantUpdate } = require('../../utils/dbHelpers');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const authorize = require('../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../middleware/errorHandler');

// ── Migration ──────────────────────────────────────────────────────────────────
async function runMigration() {
    await query(`
        CREATE TABLE IF NOT EXISTS tax_rates (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL,
            vendor_id       UUID DEFAULT NULL,
            name            VARCHAR(128) NOT NULL,
            rate            NUMERIC(5,2) NOT NULL,
            applies_to      VARCHAR(32) DEFAULT 'all',
            applicable_ids  UUID[] DEFAULT '{}',
            is_compound     BOOLEAN DEFAULT false,
            is_active       BOOLEAN DEFAULT true,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_tax_rates_tenant_vendor ON tax_rates (tenant_id, vendor_id);`);
    console.log('[Tax] Migration complete');
}

// ── Tax computation helper ─────────────────────────────────────────────────────
// Exported so checkout and POS modules can call it directly
async function computeTax(tenantId, vendorId, items) {
    // Fetch applicable tax rates: vendor-specific first, then tenant-wide
    const ratesRes = await query(`
        SELECT * FROM tax_rates
        WHERE tenant_id = $1
          AND is_active = true
          AND (vendor_id = $2 OR vendor_id IS NULL)
        ORDER BY vendor_id NULLS LAST
    `, [tenantId, vendorId || null]);

    const rates = ratesRes.rows;
    if (rates.length === 0) {
        return { tax_amount: 0, tax_breakdown: [] };
    }

    const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.quantity)), 0);

    let runningBase = subtotal;
    const breakdown = [];

    for (const rate of rates) {
        const base = rate.is_compound ? (runningBase + breakdown.reduce((s, b) => s + b.amount, 0)) : subtotal;
        const amount = parseFloat(((base * parseFloat(rate.rate)) / 100).toFixed(2));
        breakdown.push({
            id: rate.id,
            name: rate.name,
            rate: parseFloat(rate.rate),
            amount,
        });
        runningBase = base;
    }

    const tax_amount = parseFloat(breakdown.reduce((s, b) => s + b.amount, 0).toFixed(2));
    return { tax_amount, tax_breakdown: breakdown };
}

async function bootstrap(context) {
    const { app } = context;

    try {
        await runMigration();

        const router = express.Router();

        // Helper: vendor role check
        async function getVendorContext(tenantId, userId) {
            const Role = require('../../platform/core/roles/models/Role');
            const roles = await Role.getUserRoles(tenantId, userId);
            const isVendor = roles.some(r => r.name === 'Vendor' || r === 'Vendor');
            const isAdmin = roles.some(r => r.name === 'Admin' || r === 'Admin' || r.name === 'Super Admin');
            return { isVendor, isAdmin };
        }

        // ── GET / — list tax rates ─────────────────────────────────────────────
        router.get('/', authenticate, authorize('settings.view'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            let sql = `SELECT t.*, u.business_name as vendor_name
                       FROM tax_rates t
                       LEFT JOIN users u ON t.vendor_id = u.id
                       WHERE t.tenant_id = $1`;
            const params = [tenantId];

            if (isVendor && !isAdmin) {
                // Vendors see their own rates + tenant-wide rates (null vendor_id)
                params.push(user.id);
                sql += ` AND (t.vendor_id = $${params.length} OR t.vendor_id IS NULL)`;
            }

            if (req.query.active !== undefined) {
                params.push(req.query.active === 'true');
                sql += ` AND t.is_active = $${params.length}`;
            }

            sql += ` ORDER BY t.vendor_id NULLS FIRST, t.created_at DESC`;
            const { rows } = await query(sql, params);
            res.json({ success: true, data: rows });
        }));

        // ── POST / — create tax rate ───────────────────────────────────────────
        router.post('/', authenticate, authorize('settings.view'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { name, rate, applies_to, applicable_ids, is_compound } = req.body;

            if (!name || rate === undefined) {
                return res.status(400).json({ error: 'name and rate are required' });
            }
            if (parseFloat(rate) < 0 || parseFloat(rate) > 100) {
                return res.status(400).json({ error: 'rate must be between 0 and 100' });
            }

            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);
            const vendorId = (isVendor && !isAdmin) ? user.id : (req.body.vendor_id || null);

            const taxRate = await tenantInsert('tax_rates', tenantId, {
                vendor_id: vendorId,
                name,
                rate: parseFloat(rate),
                applies_to: applies_to || 'all',
                applicable_ids: applicable_ids || [],
                is_compound: is_compound || false,
                is_active: true,
            });

            res.status(201).json({ success: true, tax_rate: taxRate });
        }));

        // ── PATCH /:id — update tax rate ──────────────────────────────────────
        router.patch('/:id', authenticate, authorize('settings.view'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const existingRes = await query(
                `SELECT * FROM tax_rates WHERE id = $1 AND tenant_id = $2`,
                [req.params.id, tenantId]
            );
            if (!existingRes.rows[0]) return res.status(404).json({ error: 'Tax rate not found' });

            // Vendors can only edit their own rates
            if (isVendor && !isAdmin && existingRes.rows[0].vendor_id !== user.id) {
                return res.status(403).json({ error: 'Forbidden', message: 'You do not own this tax rate' });
            }

            const updates = {};
            if (req.body.name !== undefined) updates.name = req.body.name;
            if (req.body.rate !== undefined) updates.rate = parseFloat(req.body.rate);
            if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;
            if (req.body.is_compound !== undefined) updates.is_compound = req.body.is_compound;
            if (req.body.applies_to !== undefined) updates.applies_to = req.body.applies_to;
            if (req.body.applicable_ids !== undefined) updates.applicable_ids = req.body.applicable_ids;

            const updated = await tenantUpdate('tax_rates', tenantId, req.params.id, updates);
            res.json({ success: true, tax_rate: updated });
        }));

        // ── DELETE /:id — deactivate tax rate ─────────────────────────────────
        router.delete('/:id', authenticate, authorize('settings.view'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const existingRes = await query(
                `SELECT * FROM tax_rates WHERE id = $1 AND tenant_id = $2`,
                [req.params.id, tenantId]
            );
            if (!existingRes.rows[0]) return res.status(404).json({ error: 'Tax rate not found' });

            if (isVendor && !isAdmin && existingRes.rows[0].vendor_id !== user.id) {
                return res.status(403).json({ error: 'Forbidden', message: 'You do not own this tax rate' });
            }

            await query(
                `UPDATE tax_rates SET is_active = false, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
                [req.params.id, tenantId]
            );
            res.json({ success: true, message: 'Tax rate deactivated' });
        }));

        // ── POST /compute — compute tax for items ──────────────────────────────
        // Used by checkout and POS. Public-ish but requires tenant context.
        router.post('/compute', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId } = req;
            const { vendor_id, items } = req.body;

            if (!items || !Array.isArray(items)) {
                return res.status(400).json({ error: 'items array is required' });
            }

            const result = await computeTax(tenantId, vendor_id || null, items);
            res.json({ success: true, ...result });
        }));

        app.use('/tax', router);
        console.log('[Tax] Module initialized');
        return true;

    } catch (error) {
        console.error('[Tax] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap, computeTax };
