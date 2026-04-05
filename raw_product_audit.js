const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function run() {
    try {
        // 1. Raw total count
        const totalRaw = await query('SELECT count(*) FROM products WHERE tenant_id = $1', [tid]);
        const totalActive = await query('SELECT count(*) FROM products WHERE tenant_id = $1 AND deleted_at IS NULL', [tid]);
        
        console.log(`TOTAL RAW PRODUCTS: ${totalRaw.rows[0].count}`);
        console.log(`TOTAL ACTIVE PRODUCTS (NULL deleted_at): ${totalActive.rows[0].count}`);

        // 2. Count by category name (grouping duplicates)
        const catRes = await query(`
            SELECT c.name, COUNT(p.id) as count
            FROM categories c
            LEFT JOIN products p ON c.id = p.category_id AND p.deleted_at IS NULL
            WHERE c.tenant_id = $1
            GROUP BY c.name
            ORDER BY count DESC
        `, [tid]);
        
        console.log('\n--- COUNTS BY CATEGORY NAME ---');
        catRes.rows.forEach(r => {
            if (r.count > 0) console.log(`${r.name}: ${r.count}`);
        });

        // 3. Check for specific categories the user mentioned
        const specific = await query(`
            SELECT id, name FROM categories 
            WHERE tenant_id = $1 AND (name ILIKE '%Food%' OR name ILIKE '%Accessories%')
        `, [tid]);
        console.log('\n--- SPECIFIC CATEGORIES FOUND ---');
        console.table(specific.rows);

        // 4. Products with NULL category
        const nullCat = await query('SELECT count(*) FROM products WHERE tenant_id = $1 AND category_id IS NULL AND deleted_at IS NULL', [tid]);
        console.log(`\nACTIVE PRODUCTS WITH NO CATEGORY: ${nullCat.rows[0].count}`);

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
