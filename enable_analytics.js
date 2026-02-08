const { query } = require('./config/database');

const TENANT_ID = '3d5a4944-595d-4444-9333-333333333333';

async function enableAnalytics() {
    try {
        console.log(`Enabling analytics for tenant ${TENANT_ID}...`);

        // Check if table exists
        const tableCheck = await query(`
            SELECT EXISTS (
               SELECT FROM information_schema.tables 
               WHERE  table_schema = 'public'
               AND    table_name   = 'tenant_modules'
            );
        `);

        if (!tableCheck.rows[0].exists) {
            console.log('tenant_modules table does not exist. Configuring subscription directly?');
            // If table doesn't exist, we might need to create it or insert into subscriptions/plans
            // But subscriptionGuard.js selects from it, so it should exist.
            console.error('tenant_modules table missing!');
        } else {
            await query(`
                INSERT INTO tenant_modules (tenant_id, module_name, is_enabled)
                VALUES ($1, 'analytics', true)
                ON CONFLICT (tenant_id, module_name) DO UPDATE SET is_enabled = true;
            `, [TENANT_ID]);
            console.log('✅ Analytics enabled in tenant_modules.');
        }

    } catch (e) {
        console.error('Error enabling analytics:', e);
    }
    process.exit(0);
}

enableAnalytics();
