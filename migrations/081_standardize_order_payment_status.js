/**
 * Migration 081: Standardize Order & Payment Status Taxonomy
 *
 * Changes:
 * 1. Replaces orders.status CHECK with clean operational values only
 *    (removes payment-domain values: paid, refunded, completed, pending_payment,
 *     pending_whatsapp, payment_failed — these belong in payment_status)
 *
 * 2. Replaces orders.payment_status CHECK with full financial lifecycle values
 *    (adds: fulfilled — vendor-confirmed off-platform payment)
 *
 * 3. Adds orders.checkout_type  — 'platform' | 'whatsapp'
 * 4. Adds orders.confirmed_by   — vendor user_id who manually confirmed payment
 * 5. Adds orders.payment_confirmed_at — timestamp of manual confirmation
 * 6. Adds orders.shipped_at, delivered_at timestamps
 *
 * IMPORTANT — step order:
 *   1. Add columns
 *   2. DROP old constraint (so backfill UPDATEs aren't blocked)
 *   3. Backfill payment_status from legacy status values
 *   4. Normalise status values to new operational taxonomy
 *   5. ADD new constraints
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 081_standardize_order_payment_status.js');

    // ── Step 1: Add new columns (idempotent) ───────────────────────────────

    try {
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_type VARCHAR(20) DEFAULT 'platform'`);
        console.log('  ✓ orders.checkout_type column added');
    } catch (e) {
        console.log('  ~ orders.checkout_type already exists');
    }

    try {
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_by UUID`);
        console.log('  ✓ orders.confirmed_by column added');
    } catch (e) {
        console.log('  ~ orders.confirmed_by already exists');
    }

    try {
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMP`);
        console.log('  ✓ orders.payment_confirmed_at column added');
    } catch (e) {
        console.log('  ~ orders.payment_confirmed_at already exists');
    }

    try {
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP`);
        console.log('  ✓ orders.shipped_at column added');
    } catch (e) {
        console.log('  ~ orders.shipped_at already exists');
    }

    try {
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP`);
        console.log('  ✓ orders.delivered_at column added');
    } catch (e) {
        console.log('  ~ orders.delivered_at already exists');
    }

    // Ensure payment_status column exists
    try {
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) DEFAULT 'unpaid'`);
        console.log('  ✓ orders.payment_status ensured');
    } catch (e) {
        console.log('  ~ orders.payment_status already exists');
    }

    // ── Step 2: DROP old constraints BEFORE any UPDATE ─────────────────────
    // The old orders_status_check (migration 075) doesn't include 'delivered',
    // so we must remove it before we can backfill those values.
    await query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`);
    await query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check`);
    await query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_checkout_type_check`);
    console.log('  ✓ old constraints dropped — backfill can proceed safely');

    // ── Step 3: Backfill payment_status from legacy status values ──────────
    await query(`
        UPDATE orders
        SET payment_status = 'paid'
        WHERE status IN ('paid', 'completed')
          AND (payment_status IS NULL OR payment_status = 'pending')
    `);
    console.log('  ✓ backfilled payment_status=paid for paid/completed orders');

    await query(`
        UPDATE orders
        SET payment_status = 'processing'
        WHERE status = 'pending_payment'
          AND (payment_status IS NULL OR payment_status = 'pending')
    `);
    console.log('  ✓ backfilled payment_status=processing for pending_payment orders');

    await query(`
        UPDATE orders
        SET payment_status = 'failed'
        WHERE status = 'payment_failed'
          AND (payment_status IS NULL OR payment_status = 'pending')
    `);
    console.log('  ✓ backfilled payment_status=failed for payment_failed orders');

    await query(`
        UPDATE orders
        SET payment_status = 'refunded'
        WHERE status = 'refunded'
    `);
    console.log('  ✓ backfilled payment_status=refunded for refunded orders');

    // Normalise any leftover NULL/old-default payment_status rows
    await query(`
        UPDATE orders SET payment_status = 'unpaid'
        WHERE payment_status IS NULL OR payment_status = 'pending'
    `);
    console.log('  ✓ normalised NULL/pending payment_status to unpaid');

    // ── Step 4: Backfill checkout_type for WhatsApp orders ─────────────────
    await query(`
        UPDATE orders
        SET checkout_type = 'whatsapp'
        WHERE status = 'pending_whatsapp'
           OR (metadata->>'is_whatsapp')::boolean = true
    `);
    console.log('  ✓ backfilled checkout_type=whatsapp for WhatsApp orders');

    // ── Step 5: Normalise status values to new operational taxonomy ─────────
    await query(`UPDATE orders SET status = 'processing' WHERE status = 'paid'`);
    await query(`UPDATE orders SET status = 'delivered'  WHERE status = 'completed'`);
    await query(`
        UPDATE orders SET status = 'pending'
        WHERE status IN ('pending_payment', 'payment_failed', 'pending_whatsapp', 'refunded')
    `);
    console.log('  ✓ normalised legacy status values to new taxonomy');

    // ── Step 6: Apply new CHECK constraints ────────────────────────────────
    await query(`
        ALTER TABLE orders
        ADD CONSTRAINT orders_status_check
        CHECK (status = ANY (ARRAY[
            'pending',
            'processing',
            'shipped',
            'delivered',
            'returned',
            'cancelled'
        ]::text[]))
    `);
    console.log('  ✓ orders_status_check constraint applied (operational values only)');

    await query(`
        ALTER TABLE orders
        ADD CONSTRAINT orders_payment_status_check
        CHECK (payment_status = ANY (ARRAY[
            'unpaid',
            'processing',
            'paid',
            'failed',
            'fulfilled',
            'refunded'
        ]::text[]))
    `);
    console.log('  ✓ orders_payment_status_check constraint applied (+ fulfilled for manual confirm)');

    await query(`
        ALTER TABLE orders
        ADD CONSTRAINT orders_checkout_type_check
        CHECK (checkout_type = ANY (ARRAY['platform', 'whatsapp']::text[]))
    `);
    console.log('  ✓ orders_checkout_type_check constraint applied');

    // ── Step 7: Indexes ─────────────────────────────────────────────────────
    try {
        await query(`CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status)`);
        console.log('  ✓ idx_orders_payment_status index created');
    } catch (e) {
        console.log('  ~ idx_orders_payment_status already exists');
    }

    try {
        await query(`CREATE INDEX IF NOT EXISTS idx_orders_checkout_type ON orders(checkout_type)`);
        console.log('  ✓ idx_orders_checkout_type index created');
    } catch (e) {
        console.log('  ~ idx_orders_checkout_type already exists');
    }

    console.log('Migration complete: 081_standardize_order_payment_status.js');
}

async function down() {
    console.log('Rolling back: 081_standardize_order_payment_status.js');

    await query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`);
    await query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check`);
    await query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_checkout_type_check`);

    // Restore old status constraint
    await query(`
        ALTER TABLE orders
        ADD CONSTRAINT orders_status_check
        CHECK (status = ANY (ARRAY[
            'pending', 'pending_payment', 'paid', 'processing',
            'shipped', 'completed', 'cancelled', 'refunded',
            'pending_whatsapp', 'payment_failed'
        ]::text[]))
    `);

    await query(`ALTER TABLE orders DROP COLUMN IF EXISTS checkout_type`);
    await query(`ALTER TABLE orders DROP COLUMN IF EXISTS confirmed_by`);
    await query(`ALTER TABLE orders DROP COLUMN IF EXISTS payment_confirmed_at`);
    await query(`ALTER TABLE orders DROP COLUMN IF EXISTS shipped_at`);
    await query(`ALTER TABLE orders DROP COLUMN IF EXISTS delivered_at`);

    console.log('Rollback complete: 081_standardize_order_payment_status.js');
}

module.exports = { up, down };
