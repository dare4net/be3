require('dotenv').config();
const { query } = require('./config/database.js');

async function checkSchema() {
    try {
        const res = await query(`SELECT created_at FROM orders WHERE id = 'efbe0d12-069d-4700-af5a-23cab50a7dde'`);
        console.log(res.rows);
    } catch(err) {
        console.error(err);
    } finally {
        process.exit();
    }
}
checkSchema();
