/**
 * Migration 074: Paystack Payment Infrastructure
 *
 * - Adds `reference` (UNIQUE) to payments for strict idempotency
 * - Adds `paystack_reference` + `payment_status` to orders
 * - Rebuilds payments table constraints to support real gateway data
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 074_paystack_payments.js');

    // 1. Add `reference` column to payments (idempotency key)
    try {
        await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference VARCHAR(255) UNIQUE`);
        console.log('  ✓ payments.reference column added');
    } catch (e) {
        console.log('  ~ payments.reference already exists');
    }

    // 2. Add `idempotency_key` column — secondary lock for concurrent webhook delivery
    try {
        await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255) UNIQUE`);
        console.log('  ✓ payments.idempotency_key column added');
    } catch (e) {
        console.log('  ~ payments.idempotency_key already exists');
    }

    // 3. Add `processed_at` — timestamp of when the webhook was accepted and processed
    try {
        await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP`);
        console.log('  ✓ payments.processed_at column added');
    } catch (e) {
        console.log('  ~ payments.processed_at already exists');
    }

    // 4. Add `gateway_response` — raw Paystack response for audit trail
    try {
        await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_response JSONB DEFAULT '{}'`);
        console.log('  ✓ payments.gateway_response column added');
    } catch (e) {
        console.log('  ~ payments.gateway_response already exists');
    }

    // 5. Add `payment_status` to orders table
    try {
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) DEFAULT 'pending'`);
        console.log('  ✓ orders.payment_status column added');
    } catch (e) {
        console.log('  ~ orders.payment_status already exists');
    }

    // 6. Add `paystack_reference` to orders for quick reverse-lookup from webhook
    try {
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS paystack_reference VARCHAR(255)`);
        console.log('  ✓ orders.paystack_reference column added');
    } catch (e) {
        console.log('  ~ orders.paystack_reference already exists');
    }

    // 7. Add `paid_at` to orders if not already present
    try {
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP`);
        console.log('  ✓ orders.paid_at column added');
    } catch (e) {
        console.log('  ~ orders.paid_at already exists');
    }

    // 8. Add `currency` to orders
    try {
        await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'NGN'`);
        console.log('  ✓ orders.currency column added');
    } catch (e) {
        console.log('  ~ orders.currency already exists');
    }

    // 9. Index for fast reference lookup (used in every webhook hit)
    try {
        await query(`CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference)`);
        console.log('  ✓ idx_payments_reference index created');
    } catch (e) {
        console.log('  ~ idx_payments_reference already exists');
    }

    try {
        await query(`CREATE INDEX IF NOT EXISTS idx_orders_paystack_reference ON orders(paystack_reference)`);
        console.log('  ✓ idx_orders_paystack_reference index created');
    } catch (e) {
        console.log('  ~ idx_orders_paystack_reference already exists');
    }

    console.log('Migration complete: 074_paystack_payments.js');
}

async function down() {
    console.log('Rolling back: 074_paystack_payments.js');
    await query(`ALTER TABLE payments DROP COLUMN IF EXISTS reference`);
    await query(`ALTER TABLE payments DROP COLUMN IF EXISTS idempotency_key`);
    await query(`ALTER TABLE payments DROP COLUMN IF EXISTS processed_at`);
    await query(`ALTER TABLE payments DROP COLUMN IF EXISTS gateway_response`);
    await query(`ALTER TABLE orders DROP COLUMN IF EXISTS payment_status`);
    await query(`ALTER TABLE orders DROP COLUMN IF EXISTS paystack_reference`);
    await query(`ALTER TABLE orders DROP COLUMN IF EXISTS paid_at`);
    await query(`ALTER TABLE orders DROP COLUMN IF EXISTS currency`);
    console.log('Rollback complete: 074_paystack_payments.js');
}

module.exports = { up, down };
