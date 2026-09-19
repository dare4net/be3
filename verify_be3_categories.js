const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function run() {
    try {
        const res = await query(`
            SELECT p.id, p.name, c.name as category_name 
            FROM products p 
            LEFT JOIN categories c ON p.category_id = c.id 
            WHERE p.tenant_id = $1 AND (p.attributes->>'vendor' = 'Be3' OR p.tags @> ARRAY['Be3'])
        `, [tid]);
        
        console.log(`Total Be3 Products: ${res.rows.length}`);
        
        const categories = {};
        res.rows.forEach(r => {
            const cat = r.category_name || 'NO CATEGORY';
            categories[cat] = (categories[cat] || 0) + 1;
        });

        console.log('Be3 Products by Category:');
        console.table(categories);

        // Also list the 60 product names to see if they relate to Home Decor
        console.log('\nSample Product Names (first 20):');
        console.table(res.rows.slice(0, 20).map(r => ({ name: r.name, cat: r.category_name })));

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
