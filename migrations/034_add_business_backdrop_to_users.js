const { query } = require('../config/database');

async function run() {
    console.log('Migrating: Adding business_backdrop to users table...');

    try {
        await query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS business_backdrop TEXT;
        `);
        console.log('✓ Column business_backdrop added to users table.');
    } catch (e) {
        console.error('✗ Column addition failed:', e);
    }

    console.log('Migration complete.');
    process.exit(0);
}

run();
