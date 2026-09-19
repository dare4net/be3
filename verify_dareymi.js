const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function run() {
    try {
        const res = await query('SELECT name, slug, collection_type, is_active FROM collections WHERE name = $1 AND tenant_id = $2', ['Dareymi', tid]);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
