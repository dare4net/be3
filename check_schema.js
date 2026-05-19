require('dotenv').config();
const { query } = require('./config/database.js');

async function checkSchema() {
    try {
        const ordersSchema = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'`);
        const orderItemsSchema = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'order_items'`);
        
        console.log('--- orders table columns ---');
        console.log(ordersSchema.rows.map(r => r.column_name).join(', '));
        
        console.log('\n--- order_items table columns ---');
        console.log(orderItemsSchema.rows.map(r => r.column_name).join(', '));
    } catch(err) {
        console.error(err);
    } finally {
        process.exit();
    }
}
checkSchema();
