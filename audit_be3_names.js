const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function run() {
    try {
        const res = await query(`
            SELECT name, category_id 
            FROM products 
            WHERE tenant_id = $1 AND (attributes->>'vendor' = 'Be3' OR tags @> ARRAY['Be3'])
        `, [tid]);
        
        console.log(`Total Be3 Products: ${res.rows.length}`);
        
        // Count how many contain decor or related terms
        const decorTerms = ['decor', 'vase', 'wall', 'art', 'lamp', 'cushion', 'carpet', 'rug', 'home'];
        const potentialDecor = res.rows.filter(r => 
            decorTerms.some(term => r.name.toLowerCase().includes(term))
        );

        console.log(`Found ${potentialDecor.length} potential Home Decor items:`);
        console.table(potentialDecor.map(p => ({ name: p.name, cat_id: p.category_id })));

        if (potentialDecor.length === 0) {
            console.log('No potential Home Decor items found by name. All Be3 product names:');
            console.table(res.rows.map(r => ({ name: r.name })));
        }

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
