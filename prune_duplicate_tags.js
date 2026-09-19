const { query } = require('./config/database');
const IndexService = require('./modules/search/services/IndexService');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function prune() {
    try {
        console.log('--- PRUNING DUPLICATE VENDOR TAGS ---');

        // Get all vendors with their business names
        const vendorsRes = await query(`
            SELECT DISTINCT u.id, u.business_name
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            WHERE u.tenant_id = $1
            AND u.business_name IS NOT NULL
            AND (r.name = 'Vendor' OR u.email = 'admin@demo.com')
        `, [TENANT_ID]);

        let totalPruned = 0;

        for (const vendor of vendorsRes.rows) {
            const bizName = vendor.business_name;

            // Find products that have BOTH the literal name AND [BUSINESS_NAME] tag
            const products = await query(`
                SELECT id, name, tags 
                FROM products
                WHERE tenant_id = $1
                AND created_by = $2
                AND tags @> ARRAY['[BUSINESS_NAME]']
                AND tags @> ARRAY[$3]
            `, [TENANT_ID, vendor.id, bizName]);

            if (products.rows.length === 0) continue;

            console.log(`\nVendor: ${bizName} — ${products.rows.length} products to prune`);

            for (const p of products.rows) {
                // Remove the literal business name, keep [BUSINESS_NAME]
                const prunedTags = p.tags.filter(t => t !== bizName);

                await query(`
                    UPDATE products SET tags = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3
                `, [prunedTags, p.id, TENANT_ID]);

                totalPruned++;
                process.stdout.write('.');
            }
        }

        console.log(`\n\nPruned ${totalPruned} products. Rebuilding search index...`);

        const indexService = new IndexService();
        const result = await indexService.rebuildIndex(TENANT_ID);
        console.log(`Done. Indexed ${result.indexedCount} items.`);

    } catch (e) {
        console.error('Prune failed:', e.message);
    } finally {
        process.exit(0);
    }
}
prune();
