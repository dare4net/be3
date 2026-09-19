const { query } = require('./config/database');

async function checkColumns() {
    try {
        const res = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'products'");
        console.log('Columns:', res.rows.map(r => r.column_name));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

checkColumns();
