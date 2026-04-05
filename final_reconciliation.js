const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function reconcile() {
    try {
        console.log('--- RECONCILING WITH SEARCH INDEX ---');
        
        // 1. Find the 19 products in 'Food'
        const foodCat = await query("SELECT id, name FROM categories WHERE name = 'Food' AND tenant_id = $1", [tid]);
        if (foodCat.rows[0]) {
            const fid = foodCat.rows[0].id;
            const res = await query(`
                SELECT count(*) FROM search_indexes 
                WHERE tenant_id = $1 AND content_type = 'product' 
                AND (metadata->>'category_id' = $2 OR metadata->'category_ids' ? $2)
            `, [tid, fid]);
            console.log(`Products in SEARCH INDEX for Food (${fid}): ${res.rows[0].count}`);
        }

        // 2. Find the 6 products in 'Accessories'
        const accCat = await query("SELECT id, name FROM categories WHERE name = 'Accessories' AND tenant_id = $1", [tid]);
        if (accCat.rows[0]) {
            const aid = accCat.rows[0].id;
            const res = await query(`
                SELECT count(*) FROM search_indexes 
                WHERE tenant_id = $1 AND content_type = 'product' 
                AND (metadata->>'category_id' = $2 OR metadata->'category_ids' ? $2)
            `, [tid, aid]);
            console.log(`Products in SEARCH INDEX for Accessories (${aid}): ${res.rows[0].count}`);
        }

        // 3. Find the 7 products in 'Home Decor'
        const hdCat = await query("SELECT id, name FROM categories WHERE name = 'Home Decor' AND tenant_id = $1", [tid]);
        if (hdCat.rows[0]) {
            const hdid = hdCat.rows[0].id;
            const res = await query(`
                SELECT count(*) FROM search_indexes 
                WHERE tenant_id = $1 AND content_type = 'product' 
                AND (metadata->>'category_id' = $2 OR metadata->'category_ids' ? $2)
            `, [tid, hdid]);
            console.log(`Products in SEARCH INDEX for Home Decor (${hdid}): ${res.rows[0].count}`);
            
            // If we found them, let's see their names
            const names = await query(`
                SELECT p.name, p.attributes->>'vendor' as vendor
                FROM search_indexes si
                JOIN products p ON si.content_id = p.id
                WHERE si.tenant_id = $1 AND si.content_type = 'product' 
                AND (si.metadata->>'category_id' = $2 OR si.metadata->'category_ids' ? $2)
            `, [tid, hdid]);
            console.log('Home Decor Products found in Index:');
            console.table(names.rows);
        }

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
reconcile();
