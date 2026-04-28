const { query } = require('../config/database');
const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function investigate() {
    try {
        console.log("--- INVESTIGATING 'gch' PRODUCTS ---");
        const res = await query(`
            SELECT 
                p.id, 
                p.name, 
                p.attributes->>'vendor' as vendor,
                STRING_AGG(DISTINCT c.name, ', ') as categories
            FROM products p
            LEFT JOIN product_categories pc ON p.id = pc.product_id
            LEFT JOIN categories c ON pc.category_id = c.id
            WHERE p.name = 'gch' AND p.tenant_id = $1
            GROUP BY p.id
        `, [TENANT_ID]);
        
        res.rows.forEach(p => {
            console.log(`ID: ${p.id}`);
            console.log(`Name: ${p.name}`);
            console.log(`Vendor: ${p.vendor}`);
            console.log(`Categories: ${p.categories}\n`);
        });

    } catch(e) {
        console.error(e.message);
    } finally {
        process.exit();
    }
}
investigate();
