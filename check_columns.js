const { query } = require('./config/database');

async function checkColumns() {
    try {
        const res = await query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'tenants'
            ORDER BY ordinal_position;
        `);
        console.log(res.rows.map(r => r.column_name));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

checkColumns();
