const { query } = require('../config/database');

async function run() {
    console.log('Migrating: Adding vendor checkout settings to users table...');

    try {
        await query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS checkout_style VARCHAR(20) DEFAULT 'inhouse',
            ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(50);
        `);
        console.log('✓ Columns checkout_style and whatsapp_phone added to users table.');
    } catch (e) {
        console.error('✗ Column addition failed:', e);
    }

    console.log('Migration complete.');
    process.exit(0);
}

run();
