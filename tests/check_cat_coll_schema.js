const { query } = require('../config/database');

async function check() {
    const tables = ['categories', 'collections'];
    for (const table of tables) {
        try {
            const res = await query(`
                SELECT column_name
                FROM information_schema.columns 
                WHERE table_name = $1
            `, [table]);
            console.log(`--- ${table} ---`);
            console.log(res.rows.map(r => r.column_name).join(', '));
        } catch (e) {
            console.error(e);
        }
    }
    process.exit(0);
}
check();
