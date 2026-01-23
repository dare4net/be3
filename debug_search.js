const { query } = require('./config/database');

async function debug() {
    const tenantId = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

    console.log('--- Sample Search Index Record ---');
    const sample = await query(`
        SELECT content_id, content_type, metadata 
        FROM search_indexes 
        WHERE tenant_id = $1 AND content_type = 'product'
        LIMIT 1
    `, [tenantId]);

    if (sample.rows.length > 0) {
        console.log(JSON.stringify(sample.rows[0], null, 2));
    } else {
        console.log('No products found in search index.');
    }

    console.log('\n--- Category Tree Check ---');
    // Try to find a parent category
    const parents = await query(`
        SELECT id, name FROM categories 
        WHERE parent_id IS NULL AND tenant_id = $1
        LIMIT 3
    `, [tenantId]);

    for (const parent of parents.rows) {
        console.log(`\nParent: ${parent.name} (${parent.id})`);
        const children = await query(`
            SELECT id, name FROM categories 
            WHERE parent_id = $1 AND tenant_id = $2
        `, [parent.id, tenantId]);
        console.log(`Children: ${children.rows.map(c => `${c.name} (${c.id})`).join(', ') || 'None'}`);

        // Find products in children
        if (children.rows.length > 0) {
            const childIds = children.rows.map(c => c.id);
            const products = await query(`
                SELECT p.id, p.name, pc.category_id
                FROM products p
                JOIN product_categories pc ON p.id = pc.product_id
                WHERE pc.category_id = ANY($1) AND p.tenant_id = $2
            `, [childIds, tenantId]);
            console.log(`Products in children: ${products.rows.length}`);
            products.rows.slice(0, 3).forEach(p => console.log(` - ${p.name} (in category ${p.category_id})`));
        }
    }
}

debug().catch(console.error).finally(() => process.exit());
