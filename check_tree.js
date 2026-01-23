const { query } = require('./config/database');

async function check() {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    const categories = await query("SELECT id, name, parent_id FROM categories WHERE tenant_id = $1", [tenantId]);
    const products = await query(`
        SELECT p.name, pc.category_id 
        FROM products p 
        JOIN product_categories pc ON p.id = pc.product_id 
        WHERE p.tenant_id = $1
    `, [tenantId]);

    console.log('--- Categories ---');
    const catMap = {};
    categories.rows.forEach(c => catMap[c.id] = c);

    categories.rows.forEach(c => {
        const parent = c.parent_id ? catMap[c.parent_id]?.name : 'ROOT';
        console.log(`${c.name} (${c.id}) -> Parent: ${parent}`);
    });

    console.log('\n--- Products ---');
    products.rows.forEach(p => {
        const cat = catMap[p.category_id]?.name || 'Unknown';
        console.log(`${p.name} -> Category: ${cat}`);
    });
}

check().catch(console.error).finally(() => process.exit());
