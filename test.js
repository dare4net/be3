require('dotenv').config();
const { query } = require('./config/database.js');

async function test() {
    try {
        const orderId = 'efbe0d12-069d-4700-af5a-23cab50a7dde';
        const res = await query(
            `SELECT o.id, o.vendor_id, u.business_name, u.email 
             FROM orders o
             LEFT JOIN users u ON u.id = o.vendor_id
             WHERE o.id = $1`,
            [orderId]
        );
        console.log("Order vendor_id:", res.rows[0]);
    } catch(err) {
        console.error(err);
    } finally {
        process.exit();
    }
}
test();
