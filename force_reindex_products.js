/**
 * Force Re-index Products with Image URLs
 * This will fetch products and re-index them with the updated metadata
 */

const { query } = require('./config/database');
const IndexService = require('./modules/search/services/IndexService');

async function forceReindexProducts() {
    try {
        console.log('🔄 Force re-indexing products with image URLs...\n');

        const indexService = new IndexService();

        // Get all products with their categories
        const productsResult = await query(`
            SELECT DISTINCT p.*
            FROM products p
        `);

        console.log(`Found ${productsResult.rows.length} products\n`);

        let reindexed = 0;

        for (const product of productsResult.rows) {
            try {
                // Get categories for this product
                const categoriesResult = await query(`
                    SELECT c.id, c.name, c.slug 
                    FROM categories c
                    JOIN product_categories pc ON c.id = pc.category_id
                    WHERE pc.product_id = $1
                `, [product.id]);

                product.categories = categoriesResult.rows;

                console.log(`Indexing: ${product.name}`);
                console.log(`  Image: ${product.image_url || '(none)'}`);
                console.log(`  Categories: ${product.categories.map(c => c.name).join(', ') || '(none)'}`);

                await indexService.indexProduct(product.tenant_id, product);
                reindexed++;
                console.log(`  ✓ Indexed\n`);
            } catch (error) {
                console.error(`  ✗ Error indexing ${product.name}:`, error.message, '\n');
            }
        }

        console.log(`\n✅ Re-indexed ${reindexed} products successfully!`);

        // Verify
        const check = await query(`
            SELECT 
                title,
                metadata->'image_url' as image_url,
                metadata->'category_names' as category_names
            FROM search_indexes 
            WHERE content_type = 'product'
            LIMIT 3
        `);

        console.log('\nSample indexed products:');
        check.rows.forEach(row => {
            console.log(`  - ${row.title}`);
            console.log(`    Image: ${row.image_url || 'NOT SET'}`);
            console.log(`    Categories: ${row.category_names || 'NOT SET'}`);
        });

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
}

forceReindexProducts();
