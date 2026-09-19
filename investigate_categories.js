const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function investigate() {
    try {
        console.log('--- CHECKING FOR MAPPING TABLES ---');
        const tables = await query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND (table_name LIKE '%product%' AND table_name LIKE '%category%')
        `);
        console.log('Mapping tables found:', tables.rows.map(r => r.table_name).join(', '));

        if (tables.rows.length > 0) {
            for (const t of tables.rows) {
                const count = await query(`SELECT count(*) FROM ${t.table_name}`);
                console.log(`Table ${t.name}: ${count.rows[0].count} rows`);
            }
        }

        console.log('\n--- CHECKING SEARCH INDEX CATEGORIES FOR BE3 PRODUCTS ---');
        // Find any search index entries for Be3 products
        const siResults = await query(`
            SELECT si.content_id, p.name, si.metadata->'category_ids' as cat_ids, si.metadata->>'category_id' as cat_id
            FROM search_indexes si
            JOIN products p ON si.content_id = p.id
            WHERE si.tenant_id = $1 
            AND (p.attributes->>'vendor' = 'Be3' OR p.tags @> ARRAY['Be3'])
            LIMIT 20
        `, [tid]);

        console.log('Search Index Metadata for Be3 products:');
        siResults.rows.forEach(r => {
            console.log(`Product: ${r.name}, cat_id: ${r.cat_id}, cat_ids: ${JSON.stringify(r.cat_ids)}`);
        });

        // If we found cat_ids, let's see what those names are
        const allIds = new Set();
        siResults.rows.forEach(r => {
            if (r.cat_id) allIds.add(r.cat_id);
            if (r.cat_ids) r.cat_ids.forEach(id => allIds.add(id));
        });

        if (allIds.size > 0) {
            const idList = Array.from(allIds);
            const catNames = await query(`SELECT id, name FROM categories WHERE id = ANY($1)`, [idList]);
            console.log('\n--- RESOLVED CATEGORY NAMES FROM METADATA ---');
            console.table(catNames.rows);
        }

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
investigate();
