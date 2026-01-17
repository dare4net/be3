const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runMigrations() {
    console.log('Running database migrations...\n');

    const schemas = [
        // 'platform/events/database/schema.sql',
        // 'platform/core/auth/database/schema.sql',
        // 'platform/core/tenants/database/schema.sql',
        // 'platform/core/roles/database/schema.sql',
        // 'platform/core/subscriptions/database/schema.sql',
        // 'platform/core/module_registry/database/schema.sql',
        // 'modules/products/database/schema.sql',
        // 'modules/cart/database/schema.sql',
        // 'modules/orders/database/schema.sql',
        // 'modules/payments/database/schema.sql',
        'migrations/022_create_layouts_system.sql'
    ];

    for (const schemaPath of schemas) {
        const fullPath = path.join(__dirname, '..', schemaPath);
        if (fs.existsSync(fullPath)) {
            const sql = fs.readFileSync(fullPath, 'utf8');
            console.log(`✓ Running: ${schemaPath}`);
            await pool.query(sql);
        } else {
            console.log(`⚠ Skipped (not found): ${schemaPath}`);
        }
    }

    console.log('\n✅ All migrations completed!');
    await pool.end();
    process.exit(0);
}

runMigrations().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
