/**
 * Migration 075: Expand orders status constraint for Paystack flow
 * Adds: pending_payment, payment_failed
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 075_expand_orders_status_constraint.js');

    await query(`
        ALTER TABLE orders 
        DROP CONSTRAINT IF EXISTS orders_status_check;
    `);

    await query(`
        ALTER TABLE orders 
        ADD CONSTRAINT orders_status_check 
        CHECK (status = ANY (ARRAY[
            'pending',
            'pending_payment',
            'paid',
            'processing',
            'shipped',
            'completed',
            'cancelled',
            'refunded',
            'pending_whatsapp',
            'payment_failed'
        ]::text[]));
    `);

    console.log('✓ orders_status_check constraint updated with Paystack statuses.');
    console.log('Migration complete: 075_expand_orders_status_constraint.js');
}

async function down() {
    await query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`);
    await query(`
        ALTER TABLE orders 
        ADD CONSTRAINT orders_status_check 
        CHECK (status = ANY (ARRAY[
            'pending', 'paid', 'processing', 'shipped',
            'completed', 'cancelled', 'refunded', 'pending_whatsapp'
        ]::text[]));
    `);
}

module.exports = { up, down };
