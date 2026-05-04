const { pool } = require('./config/database');

async function run() {
    try {
        const tables = ['products', 'categories', 'collections', 'pages'];
        for (const table of tables) {
            const res = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = $1
            `, [table]);
            console.log(`Table ${table} columns:`, res.rows.map(r => r.column_name).join(', '));
        }
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
