const { query } = require('../config/database');

async function run() {
    console.log('Migrating: Adding business_thumbnail to users table...');

    try {
        await query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS business_thumbnail TEXT;
        `);
        console.log('✓ Column business_thumbnail added to users table.');
    } catch (e) {
        console.error('✗ Column addition failed:', e);
    }

    console.log('Migration complete.');
    process.exit(0);
}

run();
