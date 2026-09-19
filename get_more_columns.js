const { query } = require('./config/database');

async function checkColumns() {
    try {
        const res = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'collections'");
        console.log('Collections Columns:', res.rows.map(r => r.column_name));
        
        const res2 = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
        console.log('Users Columns:', res2.rows.map(r => r.column_name));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

checkColumns();
