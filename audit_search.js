const { query } = require('./config/database');

async function audit() {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

    console.log('--- CATEGORY HIERARCHY ---');
    const catsRes = await query("SELECT id, name, parent_id FROM categories WHERE tenant_id = $1", [tenantId]);
    const cats = catsRes.rows;
    const catMap = {};
    cats.forEach(c => catMap[c.id] = c);

    function getPath(id) {
        const path = [];
        let curr = catMap[id];
        while (curr) {
            path.unshift(curr.name);
            curr = catMap[curr.parent_id];
        }
        return path.join(' > ');
    }

    cats.forEach(c => {
        console.log(`${c.id}: ${getPath(c.id)}`);
    });

    console.log('\n--- PRODUCT ASSIGNMENTS ---');
    const prodRes = await query(`
        SELECT p.id, p.name, pc.category_id
        FROM products p
        LEFT JOIN product_categories pc ON p.id = pc.product_id
        WHERE p.tenant_id = $1
    `, [tenantId]);

    prodRes.rows.forEach(p => {
        console.log(`${p.id}: ${p.name} -> ${getPath(p.category_id)} (${p.category_id})`);
    });

    console.log('\n--- SEARCH INDEX STATUS ---');
    const indexRes = await query(`
        SELECT content_id, title, metadata->'category_ids' as cats
        FROM search_indexes
        WHERE tenant_id = $1 AND content_type = 'product'
    `, [tenantId]);

    indexRes.rows.forEach(i => {
        console.log(`${i.content_id}: ${i.title} -> Index Cats: ${JSON.stringify(i.cats)}`);
    });
}

audit().catch(console.error).finally(() => process.exit());
