const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function explore() {
    try {
        console.log('--- TABLES CHECK ---');
        const tables = await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log(tables.rows.map(r => r.table_name).join(', '));

        console.log('\n--- CATEGORY NAMES ---');
        const cats = await query("SELECT id, name FROM categories WHERE tenant_id = $1", [tid]);
        cats.rows.forEach(r => console.log(`${r.name}: ${r.id}`));

        console.log('\n--- SAMPLES WITH NON-NULL CATEGORY ---');
        const samples = await query(`
            SELECT p.name, c.name as category_name
            FROM products p
            JOIN categories c ON p.category_id = c.id
            WHERE p.tenant_id = $1
            LIMIT 20
        `, [tid]);
        console.table(samples.rows);

        console.log('\n--- SAMPLES OF BE3 PRODUCTS ---');
        const be3 = await query(`
            SELECT id, name, category_id, tags, attributes->>'vendor' as vendor
            FROM products
            WHERE tenant_id = $1 AND (attributes->>'vendor' = 'Be3' OR tags @> ARRAY['Be3'])
            LIMIT 10
        `, [tid]);
        console.log(JSON.stringify(be3.rows, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
explore();
