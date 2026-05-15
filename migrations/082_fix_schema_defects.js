/**
 * Migration 082: Fix schema defects left by failed 075 re-run
 *
 * Fixes:
 * 1. orders.payment_status column DEFAULT was 'pending' (not in the 081 constraint).
 *    Changed to 'unpaid' to match the constraint.
 * 2. Backfill any rows that still have payment_status = 'pending' → 'unpaid'
 *    (rows created between 081 running and this fix).
 * 3. Re-add orders_status_check which was dropped by the failed 075 re-run
 *    but never re-added (075 dropped it then failed before it could add it back).
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 082_fix_schema_defects.js');

    // 1. Fix the column default
    await query(`
        ALTER TABLE orders
        ALTER COLUMN payment_status SET DEFAULT 'unpaid'
    `);
    console.log('  ✓ orders.payment_status default changed to unpaid');

    // 2. Backfill any rows where payment_status = 'pending' (violates constraint)
    const { rowCount } = await query(`
        UPDATE orders
        SET payment_status = 'unpaid'
        WHERE payment_status = 'pending'
    `);
    console.log(`  ✓ backfilled ${rowCount} row(s) with payment_status='pending' → 'unpaid'`);

    // 3. Re-add orders_status_check (dropped by failed 075 re-run, never restored)
    await query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`);
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
    console.log('  ✓ orders_status_check constraint restored');

    console.log('Migration complete: 082_fix_schema_defects.js');
}

async function down() {
    await query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`);
    await query(`ALTER TABLE orders ALTER COLUMN payment_status SET DEFAULT 'pending'`);
}

module.exports = { up, down };
