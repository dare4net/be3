const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function run() {
    try {
        const catRes = await query(`
            SELECT id, name FROM categories WHERE tenant_id = $1 AND name ILIKE '%Food%'
        `, [tid]);

        if (catRes.rows.length === 0) {
            console.log('No Food category found');
        } else {
            console.log('--- PRODUCT COUNTS PER CATEGORY ---');
            for (const cat of catRes.rows) {
                const countRes = await query(`
                    SELECT count(*) FROM products WHERE category_id = $1 AND tenant_id = $2
                `, [cat.id, tid]);
                console.log(`${cat.name}: ${countRes.rows[0].count}`);
            }
        }

        // To be safe, list ALL active categories with their counts again
        const allRes = await query(`
            SELECT c.name, COUNT(p.id) as count
            FROM categories c
            LEFT JOIN products p ON c.id = p.category_id
            WHERE c.tenant_id = $1
            GROUP BY c.name
            ORDER BY count DESC
        `, [tid]);
        console.log('\n--- ALL CATEGORY COUNTS ---');
        allRes.rows.forEach(r => console.log(`${r.name}: ${r.count}`));

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
