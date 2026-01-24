const { query, pool } = require('./config/database');

async function enableModules() {
    try {
        // 1. Get Demo Tenant ID
        const tenantRes = await query(`SELECT id FROM tenants WHERE subdomain = 'demo'`);
        if (tenantRes.rows.length === 0) {
            console.log('❌ Demo tenant not found');
            return;
        }
        const tenantId = tenantRes.rows[0].id;

        const modulesToEnable = ['storefront', 'products', 'cart', 'checkout', 'orders', 'payments', 'shipping', 'marketing', 'analytics', 'banner'];

        console.log(`Enabling modules for tenant ${tenantId}...`);

        for (const moduleName of modulesToEnable) {
            await query(`
                INSERT INTO tenant_modules (tenant_id, module_name, is_enabled)
                VALUES ($1, $2, true)
                ON CONFLICT (tenant_id, module_name) 
                DO UPDATE SET is_enabled = true, enabled_at = NOW()
            `, [tenantId, moduleName]);
            console.log(`✓ Enabled ${moduleName}`);
        }

        console.log('✅ All modules enabled for demo tenant!');

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

enableModules();
