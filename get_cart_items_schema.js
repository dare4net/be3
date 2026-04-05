const { query } = require('./config/database');

async function checkColumns() {
    try {
        const res = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'cart_items'");
        console.log('Cart Items Columns:', res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

checkColumns();
