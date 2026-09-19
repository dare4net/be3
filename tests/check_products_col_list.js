const { query } = require('../config/database');
async function check() {
    try {
        const res = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'products'");
        console.log(res.rows.map(r => r.column_name).join('\n'));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
