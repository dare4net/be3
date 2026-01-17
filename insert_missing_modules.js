const { query, pool } = require('./config/database');

async function run() {
    console.log('Checking for missing modules...');

    const modules = [
        { name: 'storefront', display_name: 'Storefront', version: '1.0.0' },
        { name: 'products', display_name: 'Products', version: '1.0.0' },
        { name: 'cart', display_name: 'Shopping Cart', version: '1.0.0' },
        { name: 'checkout', display_name: 'Checkout', version: '1.0.0' },
        { name: 'orders', display_name: 'Orders', version: '1.0.0' },
        { name: 'payments', display_name: 'Payments', version: '1.0.0' },
        { name: 'shipping', display_name: 'Shipping', version: '1.0.0' },
        { name: 'marketing', display_name: 'Marketing', version: '1.0.0' },
        { name: 'analytics', display_name: 'Analytics', version: '1.0.0' },
    ];

    try {
        for (const mod of modules) {
            console.log(`Ensuring ${mod.name} exists...`);
            await query(`
                INSERT INTO modules (name, display_name, version, is_core, description)
                VALUES ($1, $2, $3, false, $4)
                ON CONFLICT (name) DO UPDATE 
                SET display_name = EXCLUDED.display_name
            `, [mod.name, mod.display_name, mod.version, `${mod.display_name} module`]);
        }
        console.log('✅ Missing modules inserted/updated!');
    } catch (err) {
        console.error('Error', err);
    } finally {
        await pool.end();
    }
}

run();
