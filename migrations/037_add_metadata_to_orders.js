const { query } = require('../config/database');

async function run() {
    console.log('Migrating: Adding metadata to orders table...');

    try {
        // Add metadata column as JSONB
        await query(`
            ALTER TABLE orders 
            ADD COLUMN IF NOT EXISTS metadata JSONB;
        `);

        console.log('✓ Column metadata added to orders table.');
    } catch (e) {
        console.error('✗ Migration failed:', e);
    }

    console.log('Migration complete.');
    process.exit(0);
}

run();
