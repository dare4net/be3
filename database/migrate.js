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
        'migrations/022_create_layouts_system.sql',
        'migrations/027_search_module.sql',
        'migrations/028_tenant_rate_limit_exempt.sql',
        'migrations/029_user_category_permissions.sql',
        'migrations/051_enable_pgvector.js',
        'migrations/052_register_missing_modules.js',
        'migrations/053_add_session_id_to_orders.js',
        'migrations/060_add_range_and_custom_attributes.sql',
        'migrations/061_add_product_variants_support.sql'
    ];

    for (const schemaPath of schemas) {
        const fullPath = path.join(__dirname, '..', schemaPath);
        if (!fs.existsSync(fullPath)) {
            console.log(`⚠ Skipped (not found): ${schemaPath}`);
            continue;
        }

        console.log(`✓ Running: ${schemaPath}`);

        if (schemaPath.endsWith('.js')) {
            // JS migrations export { up, down }
            const migration = require(fullPath);
            if (migration.up) await migration.up();
        } else {
            // SQL migrations run directly
            const sql = fs.readFileSync(fullPath, 'utf8');
            await pool.query(sql);
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
