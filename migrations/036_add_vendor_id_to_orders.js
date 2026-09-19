const { query } = require('../config/database');

async function run() {
    console.log('Migrating: Adding vendor_id to orders table...');

    try {
        // Add vendor_id column
        await query(`
            ALTER TABLE orders 
            ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES users(id) ON DELETE SET NULL;
        `);

        // Add index for performance
        await query(`
            CREATE INDEX IF NOT EXISTS idx_orders_vendor_id ON orders(vendor_id);
        `);

        console.log('✓ Column vendor_id added to orders table with index.');
    } catch (e) {
        console.error('✗ Migration failed:', e);
    }

    console.log('Migration complete.');
    process.exit(0);
}

run();
