const { query } = require('./config/database');

async function test() {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    const slug = 'electronics'; // case insensitive? usually slugs are lower

    console.log('--- Testing Storefront API Recursion for slug:', slug);
    const sql = `
        SELECT p.name, p.id FROM products p
        WHERE p.tenant_id = $1 AND p.status = 'active'
        AND EXISTS (
            SELECT 1 FROM product_categories pc
            WHERE pc.product_id = p.id AND pc.category_id IN (
                WITH RECURSIVE cat_tree AS (
                    SELECT id FROM categories WHERE slug = $2 AND tenant_id = $1
                    UNION ALL
                    SELECT c.id FROM categories c
                    INNER JOIN cat_tree ct ON c.parent_id = ct.id
                    WHERE c.tenant_id = $1
                )
                SELECT id FROM cat_tree
            )
        )
    `;

    const res = await query(sql, [tenantId, slug]);
    console.log('Results found:', res.rows.length);
    res.rows.forEach(r => console.log(' -', r.name));
}

test().catch(console.error).finally(() => process.exit());
