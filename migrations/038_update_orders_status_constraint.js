const { query } = require('../config/database');

async function run() {
    console.log('Migrating: Updating orders_status_check constraint...');

    try {
        // Drop existing constraint
        await query(`
            ALTER TABLE orders 
            DROP CONSTRAINT IF EXISTS orders_status_check;
        `);

        // Add updated constraint
        await query(`
            ALTER TABLE orders 
            ADD CONSTRAINT orders_status_check 
            CHECK (status = ANY (ARRAY[
                'pending', 
                'paid', 
                'processing', 
                'shipped', 
                'completed', 
                'cancelled', 
                'refunded', 
                'pending_whatsapp'
            ]::text[]));
        `);

        console.log('✓ Constraint orders_status_check updated to include pending_whatsapp.');
    } catch (e) {
        console.error('✗ Migration failed:', e);
    }

    console.log('Migration complete.');
    process.exit(0);
}

run();
