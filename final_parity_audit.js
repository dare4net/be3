const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function run() {
    try {
        // 1. All categories and counts
        const allCats = await query(`
            SELECT c.id, c.name, COUNT(p.id) as total_products
            FROM categories c
            LEFT JOIN products p ON c.id = p.category_id
            WHERE c.tenant_id = $1
            GROUP BY c.id, c.name
            ORDER BY total_products DESC
        `, [tid]);
        
        console.log('--- ALL CATEGORIES ---');
        allCats.rows.forEach(r => {
            console.log(`${r.name} (${r.id}): ${r.total_products}`);
        });

        // 2. All Be3 products and their category ID
        const be3Products = await query(`
            SELECT id, name, category_id
            FROM products
            WHERE tenant_id = $1 AND (attributes->>'vendor' = 'Be3' OR tags @> ARRAY['Be3'])
        `, [tid]);

        console.log('\n--- BE3 PRODUCTS ---');
        console.log(`Total: ${be3Products.rows.length}`);
        
        const catMap = {};
        be3Products.rows.forEach(p => {
            catMap[p.category_id] = (catMap[p.category_id] || 0) + 1;
        });
        
        Object.keys(catMap).forEach(cid => {
            const catName = allCats.rows.find(c => c.id === cid)?.name || 'NONE';
            console.log(`Category ${catName} (${cid}): ${catMap[cid]}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
