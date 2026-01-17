const { query, pool } = require('./config/database');

async function check() {
    try {
        // 1. Get Demo Tenant ID
        const tenantRes = await query(`SELECT id, name, subdomain FROM tenants WHERE subdomain = 'demo'`);
        if (tenantRes.rows.length === 0) {
            console.log('❌ Demo tenant not found');
            return;
        }
        const tenant = tenantRes.rows[0];
        console.log('Tenant:', tenant);

        // 2. Check Tenant Modules
        const modsRes = await query(`SELECT * FROM tenant_modules WHERE tenant_id = $1`, [tenant.id]);
        console.log('Tenant Modules:', modsRes.rows);

        // 3. Check Modules Table
        const allMods = await query(`SELECT * FROM modules`);
        console.log('All Modules:', allMods.rows.map(m => m.name));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

check();
