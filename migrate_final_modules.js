// Helper to migrate final modules
const { pool } = require('./config/database');
const fs = require('fs');
const path = require('path');

async function migrateFinal() {
    console.log('🚀 Migrating Final Modules...\n');

    const schemas = [
        'modules/marketing/database/schema.sql',
        'modules/analytics/database/schema.sql',
        'modules/shipping/database/schema.sql'
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

    // Also need to enable modules in .env or seed database plan for them
    // But since we use subscriptionGuard, we need to add them to the 'plan_modules' table
    // Let's do a quick hack to add them to ALL existing plans
    console.log('\nEnabling modules in Plans...');
    await pool.query(`
        INSERT INTO plan_modules (plan_id, module_name, is_enabled)
        SELECT id, 'marketing', true FROM subscription_plans
        ON CONFLICT DO NOTHING;
    `);
    await pool.query(`
        INSERT INTO plan_modules (plan_id, module_name, is_enabled)
        SELECT id, 'analytics', true FROM subscription_plans
        ON CONFLICT DO NOTHING;
    `);
    await pool.query(`
        INSERT INTO plan_modules (plan_id, module_name, is_enabled)
        SELECT id, 'shipping', true FROM subscription_plans
        ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Modules enabled in all plans!');

    process.exit();
}

migrateFinal();
