const { query } = require('../config/database');
async function check() {
    const cols = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' ORDER BY column_name`);
    console.log('\n=== orders columns ===');
    cols.rows.forEach(r => console.log(' ', r.column_name));
    process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });
