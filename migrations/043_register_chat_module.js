const { query } = require('../config/database');

async function run() {
    console.log('Registering Chat Module...');

    try {
        await query(`
            INSERT INTO modules (name, display_name, description, version, is_core)
            VALUES ('chat', 'Real-time Chat', 'Direct communication between customers and vendors with context routing', '1.0.0', false)
            ON CONFLICT (name) DO UPDATE SET 
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description;
        `);
        console.log('✓ Chat module registered.');
    } catch (e) {
        console.error('✗ Chat module registration failed:', e);
    }

    console.log('Migration complete.');
    process.exit(0);
}

run();
