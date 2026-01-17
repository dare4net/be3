const { query, pool } = require('./config/database');

async function checkCart() {
    try {
        const tenantRes = await query(`SELECT id FROM tenants WHERE subdomain = 'demo'`);
        const tenantId = tenantRes.rows[0].id;

        const res = await query(`
            SELECT * FROM tenant_modules 
            WHERE tenant_id = $1 AND module_name = 'cart'
        `, [tenantId]);

        console.log('Cart Module Status:', res.rows[0]);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkCart();
