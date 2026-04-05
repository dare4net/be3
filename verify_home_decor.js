const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function run() {
    try {
        const cat = await query("SELECT id FROM categories WHERE tenant_id = $1 AND name = 'Home Decor'", [tid]);
        const hdid = cat.rows[0].id;

        const countRes = await query("SELECT count(*) FROM products WHERE category_id = $1 AND tenant_id = $2", [hdid, tid]);
        const be3CountRes = await query("SELECT count(*) FROM products WHERE category_id = $1 AND tenant_id = $2 AND (attributes->>'vendor' = 'Be3' OR tags @> ARRAY['Be3'])", [hdid, tid]);

        console.log(`[Home Decor ID]: ${hdid}`);
        console.log(`[Total Products in Home Decor]: ${countRes.rows[0].count}`);
        console.log(`[Be3 Products in Home Decor]: ${be3CountRes.rows[0].count}`);

        const sample = await query("SELECT name, attributes->>'vendor' as vendor, created_by FROM products WHERE category_id = $1 AND tenant_id = $2 LIMIT 10", [hdid, tid]);
        console.table(sample.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
