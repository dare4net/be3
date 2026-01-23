/**
 * Check Search Index Contents
 * Verify what's in the search index and if image_url is present
 */

const { query } = require('./config/database');

async function checkSearchIndex() {
    try {
        console.log('🔍 Checking search index...\n');

        // Get all products in search index
        const result = await query(`
            SELECT 
                content_type,
                title,
                metadata->'image_url' as image_url,
                metadata->'category_names' as category_names,
                metadata->'handle' as handle,
                tenant_id
            FROM search_indexes 
            WHERE content_type = 'product'
            LIMIT 5
        `);

        console.log(`Found ${result.rows.length} products in search index:\n`);

        result.rows.forEach((row, idx) => {
            console.log(`${idx + 1}. ${row.title}`);
            console.log(`   Tenant: ${row.tenant_id}`);
            console.log(`   Handle: ${row.handle}`);
            console.log(`   Image URL: ${row.image_url || 'NOT SET'}`);
            console.log(`   Categories: ${row.category_names || 'NOT SET'}\n`);
        });

        // Also check total counts
        const counts = await query(`
            SELECT content_type, COUNT(*) as count
            FROM search_indexes
            GROUP BY content_type
        `);

        console.log('Search index totals:');
        counts.rows.forEach(row => {
            console.log(`  ${row.content_type}: ${row.count}`);
        });

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

checkSearchIndex();
