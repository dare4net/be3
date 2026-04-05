const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function audit() {
    try {
        const res = await query(`
            SELECT c.id, c.name, COUNT(p.id) as total_products,
                   COUNT(p.id) FILTER (WHERE p.attributes->>'vendor' = 'Be3' OR p.tags @> ARRAY['Be3']) as be3_products
            FROM categories c
            LEFT JOIN products p ON c.id = p.category_id
            WHERE c.tenant_id = $1
            GROUP BY c.id, c.name
            ORDER BY be3_products DESC, total_products DESC
        `, [tid]);
        console.table(res.rows);

        // Also check if some products have NULL category_id
        const nullCat = await query(`
            SELECT COUNT(*) as total_no_cat,
                   COUNT(*) FILTER (WHERE attributes->>'vendor' = 'Be3' OR tags @> ARRAY['Be3']) as be3_no_cat
            FROM products
            WHERE tenant_id = $1 AND category_id IS NULL
        `, [tid]);
        console.log('\nProducts with no category:');
        console.table(nullCat.rows);

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
audit();
