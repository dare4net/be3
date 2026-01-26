const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runDeployMigrations() {
    console.log('🚀 Starting Full Deployment Migration...\n');

    const migrationOrder = [
        // 1. Core Platform Tables
        'platform/core/tenants/database/schema.sql',
        'platform/core/auth/database/schema.sql',
        'platform/core/roles/database/schema.sql',
        'platform/core/subscriptions/database/schema.sql',
        'platform/core/module_registry/database/schema.sql',
        'platform/events/database/schema.sql',

        // 2. Feature Modules
        'modules/products/database/schema.sql',
        'modules/cart/database/schema.sql',
        'modules/orders/database/schema.sql',
        'modules/payments/database/schema.sql',
        'modules/shipping/database/schema.sql',
        'modules/marketing/database/schema.sql',
        'modules/analytics/database/schema.sql',
        'modules/search/database/schema.sql',

        // 3. Evolutionary Migrations
        'migrations/015_enhance_products.sql',
        'migrations/017_create_attributes_system.sql',
        'migrations/018_add_attribute_clauses.sql',
        'migrations/019_add_excluded_clauses.sql',
        'migrations/022_create_layouts_system.sql',
        'migrations/027_search_module.sql',
        'migrations/029_add_collections.sql'
    ];

    for (const schemaPath of migrationOrder) {
        const fullPath = path.join(__dirname, '..', schemaPath);
        if (fs.existsSync(fullPath)) {
            console.log(`📦 Applying: ${schemaPath}`);
            const sql = fs.readFileSync(fullPath, 'utf8');
            try {
                await pool.query(sql);
                console.log(` ✅ Success`);
            } catch (err) {
                if (err.message.includes('already exists')) {
                    console.log(` ℹ️ Skipped (already exists)`);
                } else {
                    console.error(` ❌ Error: ${err.message}`);
                }
            }
        }
    }

    console.log('\n✨ Database schema is up to date!');
    await pool.end();
}

runDeployMigrations().catch(err => {
    console.error('💥 Deployment migration failed:', err);
    process.exit(1);
});
