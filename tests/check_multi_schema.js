const { query } = require('../config/database');

async function check() {
    const tables = ['products', 'categories', 'collections'];
    for (const table of tables) {
        try {
            const res = await query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
            `, [table]);
            console.log(`--- SCHEMA FOR ${table} ---`);
            const cols = res.rows.map(r => r.column_name);
            console.log(cols.join(', '));
        } catch (e) {
            console.error(`Failed to check ${table}:`, e.message);
        }
    }
    process.exit(0);
}
check();
