const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function audit() {
    try {
        console.log('--- AUDIT USING product_categories TABLE ---');
        
        // 1. Total counts per category (active products only)
        const counts = await query(`
            SELECT c.name, COUNT(pc.product_id) as total_products
            FROM categories c
            LEFT JOIN product_categories pc ON c.id = pc.category_id
            LEFT JOIN products p ON pc.product_id = p.id
            WHERE c.tenant_id = $1 AND p.tenant_id = $1 AND p.deleted_at IS NULL
            GROUP BY c.name
            ORDER BY total_products DESC
        `, [tid]);
        
        console.log('\nCategory Product Counts:');
        console.table(counts.rows);

        // 2. Identify the 'Home Decor' category from the user's perspective
        const homeDecor = counts.rows.find(r => r.name === 'Home Decor');
        console.log('\nHome Decor Category Status:', homeDecor || 'Not Found');

        // 3. Be3 products and their categories in M2M table
        const be3Mapping = await query(`
            SELECT p.name as product_name, c.name as category_name
            FROM products p
            JOIN product_categories pc ON p.id = pc.product_id
            JOIN categories c ON pc.category_id = c.id
            WHERE p.tenant_id = $1 AND (p.attributes->>'vendor' = 'Be3' OR p.tags @> ARRAY['Be3'])
        `, [tid]);

        console.log(`\nBe3 mappings found in M2M table: ${be3Mapping.rows.length}`);
        if (be3Mapping.rows.length > 0) {
            const m2mCounts = {};
            be3Mapping.rows.forEach(r => {
                m2mCounts[r.category_name] = (m2mCounts[r.category_name] || 0) + 1;
            });
            console.log('Be3 Products by M2M Category:');
            console.table(m2mCounts);
        }

        // 4. Products with NO M2M mapping
        const noMapping = await query(`
            SELECT COUNT(*) 
            FROM products p
            LEFT JOIN product_categories pc ON p.id = pc.product_id
            WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND pc.product_id IS NULL
            AND (p.attributes->>'vendor' = 'Be3' OR p.tags @> ARRAY['Be3'])
        `, [tid]);
        console.log(`\nBe3 products with NO M2M mapping: ${noMapping.rows[0].count}`);

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
audit();
