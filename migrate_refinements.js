// Helper to migrate refinements
const { pool } = require('./config/database');
const fs = require('fs');
const path = require('path');

async function migrateRefinements() {
    console.log('🚀 Migrating Refinements...\n');

    const schemas = [
        'modules/marketing/database/schema_coupons.sql',
        'modules/analytics/database/schema_events.sql',
        'modules/shipping/database/schema_tracking.sql',
        'migrations/018_add_attribute_image.sql',
        'migrations/019_fix_attribute_timestamps.sql'
    ];

    for (const schemaPath of schemas) {
        try {
            const fullPath = path.join(__dirname, schemaPath);
            const sql = fs.readFileSync(fullPath, 'utf8');
            console.log(`Doing: ${schemaPath}`);
            await pool.query(sql);
            console.log(`✅ Success`);
        } catch (err) {
            console.error(`❌ Failed: ${schemaPath}`, err.message);
        }
    }

    console.log('\n✅ Refinements Applied!');
    process.exit();
}

migrateRefinements();
