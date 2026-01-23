/**
 * Final Verification - Check search index metadata properly
 */

const { query } = require('./config/database');

async function verify() {
    try {
        const result = await query(`
            SELECT 
                title,
                metadata
            FROM search_indexes 
            WHERE content_type = 'product'
            AND metadata->>'image_url' IS NOT NULL
            LIMIT 5
        `);

        console.log('\n✅ Products with images in search index:\n');
        result.rows.forEach(row => {
            const meta = row.metadata;
            console.log(`${row.title}:`);
            console.log(`  Image: ${meta.image_url || '(none)'}`);
            console.log(`  Categories: ${(meta.category_names || []).join(', ')}`);
            console.log(``);
        });

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

verify();
