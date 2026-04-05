const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function run() {
    try {
        const res = await query(`
            SELECT c.id, c.name, COUNT(p.id) as total_products,
                   COUNT(p.id) FILTER (WHERE p.attributes->>'vendor' = 'Be3' OR p.tags @> ARRAY['Be3']) as be3_products
            FROM categories c
            LEFT JOIN products p ON c.id = p.category_id
            WHERE c.tenant_id = $1
            GROUP BY c.id, c.name
            ORDER BY total_products DESC
        `, [tid]);
        
        console.table(res.rows);

        // Find specifically the ones with 7 products
        const seven = res.rows.filter(r => r.total_products == 7);
        console.log('\nCategories with 7 products:');
        console.table(seven);

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
