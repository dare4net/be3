const { query } = require('../config/database');
const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function check() {
    try {
        const res = await query(`
            SELECT p.name, string_agg(c.name, ',') as cats 
            FROM products p 
            LEFT JOIN product_categories pc ON p.id = pc.product_id 
            LEFT JOIN categories c ON pc.category_id = c.id 
            WHERE p.attributes->>'vendor' = 'Anthy Wears Store' 
              AND p.tenant_id = $1 
              AND p.is_variant = false 
              AND p.deleted_at IS NULL
            GROUP BY p.id 
            ORDER BY p.name`,
        [TENANT_ID]);
        res.rows.forEach(p => console.log(p.name.padEnd(50), '[', p.cats || 'Uncategorized', ']'));
    } catch(e) { console.error(e); }
    process.exit();
}
check();
