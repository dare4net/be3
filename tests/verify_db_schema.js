const { query } = require('../config/database');

async function check() {
    try {
        const tables = ['analytics_events', 'daily_stats'];
        for (const table of tables) {
            console.log(`\n--- Schema for ${table} ---`);
            const res = await query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
            `, [table]);
            console.log(JSON.stringify(res.rows, null, 2));

            const count = await query(`SELECT COUNT(*) FROM ${table}`);
            console.log('Row count:', count.rows[0].count);
        }
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}
check();
