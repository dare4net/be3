const { pool } = require('./config/database');

async function check() {
    try {
        const res = await pool.query("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_addresses');");
        console.log("user_addresses exists:", res.rows[0].exists);

        const res2 = await pool.query("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vendor_shipping_configs');");
        console.log("vendor_shipping_configs exists:", res2.rows[0].exists);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

check();
