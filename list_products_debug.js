const { query, pool } = require('./config/database');

async function listProducts() {
    try {
        const tenantRes = await query(`SELECT id FROM tenants WHERE subdomain = 'demo'`);
        const tenantId = tenantRes.rows[0].id;
        console.log('Tenant:', tenantId);

        const res = await query(`SELECT * FROM products WHERE tenant_id = $1`, [tenantId]);
        console.log('Products:', res.rows.length);
        if (res.rows.length > 0) {
            console.log('Sample Product:', res.rows[0]);

            // Check variants
            const vars = await query(`SELECT * FROM product_variants WHERE product_id = $1`, [res.rows[0].id]);
            console.log('Variants:', vars.rows);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

listProducts();
