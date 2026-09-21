/**
 * Point of Sale (POS) Module
 *
 * Handles physical retail sales through registers, shifts, and fast checkout.
 * All POS sales are vendor-scoped. Stock deduction is delegated to the
 * Inventory module via event bus.
 *
 * Routes:
 *   GET    /pos/products                  — fast product grid for cashier terminal
 *   POST   /pos/checkout                  — instant POS sale
 *   GET    /pos/receipt/:orderId          — receipt payload
 *
 *   GET    /pos/registers                 — list registers
 *   POST   /pos/registers                 — create register
 *   PATCH  /pos/registers/:id            — update register
 *   DELETE /pos/registers/:id            — deactivate register
 *
 *   POST   /pos/sessions/open            — open cashier shift
 *   POST   /pos/sessions/close           — close shift with reconciliation
 *   GET    /pos/sessions/current         — current open session for register
 *   GET    /pos/sessions/:id/summary     — end-of-shift report
 *
 *   GET    /pos/local-customers          — list vendor's local customers
 *   POST   /pos/local-customers          — create local customer
 *   PATCH  /pos/local-customers/:id      — update local customer
 */

const express = require('express');
const { query } = require('../../config/database');
const { tenantInsert, tenantUpdate } = require('../../utils/dbHelpers');
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const authorize = require('../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../middleware/errorHandler');

