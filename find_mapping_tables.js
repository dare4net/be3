const { query } = require('./config/database');

async function run() {
    try {
        console.log('--- ALL TABLES IN PUBLIC SCHEMA ---');
        const tables = await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        const tableNames = tables.rows.map(r => r.table_name);
        console.log(tableNames.join(', '));

        console.log('\n--- TABLES WITH category_id COLUMN ---');
        const catIdCols = await query("SELECT table_name FROM information_schema.columns WHERE column_name = 'category_id' AND table_schema = 'public'");
        console.table(catIdCols.rows);

        console.log('\n--- TABLES WITH product_id COLUMN ---');
        const prodIdCols = await query("SELECT table_name FROM information_schema.columns WHERE column_name = 'product_id' AND table_schema = 'public'");
        console.table(prodIdCols.rows);

        console.log('\n--- SEARCH INDEX METADATA SAMPLE (FOR CATEGORY_IDS) ---');
        const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
        const si = await query(`
            SELECT content_id, metadata->'category_ids' as cids, metadata->>'category_id' as cid 
            FROM search_indexes 
            WHERE tenant_id = $1 AND content_type = 'product' 
            AND metadata->'category_ids' IS NOT NULL 
            LIMIT 5
        `, [tid]);
        console.log(JSON.stringify(si.rows, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
