const { query } = require('../config/database');

async function check() {
    try {
        const res = await query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'analytics_events'
            ORDER BY ordinal_position
        `);
        console.log('--- FULL SCHEMA FOR analytics_events ---');
        res.rows.forEach(col => {
            console.log(`${col.column_name.padEnd(25)} | ${col.data_type.padEnd(20)} | Nullable: ${col.is_nullable}`);
        });
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}
check();
