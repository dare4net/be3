const { query } = require('../config/database');

async function run() {
    console.log('Migrating: Adding image_url to order_items...');

    try {
        await query(`
            ALTER TABLE order_items 
            ADD COLUMN IF NOT EXISTS image_url TEXT;
        `);
        console.log('✓ Column image_url added to order_items.');
    } catch (e) {
        console.error('✗ Migration failed:', e);
    }

    console.log('Migration complete.');
    process.exit(0);
}

run();
