const { query } = require('../config/database');

async function run() {
    console.log('Migrating Multi-vendor Infrastructure...');

    // 1. Register Vendor Module in global registry
    try {
        await query(`
            INSERT INTO modules (name, display_name, description, version, is_core)
            VALUES ('vendor', 'Multi-vendor', 'Tag-based multi-vendor system with product isolation', '1.0.0', false)
            ON CONFLICT (name) DO UPDATE SET 
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description;
        `);
        console.log('✓ Vendor module registered.');
    } catch (e) {
        console.error('✗ Module registration failed:', e);
        // Don't exit here, might already exist or table might be core
    }

    // 2. Add business_name to users table
    try {
        await query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name VARCHAR(255);
        `);
        console.log('✓ Column business_name added to users table.');
    } catch (e) {
        console.error('✗ Column addition failed:', e);
    }

    console.log('Migration complete.');
    process.exit(0);
}

run();
