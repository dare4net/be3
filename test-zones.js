const fs = require('fs');
const { pool } = require('./config/database');

async function check() {
    try {
        const res = await pool.query("SELECT * FROM vendor_shipping_zones");
        console.log("Zones:", res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}
check();