// ── Migration ──────────────────────────────────────────────────────────────────
async function runMigration() {
    await query(`
        CREATE TABLE IF NOT EXISTS pos_registers (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL,
            vendor_id   UUID DEFAULT NULL,
            name        VARCHAR(128) NOT NULL,
            location    VARCHAR(256) DEFAULT NULL,
            is_active   BOOLEAN DEFAULT true,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_pos_registers_tenant_vendor ON pos_registers (tenant_id, vendor_id);`);

    await query(`
        CREATE TABLE IF NOT EXISTS pos_sessions (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL,
            register_id     UUID NOT NULL REFERENCES pos_registers(id),
            cashier_id      UUID NOT NULL,
            opening_cash    NUMERIC(12,2) DEFAULT 0,
            closing_cash    NUMERIC(12,2) DEFAULT NULL,
            expected_cash   NUMERIC(12,2) DEFAULT NULL,
            cash_sales      NUMERIC(12,2) DEFAULT 0,
            card_sales      NUMERIC(12,2) DEFAULT 0,
            transfer_sales  NUMERIC(12,2) DEFAULT 0,
            total_sales     NUMERIC(12,2) DEFAULT 0,
            total_orders    INTEGER DEFAULT 0,
            status          VARCHAR(16) DEFAULT 'open',
            opened_at       TIMESTAMPTZ DEFAULT NOW(),
            closed_at       TIMESTAMPTZ DEFAULT NULL,
            notes           TEXT DEFAULT NULL
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_pos_sessions_tenant_register ON pos_sessions (tenant_id, register_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pos_sessions_cashier ON pos_sessions (tenant_id, cashier_id, status);`);

    await query(`
        CREATE TABLE IF NOT EXISTS pos_local_customers (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID NOT NULL,
            vendor_id    UUID NOT NULL,
            name         VARCHAR(256) NOT NULL,
            phone        VARCHAR(32) DEFAULT NULL,
            email        VARCHAR(256) DEFAULT NULL,
            notes        TEXT DEFAULT NULL,
            total_spend  NUMERIC(12,2) DEFAULT 0,
            visit_count  INTEGER DEFAULT 0,
            created_at   TIMESTAMPTZ DEFAULT NOW(),
            updated_at   TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_pos_local_customers_vendor ON pos_local_customers (tenant_id, vendor_id);`);

    // Orders table POS columns
    try {
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel VARCHAR(32) DEFAULT 'storefront';`);
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_type VARCHAR(32) DEFAULT 'customer';`);
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pos_session_id UUID DEFAULT NULL;`);
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pos_register_id UUID DEFAULT NULL;`);
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_tendered NUMERIC(12,2) DEFAULT NULL;`);
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS change_due NUMERIC(12,2) DEFAULT NULL;`);
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) DEFAULT 0;`);
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_breakdown JSONB DEFAULT NULL;`);
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS local_customer_id UUID DEFAULT NULL;`);
    } catch (e) {
        console.warn('[POS] Orders column migration warnings:', e.message);
    }

    console.log('[POS] Migration complete');
}

// ── Role helper ────────────────────────────────────────────────────────────────
async function getVendorContext(tenantId, userId) {
    const Role = require('../../platform/core/roles/models/Role');
    const roles = await Role.getUserRoles(tenantId, userId);
    const isVendor = roles.some(r => r.name === 'Vendor' || r === 'Vendor');
    const isAdmin = roles.some(r =>
        r.name === 'Admin' || r === 'Admin' ||
        r.name === 'Super Admin' || r === 'Super Admin' ||
        r.name === 'Store Manager' || r === 'Store Manager' ||
        r.name === 'Owner' || r === 'Owner'
    );
    const isCashier = roles.some(r => r.name === 'Cashier' || r === 'Cashier');
    return { isVendor, isAdmin, isCashier };
}

/**
 * For cashier users, resolve the vendor_id they are linked to.
 * For vendor users, returns their own user.id.
 * For admins, returns null (unrestricted).
 */
async function getEffectiveVendorId(tenantId, userId) {
    const { isVendor, isAdmin, isCashier } = await getVendorContext(tenantId, userId);
    if (isAdmin) return null;
    if (isVendor) return userId;
    if (isCashier) {
        const linkRes = await query(
            `SELECT vendor_id FROM vendor_cashiers WHERE tenant_id = $1 AND cashier_user_id = $2 AND status = 'active' LIMIT 1`,
            [tenantId, userId]
        );
        return linkRes.rows[0]?.vendor_id || null;
    }
    return null;
}

// ── Operating hours check ──────────────────────────────────────────────────────
function isWithinOperatingHours(opHours) {
    if (!opHours || !opHours.enabled) return true; // no restriction
    const now = new Date();
    const day = now.getDay(); // 0=Sun ... 6=Sat
    if (opHours.days && !opHours.days.includes(day)) return false;
    if (opHours.open && opHours.close) {
        const [oh, om] = opHours.open.split(':').map(Number);
        const [ch, cm] = opHours.close.split(':').map(Number);
        const nowMins = now.getHours() * 60 + now.getMinutes();
        const openMins = oh * 60 + om;
        const closeMins = ch * 60 + cm;
        if (nowMins < openMins || nowMins >= closeMins) return false;
    }
    return true;
}

// ── Order number generator ─────────────────────────────────────────────────────
async function generateOrderNumber(tenantId) {
    const count = await query(`SELECT COUNT(*) FROM orders WHERE tenant_id = $1`, [tenantId]);
    const seq = parseInt(count.rows[0].count) + 1;
    return `POS-${String(seq).padStart(5, '0')}-${Date.now().toString(36).toUpperCase()}`;
}

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        await runMigration();
        const router = express.Router();

        // ══════════════════════════════════════════════════════════════════════
        // REGISTERS
        // ══════════════════════════════════════════════════════════════════════

        // GET /pos/registers
        router.get('/registers', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin, isCashier } = await getVendorContext(tenantId, user.id);

            const params = [tenantId];
            let where = `WHERE tenant_id = $1`;

            if (isAdmin) {
                // Admins see all registers (optionally filter by vendor_id)
                if (req.query.vendor_id) {
                    params.push(req.query.vendor_id);
                    where += ` AND vendor_id = $${params.length}`;
                }
            } else if (isVendor) {
                // STRICT VENDOR SCOPING: Vendors only see registers they own
                params.push(user.id);
                where += ` AND vendor_id = $${params.length}`;
            } else if (isCashier) {
                // STRICT CASHIER SCOPING: Cashiers only see registers belonging to their linked vendor
                const vendorId = await getEffectiveVendorId(tenantId, user.id);
                if (!vendorId) return res.status(403).json({ error: 'No active cashier link found. Please ask your vendor to link you.' });
                params.push(vendorId);
                where += ` AND vendor_id = $${params.length}`;
            } else {
                params.push(user.id);
                where += ` AND vendor_id = $${params.length}`;
            }

            if (req.query.active !== 'false') {
                where += ` AND is_active = true`;
            }

            const { rows } = await query(`SELECT * FROM pos_registers ${where} ORDER BY name`, params);
            res.json({ success: true, data: rows });
        }));

        // POST /pos/registers
        router.post('/registers', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { name, location, operating_hours } = req.body;

            if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);
            const vendorId = (isVendor && !isAdmin) ? user.id : (req.body.vendor_id || user.id);

            const register = await tenantInsert('pos_registers', tenantId, {
                vendor_id: vendorId,
                name: name.trim(),
                location: location ? location.trim() : null,
                operating_hours: operating_hours ? JSON.stringify(operating_hours) : null,
                is_active: true,
            });

            res.status(201).json({ success: true, register });
        }));

        // PATCH /pos/registers/:id
        router.patch('/registers/:id', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const existingRes = await query(`SELECT * FROM pos_registers WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
            if (!existingRes.rows[0]) return res.status(404).json({ error: 'Register not found' });
            if (isVendor && !isAdmin && existingRes.rows[0].vendor_id !== user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const updates = {};
            if (req.body.name !== undefined) updates.name = req.body.name.trim();
            if (req.body.location !== undefined) updates.location = req.body.location ? req.body.location.trim() : null;
            if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;

            const updated = await tenantUpdate('pos_registers', tenantId, req.params.id, updates);
            res.json({ success: true, register: updated });
        }));

        // DELETE /pos/registers/:id (Deactivate register)
        router.delete('/registers/:id', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const existingRes = await query(`SELECT * FROM pos_registers WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
            if (!existingRes.rows[0]) return res.status(404).json({ error: 'Register not found' });
            if (isVendor && !isAdmin && existingRes.rows[0].vendor_id !== user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            // Check if there is an open shift on this register
            const openSess = await query(`SELECT id FROM pos_sessions WHERE register_id = $1 AND tenant_id = $2 AND status = 'open' LIMIT 1`, [req.params.id, tenantId]);
            if (openSess.rows[0]) {
                return res.status(400).json({ error: 'Cannot remove register while an active shift is open. Please close the shift first.' });
            }

            await query(`UPDATE pos_registers SET is_active = false WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
            res.json({ success: true, message: 'Register deactivated successfully.' });
        }));

        // ══════════════════════════════════════════════════════════════════════
        // SESSIONS (CASHIER SHIFTS)
        // ══════════════════════════════════════════════════════════════════════

        // POST /pos/sessions/open
        router.post('/sessions/open', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { register_id, opening_cash } = req.body;

            if (!register_id) return res.status(400).json({ error: 'register_id is required' });

            // Check register exists and belongs to this tenant
            const regRes = await query(`SELECT * FROM pos_registers WHERE id = $1 AND tenant_id = $2 AND is_active = true`, [register_id, tenantId]);
            if (!regRes.rows[0]) return res.status(404).json({ error: 'Register not found or inactive' });
            const register = regRes.rows[0];

            // ── Vendor-Cashier Authorization ────────────────────────────────
            const { isVendor, isAdmin, isCashier } = await getVendorContext(tenantId, user.id);

            if (isAdmin) {
                // Admins can open any register — no restriction
            } else if (isVendor) {
                // Strict Vendor check: Vendor must own this register
                if (register.vendor_id !== user.id) {
                    return res.status(403).json({ error: 'You can only open shifts on your own registers.' });
                }
            } else if (isCashier) {
                // Strict Cashier check: Cashier must have an active link to this register's vendor
                const linkRes = await query(`
                    SELECT id, vendor_id, last_shift_at FROM vendor_cashiers
                    WHERE tenant_id = $1 AND cashier_user_id = $2 AND vendor_id = $3 AND status = 'active'
                    LIMIT 1
                `, [tenantId, user.id, register.vendor_id]);

                if (!linkRes.rows[0]) {
                    return res.status(403).json({
                        error: 'CashierNotLinked',
                        message: 'You are not linked as a cashier for this register\'s vendor.'
                    });
                }

                const link = linkRes.rows[0];

                // 7-day inactivity auto-expiry check
                if (link.last_shift_at) {
                    const daysSince = (Date.now() - new Date(link.last_shift_at).getTime()) / (1000 * 60 * 60 * 24);
                    if (daysSince > 7) {
                        // Expire the link
                        await query(
                            `UPDATE vendor_cashiers SET status = 'expired', updated_at = NOW() WHERE id = $1`,
                            [link.id]
                        );
                        // Notify the cashier
                        try {
                            const vendorRes = await query(`SELECT business_name, first_name FROM users WHERE id = $1`, [register.vendor_id]);
                            const vName = vendorRes.rows[0]?.business_name || vendorRes.rows[0]?.first_name || 'Your vendor';
                            eventBus.emitEvent('pos.cashier.disconnected', {
                                tenantId, cashierUserId: user.id, vendorName: vName, reason: 'expired'
                            });
                        } catch (_) {}
                        return res.status(403).json({
                            error: 'CashierLinkExpired',
                            message: 'Your cashier link has expired due to 7 days of inactivity. Please ask the vendor to re-link you.'
                        });
                    }
                }

                // Update last_shift_at
                await query(
                    `UPDATE vendor_cashiers SET last_shift_at = NOW(), updated_at = NOW() WHERE id = $1`,
                    [link.id]
                );
            } else {
                return res.status(403).json({ error: 'You do not have permission to open a shift.' });
            }

            // ── Operating Hours Enforcement ─────────────────────────────────
            if (register.operating_hours) {
                if (!isWithinOperatingHours(register.operating_hours)) {
                    const oh = register.operating_hours;
                    return res.status(403).json({
                        error: 'OutsideOperatingHours',
                        message: `Register shifts cannot be opened outside approved operating hours (${oh.open || '00:00'}–${oh.close || '23:59'}).`
                    });
                }
            }

            // ── Check for existing open session ─────────────────────────────
            const openSession = await query(`
                SELECT id FROM pos_sessions WHERE register_id = $1 AND tenant_id = $2 AND status = 'open'
            `, [register_id, tenantId]);
            if (openSession.rows[0]) {
                return res.status(409).json({
                    error: 'SessionAlreadyOpen',
                    message: 'This register already has an open session',
                    session_id: openSession.rows[0].id
                });
            }

            const session = await tenantInsert('pos_sessions', tenantId, {
                register_id,
                cashier_id: user.id,
                opening_cash: parseFloat(opening_cash || 0),
                status: 'open',
            });

            res.status(201).json({ success: true, session });
        }));

        // GET /pos/sessions/current — active session for a register
        router.get('/sessions/current', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { register_id } = req.query;

            let where = `s.tenant_id = $1 AND s.status = 'open'`;
            const params = [tenantId];

            if (register_id) {
                params.push(register_id);
                where += ` AND s.register_id = $${params.length}`;
            } else {
                // Find session for current cashier
                params.push(user.id);
                where += ` AND s.cashier_id = $${params.length}`;
            }

            const { rows } = await query(`
                SELECT s.*, r.name as register_name, r.location,
                       u.first_name || ' ' || u.last_name as cashier_name
                FROM pos_sessions s
                JOIN pos_registers r ON s.register_id = r.id
                LEFT JOIN users u ON s.cashier_id = u.id
                WHERE ${where}
                LIMIT 1
            `, params);

            if (!rows[0]) return res.json({ success: true, session: null });

            // Attach live order count and totals
            const liveTotals = await query(`
                SELECT COUNT(*)::int as order_count,
                       COALESCE(SUM(total), 0) as total_sales
                FROM orders
                WHERE tenant_id = $1 AND pos_session_id = $2
            `, [tenantId, rows[0].id]);

            res.json({
                success: true,
                session: {
                    ...rows[0],
                    live_order_count: liveTotals.rows[0].order_count,
                    live_total_sales: liveTotals.rows[0].total_sales,
                    expected_cash: parseFloat(rows[0].opening_cash) + parseFloat(rows[0].cash_sales)
                }
            });
        }));

        // POST /pos/sessions/close
        router.post('/sessions/close', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { session_id, closing_cash, notes } = req.body;

            if (!session_id) return res.status(400).json({ error: 'session_id is required' });

            const sessRes = await query(`
                SELECT s.*, r.vendor_id, r.name as register_name,
                       u.first_name || ' ' || u.last_name as cashier_name
                FROM pos_sessions s
                JOIN pos_registers r ON s.register_id = r.id
                LEFT JOIN users u ON s.cashier_id = u.id
                WHERE s.id = $1 AND s.tenant_id = $2 AND s.status = 'open'
            `, [session_id, tenantId]);
            if (!sessRes.rows[0]) return res.status(404).json({ error: 'Open session not found' });

            const sess = sessRes.rows[0];

            // Compute totals from orders created in this session
            const totals = await query(`
                SELECT
                    COALESCE(SUM(total), 0) as total_sales,
                    COUNT(*)::int as total_orders,
                    COALESCE(SUM(CASE WHEN metadata->>'payment_method' = 'cash' THEN total ELSE 0 END), 0) as cash_sales,
                    COALESCE(SUM(CASE WHEN metadata->>'payment_method' = 'card' THEN total ELSE 0 END), 0) as card_sales,
                    COALESCE(SUM(CASE WHEN metadata->>'payment_method' = 'transfer' THEN total ELSE 0 END), 0) as transfer_sales
                FROM orders
                WHERE tenant_id = $1 AND pos_session_id = $2
            `, [tenantId, session_id]);

            const t = totals.rows[0];
            const expectedCash = parseFloat(sess.opening_cash) + parseFloat(t.cash_sales);
            const rawCash = req.body.closing_cash !== undefined ? req.body.closing_cash : req.body.actual_cash;
            const actualCash = parseFloat(rawCash || 0);
            const discrepancy = actualCash - expectedCash;

            const updated = await query(`
                UPDATE pos_sessions
                SET status = 'closed',
                    closed_at = NOW(),
                    closing_cash = $1,
                    expected_cash = $2,
                    cash_sales = $3,
                    card_sales = $4,
                    transfer_sales = $5,
                    total_sales = $6,
                    total_orders = $7,
                    notes = COALESCE($8, notes)
                WHERE id = $9 AND tenant_id = $10
                RETURNING *
            `, [
                actualCash,
                expectedCash,
                parseFloat(t.cash_sales),
                parseFloat(t.card_sales),
                parseFloat(t.transfer_sales),
                parseFloat(t.total_sales),
                t.total_orders,
                notes || null,
                session_id, tenantId
            ]);

            // Emit discrepancy notification to vendor if cash doesn't match
            if (discrepancy !== 0 && sess.vendor_id) {
                eventBus.emitEvent('pos.shift.discrepancy', {
                    tenantId,
                    vendorId: sess.vendor_id,
                    cashierName: sess.cashier_name,
                    sessionId: session_id,
                    registerId: sess.register_id,
                    registerName: sess.register_name,
                    expected: expectedCash,
                    actual: actualCash,
                    discrepancy,
                });
            }

            res.json({
                success: true,
                session: updated.rows[0],
                discrepancy,
            });
        }));

        // GET /pos/sessions/:id/summary
        router.get('/sessions/:id/summary', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId } = req;

            const sessRes = await query(`
                SELECT s.*, r.name as register_name,
                       u.first_name || ' ' || u.last_name as cashier_name
                FROM pos_sessions s
                JOIN pos_registers r ON s.register_id = r.id
                LEFT JOIN users u ON s.cashier_id = u.id
                WHERE s.id = $1 AND s.tenant_id = $2
            `, [req.params.id, tenantId]);

            if (!sessRes.rows[0]) return res.status(404).json({ error: 'Session not found' });

            const orders = await query(`
                SELECT id, order_number, total, tax_amount, channel, customer_type,
                       metadata->>'payment_method' as payment_method,
                       created_at
                FROM orders
                WHERE tenant_id = $1 AND pos_session_id = $2
                ORDER BY created_at DESC
            `, [tenantId, req.params.id]);

            const session = sessRes.rows[0];

            // Always compute live totals from the actual orders —
            // pos_sessions columns stay 0 until the shift is closed.
            let liveCash = 0, liveCard = 0, liveTransfer = 0, liveTotal = 0;
            for (const o of orders.rows) {
                const t = parseFloat(o.total || 0);
                liveTotal += t;
                if (o.payment_method === 'cash')     liveCash     += t;
                else if (o.payment_method === 'card') liveCard    += t;
                else if (o.payment_method === 'transfer') liveTransfer += t;
                else liveTotal += 0; // already counted in liveTotal
            }

            // Augment the session object with live values so the frontend
            // always sees accurate numbers regardless of open/closed state.
            const enrichedSession = {
                ...session,
                cash_sales:     session.status === 'closed' ? parseFloat(session.cash_sales     || 0) : liveCash,
                card_sales:     session.status === 'closed' ? parseFloat(session.card_sales     || 0) : liveCard,
                transfer_sales: session.status === 'closed' ? parseFloat(session.transfer_sales || 0) : liveTransfer,
                total_sales:    session.status === 'closed' ? parseFloat(session.total_sales    || 0) : liveTotal,
                total_orders:   session.status === 'closed' ? session.total_orders              : orders.rows.length,
            };

            const expectedCash = parseFloat(enrichedSession.opening_cash) + enrichedSession.cash_sales;

            res.json({
                success: true,
                session: enrichedSession,
                orders: orders.rows,
                discrepancy: session.status === 'closed'
                    ? parseFloat(session.closing_cash || 0) - expectedCash
                    : null
            });
        }));

        // ══════════════════════════════════════════════════════════════════════
        // PRODUCTS (Fast POS grid)
        // ══════════════════════════════════════════════════════════════════════

        // GET /pos/products
        router.get('/products', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin, isCashier } = await getVendorContext(tenantId, user.id);

            // Resolve the effective vendor for product scoping
            let effectiveVendorId = null;
            if (!isAdmin) {
                effectiveVendorId = await getEffectiveVendorId(tenantId, user.id);
                if (!effectiveVendorId) {
                    return res.status(403).json({ error: 'Cannot determine vendor context. Ensure your cashier link is active.' });
                }
            }

            const params = [tenantId];
            let where = `WHERE p.tenant_id = $1 AND p.is_pos_visible = true AND p.deleted_at IS NULL AND (p.is_variant = false OR p.is_variant IS NULL)
                         AND (p.track_inventory = true OR EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id AND v.track_inventory = true AND v.deleted_at IS NULL AND v.is_pos_visible = true))`;

            if (!isAdmin && effectiveVendorId) {
                params.push(effectiveVendorId);
                where += ` AND p.created_by = $${params.length}`;
            }

            if (req.query.search) {
                params.push(`%${req.query.search}%`);
                where += ` AND (p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR EXISTS (
                    SELECT 1 FROM products v WHERE v.parent_id = p.id AND v.deleted_at IS NULL
                    AND (v.name ILIKE $${params.length} OR v.sku ILIKE $${params.length} OR v.variant_label ILIKE $${params.length})
                ))`;
            }

            if (req.query.category_id) {
                params.push(req.query.category_id);
                where += ` AND (p.category_id = $${params.length} OR EXISTS (
                    SELECT 1 FROM product_categories pc
                    WHERE pc.product_id = p.id AND pc.category_id = $${params.length}
                ))`;
            }

            const { rows } = await query(`
                SELECT p.id, p.name, p.sku, p.price, p.image_url,
                       p.inventory_quantity, p.track_inventory, p.tax_class,
                       p.category_id,
                       CASE
                           WHEN p.inventory_quantity = 0 THEN 'out_of_stock'
                           WHEN p.inventory_quantity <= COALESCE(p.low_stock_threshold, 5) THEN 'low_stock'
                           ELSE 'in_stock'
                       END as stock_status
                FROM products p
                ${where}
                ORDER BY p.name ASC
                LIMIT 200
            `, params);

            // Fetch variants for returned parents
            const parentIds = rows.map(r => r.id);
            let variantsByParent = {};
            if (parentIds.length > 0) {
                const vRes = await query(`
                    SELECT v.id, v.parent_id, v.name, v.sku, v.price, v.image_url, v.variant_label,
                           v.inventory_quantity, v.track_inventory,
                           CASE
                               WHEN v.inventory_quantity = 0 THEN 'out_of_stock'
                               WHEN v.inventory_quantity <= COALESCE(v.low_stock_threshold, 5) THEN 'low_stock'
                               ELSE 'in_stock'
                           END as stock_status
                    FROM products v
                    JOIN products p ON v.parent_id = p.id
                    WHERE v.parent_id = ANY($1) AND v.tenant_id = $2 AND v.deleted_at IS NULL AND v.is_pos_visible = true
                      AND (v.track_inventory = true OR p.track_inventory = true)
                    ORDER BY v.price ASC, v.name ASC
                `, [parentIds, tenantId]);
                for (const v of vRes.rows) {
                    if (!variantsByParent[v.parent_id]) variantsByParent[v.parent_id] = [];
                    variantsByParent[v.parent_id].push(v);
                }
            }

            const enriched = rows.map(p => {
                const vars = variantsByParent[p.id] || [];
                if (vars.length > 0) {
                    const totalQty = vars.reduce((sum, v) => sum + (parseInt(v.inventory_quantity) || 0), 0);
                    const allOut = vars.every(v => v.stock_status === 'out_of_stock');
                    const anyLow = vars.some(v => v.stock_status === 'low_stock');
                    return {
                        ...p,
                        has_variants: true,
                        variants: vars,
                        inventory_quantity: totalQty,
                        stock_status: allOut ? 'out_of_stock' : anyLow ? 'low_stock' : 'in_stock',
                    };
                }
                return {
                    ...p,
                    has_variants: false,
                    variants: [],
                };
            });

            res.json({ success: true, data: enriched });
        }));

        // ══════════════════════════════════════════════════════════════════════
        // POS CHECKOUT
        // ══════════════════════════════════════════════════════════════════════

        // POST /pos/checkout
        router.post('/checkout', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const {
                session_id,
                items,               // [{ product_id, variant_id?, quantity, price? }]
                payment_method,      // 'cash' | 'card' | 'transfer' | 'split'
                split_payments,      // [{ method, amount }] when payment_method = 'split'
                cash_tendered,
                customer_id,         // store user id (optional)
                local_customer_id,   // pos local customer id (optional)
                customer_name,       // walk-in name (optional)
                notes,
                discount_amount,
                coupon_code,
            } = req.body;

            if (!session_id) return res.status(400).json({ error: 'session_id is required' });
            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'items array is required' });
            }

            // Validate session is open
            const sessRes = await query(
                `SELECT s.*, r.vendor_id FROM pos_sessions s JOIN pos_registers r ON s.register_id = r.id WHERE s.id = $1 AND s.tenant_id = $2 AND s.status = 'open'`,
                [session_id, tenantId]
            );
            if (!sessRes.rows[0]) return res.status(400).json({ error: 'No open session found. Please open a shift first.' });

            const session = sessRes.rows[0];
            const vendorId = session.vendor_id;

            // Enrich items and validate stock
            let subtotal = 0;
            const enrichedItems = [];
            const inventoryItems = [];

            for (const item of items) {
                if (!item.product_id || !item.quantity) {
                    return res.status(400).json({ error: 'Each item must have product_id and quantity' });
                }

                const productRes = await query(
                    `SELECT id, name, price, image_url, track_inventory, inventory_quantity, created_by
                     FROM products WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
                    [item.product_id, tenantId]
                );
                if (!productRes.rows[0]) {
                    return res.status(404).json({ error: `Product ${item.product_id} not found` });
                }
                const product = productRes.rows[0];

                // Stock check
                if (product.track_inventory && product.inventory_quantity < item.quantity) {
                    return res.status(422).json({
                        error: 'InsufficientStock',
                        message: `${product.name} only has ${product.inventory_quantity} units available`,
                        product_id: product.id
                    });
                }

                const unitPrice = parseFloat(item.price ?? product.price);
                const lineTotal = unitPrice * parseInt(item.quantity);
                subtotal += lineTotal;

                enrichedItems.push({
                    product_id: product.id,
                    variant_id: item.variant_id || null,
                    product_name: product.name,
                    quantity: parseInt(item.quantity),
                    price: unitPrice,
                    total: lineTotal,
                    image_url: product.image_url || null,
                    vendor_id: product.created_by,
                });

                if (product.track_inventory) {
                    inventoryItems.push({
                        product_id: product.id,
                        variant_id: item.variant_id || null,
                        quantity: parseInt(item.quantity),
                        track_inventory: true,
                    });
                }
            }

            // Tax computation
            let taxAmount = 0;
            let taxBreakdown = null;
            try {
                const { computeTax } = require('../tax/index');
                const taxResult = await computeTax(tenantId, vendorId, enrichedItems.map(i => ({
                    price: i.price,
                    quantity: i.quantity
                })));
                taxAmount = taxResult.tax_amount;
                taxBreakdown = taxResult.tax_breakdown;
            } catch (e) {
                console.warn('[POS] Tax computation skipped:', e.message);
            }

            const discountAmt = parseFloat(discount_amount || 0);
            const total = Math.max(0, subtotal - discountAmt + taxAmount);
            const change = payment_method === 'cash'
                ? Math.max(0, parseFloat(cash_tendered || 0) - total)
                : 0;

            const orderNumber = await generateOrderNumber(tenantId);

            // Determine customer type
            const customerType = (customer_id || local_customer_id) ? 'customer' : 'walk_in';

            // Create the order
            const order = await tenantInsert('orders', tenantId, {
                order_number: orderNumber,
                user_id: customer_id || null,
                vendor_id: vendorId,
                channel: 'pos',
                customer_type: customerType,
                local_customer_id: local_customer_id || null,
                pos_session_id: session_id,
                pos_register_id: session.register_id,
                status: 'processing',
                payment_status: 'paid',
                subtotal,
                discount_amount: discountAmt,
                coupon_code: coupon_code || null,
                tax_amount: taxAmount,
                tax_breakdown: taxBreakdown ? JSON.stringify(taxBreakdown) : null,
                total,
                cash_tendered: payment_method === 'cash' ? parseFloat(cash_tendered || 0) : null,
                change_due: change,
                paid_at: new Date(),
                notes: notes || null,
                metadata: {
                    source: 'pos',
                    payment_method,
                    split_payments: split_payments || null,
                    cashier_id: user.id,
                    customer_name: customer_name || null,
                    coupon_code: coupon_code || null,
                }
            });

            // Increment coupon usage if coupon_code was used
            if (coupon_code) {
                try {
                    await query(`
                        UPDATE discounts
                        SET used_count = used_count + 1, updated_at = NOW()
                        WHERE tenant_id = $1 AND UPPER(code) = UPPER($2)
                    `, [tenantId, coupon_code]);
                } catch (e) {
                    console.warn('[POS] Failed to increment discount usage:', e.message);
                }
            }

            // Insert order items
            for (const item of enrichedItems) {
                await tenantInsert('order_items', tenantId, {
                    order_id: order.id,
                    product_id: item.product_id,
                    variant_id: item.variant_id,
                    product_name: item.product_name,
                    quantity: item.quantity,
                    price: item.price,
                    total: item.total,
                    image_url: item.image_url,
                });
            }

            // Update local customer spend/visit if linked
            if (local_customer_id) {
                await query(`
                    UPDATE pos_local_customers
                    SET total_spend = total_spend + $1, visit_count = visit_count + 1, updated_at = NOW()
                    WHERE id = $2 AND tenant_id = $3
                `, [total, local_customer_id, tenantId]);
            }

            // Emit for inventory deduction
            eventBus.emitEvent('pos.sale.completed', {
                tenantId,
                orderId: order.id,
                orderNumber,
                items: inventoryItems,
                cashierId: user.id,
                sessionId: session_id,
            });

            // Emit general order events
            eventBus.emitEvent('order.created', {
                tenantId,
                orderId: order.id,
                orderNumber,
                vendorId,
                channel: 'pos',
                source: 'pos',
            });

            // Check for low stock and emit alerts
            for (const item of inventoryItems) {
                try {
                    const stockRes = await query(
                        `SELECT id, name, inventory_quantity, low_stock_threshold, created_by FROM products WHERE id = $1 AND tenant_id = $2`,
                        [item.product_id, tenantId]
                    );
                    const p = stockRes.rows[0];
                    if (p && p.inventory_quantity !== null) {
                        const threshold = p.low_stock_threshold || 5;
                        if (p.inventory_quantity <= threshold && p.inventory_quantity >= 0) {
                            eventBus.emitEvent('inventory.low_stock', {
                                tenantId,
                                vendorId: p.created_by || vendorId,
                                productId: p.id,
                                productName: p.name,
                                quantity: p.inventory_quantity,
                                threshold,
                            });
                        }
                    }
                } catch (_) { /* non-critical */ }
            }

            res.status(201).json({
                success: true,
                order: {
                    ...order,
                    items: enrichedItems,
                    tax_breakdown: taxBreakdown,
                    change_due: change,
                }
            });
        }));

        // GET /pos/receipt/:orderId
        router.get('/receipt/:orderId', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId } = req;

            const orderRes = await query(
                `SELECT o.*, u.business_name as vendor_name, u.phone as vendor_phone,
                        t.name as tenant_name, t.settings as tenant_settings
                 FROM orders o
                 LEFT JOIN users u ON o.vendor_id = u.id
                 LEFT JOIN tenants t ON o.tenant_id = t.id
                 WHERE o.id = $1 AND o.tenant_id = $2 AND o.channel = 'pos'`,
                [req.params.orderId, tenantId]
            );
            if (!orderRes.rows[0]) return res.status(404).json({ error: 'POS order not found' });

            const itemsRes = await query(
                `SELECT * FROM order_items WHERE order_id = $1 AND tenant_id = $2`,
                [req.params.orderId, tenantId]
            );

            const order = orderRes.rows[0];
            const settings = order.tenant_settings || {};

            res.json({
                success: true,
                receipt: {
                    order_number: order.order_number,
                    date: order.created_at,
                    cashier: order.metadata?.cashier_id,
                    store_name: order.vendor_name || order.tenant_name,
                    store_address: settings.address || null,
                    items: itemsRes.rows,
                    subtotal: order.subtotal,
                    discount: order.discount_amount,
                    coupon_code: order.coupon_code || order.metadata?.coupon_code || null,
                    tax_breakdown: order.tax_breakdown,
                    tax_amount: order.tax_amount,
                    total: order.total,
                    payment_method: order.metadata?.payment_method,
                    cash_tendered: order.cash_tendered,
                    change_due: order.change_due,
                    customer_type: order.customer_type,
                    notes: order.notes,
                }
            });
        }));

        // ══════════════════════════════════════════════════════════════════════
        // CUSTOMERS (STORE & LOCAL)
        // ══════════════════════════════════════════════════════════════════════

        // GET /pos/store-customers — lookup a store customer by exact email only
        router.get('/store-customers', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId } = req;
            const { search } = req.query;

            // Require an email to be provided — never list all users
            if (!search || !search.trim()) {
                return res.json({ success: true, data: [] });
            }

            const email = search.trim().toLowerCase();

            const { rows } = await query(`
                SELECT id, first_name, last_name, email
                FROM users
                WHERE tenant_id = $1
                  AND status != 'deleted'
                  AND LOWER(email) = $2
                LIMIT 1
            `, [tenantId, email]);

            res.json({ success: true, data: rows });
        }));

        // GET /pos/local-customers
        router.get('/local-customers', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin, isCashier } = await getVendorContext(tenantId, user.id);

            const params = [tenantId];
            let where = `WHERE tenant_id = $1`;

            if (isAdmin && req.query.vendor_id) {
                params.push(req.query.vendor_id);
                where += ` AND vendor_id = $${params.length}`;
            } else if (!isAdmin) {
                const vendorId = await getEffectiveVendorId(tenantId, user.id);
                if (vendorId) {
                    params.push(vendorId);
                    where += ` AND vendor_id = $${params.length}`;
                }
            }

            if (req.query.search) {
                params.push(`%${req.query.search}%`);
                where += ` AND (name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`;
            }

            const { rows } = await query(
                `SELECT * FROM pos_local_customers ${where} ORDER BY name ASC`,
                params
            );

            res.json({ success: true, data: rows });
        }));

        // POST /pos/local-customers
        router.post('/local-customers', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { name, phone, email, notes } = req.body;

            if (!name) return res.status(400).json({ error: 'name is required' });

            const { isAdmin } = await getVendorContext(tenantId, user.id);
            let vendorId;
            if (isAdmin) {
                vendorId = req.body.vendor_id || user.id;
            } else {
                vendorId = await getEffectiveVendorId(tenantId, user.id);
                if (!vendorId) return res.status(403).json({ error: 'Cannot determine vendor context.' });
            }

            const customer = await tenantInsert('pos_local_customers', tenantId, {
                vendor_id: vendorId,
                name,
                phone: phone || null,
                email: email || null,
                notes: notes || null,
            });

            res.status(201).json({ success: true, customer });
        }));

        // PATCH /pos/local-customers/:id
        router.patch('/local-customers/:id', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const existingRes = await query(
                `SELECT * FROM pos_local_customers WHERE id = $1 AND tenant_id = $2`,
                [req.params.id, tenantId]
            );
            if (!existingRes.rows[0]) return res.status(404).json({ error: 'Customer not found' });
            if (isVendor && !isAdmin && existingRes.rows[0].vendor_id !== user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const updates = {};
            if (req.body.name !== undefined) updates.name = req.body.name;
            if (req.body.phone !== undefined) updates.phone = req.body.phone;
            if (req.body.email !== undefined) updates.email = req.body.email;
            if (req.body.notes !== undefined) updates.notes = req.body.notes;

            const updated = await tenantUpdate('pos_local_customers', tenantId, req.params.id, updates);
            res.json({ success: true, customer: updated });
        }));

        // ══════════════════════════════════════════════════════════════════════
        // CASHIER MANAGEMENT (Vendor-only endpoints)
        // ══════════════════════════════════════════════════════════════════════

        // GET /pos/cashiers — list vendor's linked cashiers
        router.get('/cashiers', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isAdmin } = await getVendorContext(tenantId, user.id);

            const vendorId = isAdmin && req.query.vendor_id ? req.query.vendor_id : user.id;

            const { rows } = await query(`
                SELECT vc.*,
                       u.first_name, u.last_name, u.email,
                       u.first_name || ' ' || u.last_name as cashier_name
                FROM vendor_cashiers vc
                JOIN users u ON vc.cashier_user_id = u.id
                WHERE vc.tenant_id = $1 AND vc.vendor_id = $2
                ORDER BY vc.created_at DESC
            `, [tenantId, vendorId]);

            res.json({ success: true, data: rows });
        }));

        // POST /pos/cashiers — link a registered user as cashier
        router.post('/cashiers', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { email } = req.body;

            if (!email) return res.status(400).json({ error: 'email is required' });

            // Find the user by email
            const userRes = await query(
                `SELECT u.id, u.first_name, u.last_name, u.email FROM users u WHERE u.email = $1 AND u.tenant_id = $2 LIMIT 1`,
                [email.toLowerCase().trim(), tenantId]
            );
            if (!userRes.rows[0]) {
                return res.status(404).json({
                    error: 'UserNotFound',
                    message: 'No registered user found with that email address. The user must first create an account on the platform.'
                });
            }
            const targetUser = userRes.rows[0];

            // Block vendors from being assigned as cashiers
            const Role = require('../../platform/core/roles/models/Role');
            const targetRoles = await Role.getUserRoles(tenantId, targetUser.id);
            const targetIsVendor = targetRoles.some(r => r.name === 'Vendor' || r === 'Vendor');
            if (targetIsVendor) {
                return res.status(400).json({
                    error: 'VendorCannotBeCashier',
                    message: 'A user with the Vendor role cannot be assigned as a cashier.'
                });
            }

            // Cannot link yourself as your own cashier
            if (targetUser.id === user.id) {
                return res.status(400).json({ error: 'You cannot assign yourself as your own cashier.' });
            }

            // Expire any existing active link this cashier has to another vendor (7-day protection ensures fairness)
            const existingLink = await query(
                `SELECT vc.id, vc.vendor_id, u.business_name, u.first_name FROM vendor_cashiers vc JOIN users u ON vc.vendor_id = u.id WHERE vc.tenant_id = $1 AND vc.cashier_user_id = $2 AND vc.status = 'active'`,
                [tenantId, targetUser.id]
            );
            if (existingLink.rows[0]) {
                // Check if the 7-day period has elapsed
                const linkCheck = await query(
                    `SELECT id, last_shift_at FROM vendor_cashiers WHERE id = $1`,
                    [existingLink.rows[0].id]
                );
                const oldLink = linkCheck.rows[0];
                const daysSince = oldLink.last_shift_at
                    ? (Date.now() - new Date(oldLink.last_shift_at).getTime()) / (1000 * 60 * 60 * 24)
                    : Infinity;

                if (daysSince <= 7) {
                    const oldVendorName = existingLink.rows[0].business_name || existingLink.rows[0].first_name || 'Another vendor';
                    return res.status(409).json({
                        error: 'CashierAlreadyLinked',
                        message: `This user is currently an active cashier for "${oldVendorName}". They can only be re-linked after 7 days of inactivity.`
                    });
                }

                // Auto-expire the stale link
                await query(`UPDATE vendor_cashiers SET status = 'expired', updated_at = NOW() WHERE id = $1`, [oldLink.id]);
            }

            // Create the new link
            const newLink = await tenantInsert('vendor_cashiers', tenantId, {
                vendor_id: user.id,
                cashier_user_id: targetUser.id,
                status: 'active',
                last_shift_at: null,
            });

            // Assign Cashier role to this user if they don't have it
            try {
                const cashierRoleRes = await query(`SELECT id FROM roles WHERE name = 'Cashier' AND tenant_id = $1`, [tenantId]);
                if (cashierRoleRes.rows[0]) {
                    await query(
                        `INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                        [targetUser.id, cashierRoleRes.rows[0].id, tenantId]
                    );
                }
            } catch (e) { console.warn('[POS] Could not assign Cashier role:', e.message); }

            // Notify the cashier
            try {
                const vendorRes = await query(`SELECT business_name, first_name FROM users WHERE id = $1`, [user.id]);
                const vendorName = vendorRes.rows[0]?.business_name || vendorRes.rows[0]?.first_name || 'A vendor';
                eventBus.emitEvent('pos.cashier.assigned', {
                    tenantId,
                    cashierUserId: targetUser.id,
                    vendorId: user.id,
                    vendorName,
                });
            } catch (_) {}

            res.status(201).json({
                success: true,
                message: `${targetUser.first_name} ${targetUser.last_name} has been linked as a cashier.`,
                link: newLink,
            });
        }));

        // DELETE /pos/cashiers/:id — vendor manually revokes a cashier link
        router.delete('/cashiers/:id', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;

            const linkRes = await query(
                `SELECT vc.*, u.first_name, u.last_name FROM vendor_cashiers vc JOIN users u ON vc.cashier_user_id = u.id WHERE vc.id = $1 AND vc.tenant_id = $2`,
                [req.params.id, tenantId]
            );
            if (!linkRes.rows[0]) return res.status(404).json({ error: 'Cashier link not found' });

            const link = linkRes.rows[0];

            // Only the vendor who owns the link or an admin can revoke it
            const { isAdmin } = await getVendorContext(tenantId, user.id);
            if (!isAdmin && link.vendor_id !== user.id) {
                return res.status(403).json({ error: 'Forbidden: You can only revoke your own cashier links.' });
            }

            await query(
                `UPDATE vendor_cashiers SET status = 'revoked', updated_at = NOW() WHERE id = $1`,
                [req.params.id]
            );

            // Notify the cashier
            try {
                const vendorRes = await query(`SELECT business_name, first_name FROM users WHERE id = $1`, [link.vendor_id]);
                const vendorName = vendorRes.rows[0]?.business_name || vendorRes.rows[0]?.first_name || 'Your vendor';
                eventBus.emitEvent('pos.cashier.disconnected', {
                    tenantId,
                    cashierUserId: link.cashier_user_id,
                    vendorName,
                    reason: 'revoked',
                });
            } catch (_) {}

            res.json({ success: true, message: `${link.first_name} ${link.last_name} has been disconnected.` });
        }));

        // PATCH /pos/registers/:id/operating-hours — update operating hours schedule
        router.patch('/registers/:id/operating-hours', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { enabled, open, close, days } = req.body;

            const regRes = await query(`SELECT * FROM pos_registers WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
            if (!regRes.rows[0]) return res.status(404).json({ error: 'Register not found' });

            const { isAdmin } = await getVendorContext(tenantId, user.id);
            if (!isAdmin && regRes.rows[0].vendor_id && regRes.rows[0].vendor_id !== user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const newHours = enabled === false ? null : {
                enabled: true,
                open: open || '08:00',
                close: close || '22:00',
                days: Array.isArray(days) ? days : [1, 2, 3, 4, 5, 6],
            };

            const updated = await tenantUpdate('pos_registers', tenantId, req.params.id, { operating_hours: newHours ? JSON.stringify(newHours) : null });
            res.json({ success: true, register: updated });
        }));

        // ══════════════════════════════════════════════════════════════════════
        // COUPONS (POS-accessible)
        // ══════════════════════════════════════════════════════════════════════

        // GET /pos/coupons — list active coupons, accessible by cashiers and vendors
        router.get('/coupons', authenticate, authorize(['pos.access', 'products.manage']), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin, isCashier } = await getVendorContext(tenantId, user.id);

            const params = [tenantId];
            let whereExtra = '';

            if (isAdmin) {
                // Admins see all tenant coupons
            } else if (isVendor && !isAdmin) {
                // Vendors see only their own coupons
                params.push(user.id);
                whereExtra = ` AND (d.vendor_id = $${params.length} OR d.vendor_id IS NULL)`;
            } else if (isCashier) {
                // Cashiers see coupons for the vendor they are linked to
                const linkRes = await query(
                    `SELECT vendor_id FROM vendor_cashiers WHERE cashier_user_id = $1 AND tenant_id = $2 AND status = 'active' LIMIT 1`,
                    [user.id, tenantId]
                );
                const vendorId = linkRes.rows[0]?.vendor_id;
                if (vendorId) {
                    params.push(vendorId);
                    whereExtra = ` AND (d.vendor_id = $${params.length} OR d.vendor_id IS NULL)`;
                }
            }

            const { rows } = await query(`
                SELECT id, code, description, type, value, min_order_value,
                       max_uses, used_count, applicable_to, applicable_ids,
                       vendor_id, starts_at, expires_at, is_active
                FROM discounts d
                WHERE d.tenant_id = $1
                  AND d.is_active = true
                  AND d.deleted_at IS NULL
                  AND (d.starts_at IS NULL OR d.starts_at <= NOW())
                  AND (d.expires_at IS NULL OR d.expires_at >= NOW())
                  AND (d.max_uses IS NULL OR d.used_count < d.max_uses)
                  ${whereExtra}
                ORDER BY d.created_at DESC
                LIMIT 100
            `, params);

            res.json({ success: true, data: rows });
        }));

        app.use('/pos', router);
        console.log('[POS] Module initialized');
        return true;

    } catch (error) {
        console.error('[POS] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
