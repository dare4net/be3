/**
 * Re-index Categories with Images
 */

const { query } = require('./config/database');
const IndexService = require('./modules/search/services/IndexService');

async function reindexCategories() {
    try {
        console.log('🔄 Re-indexing categories with images...\n');

        const indexService = new IndexService();

        // Get all categories
        const categoriesResult = await query(`
            SELECT * FROM categories
        `);

        console.log(`Found ${categoriesResult.rows.length} categories\n`);

        let reindexed = 0;

        for (const category of categoriesResult.rows) {
            try {
                console.log(`Indexing: ${category.name}`);
                console.log(`  Image: ${category.image_url || '(none)'}`);

                await indexService.indexCategory(category.tenant_id, category);
                reindexed++;
                console.log(`  ✓ Indexed\n`);
            } catch (error) {
                console.error(`  ✗ Error indexing ${category.name}:`, error.message, '\n');
            }
        }

        console.log(`\n✅ Re-indexed ${reindexed} categories successfully!`);

        // Verify
        const check = await query(`
            SELECT 
                title,
                metadata
            FROM search_indexes 
            WHERE content_type = 'category'
            AND metadata->>'image_url' IS NOT NULL
            LIMIT 3
        `);

        console.log('\nCategories with images:');
        check.rows.forEach(row => {
            console.log(`  - ${row.title}: ${row.metadata.image_url}`);
        });

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
}

reindexCategories();
