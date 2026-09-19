const db = require('../config/database');
const cache = require('../modules/search/services/ClauseImageCache');

(async () => {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

    // Test multiple clause/category pairs
    const tests = [
        { attr: 'b', value: 'apple', label: 'Brand: Apple' },
        { attr: 'b', value: 'samsung', label: 'Brand: Samsung' },
        { attr: 'gender', value: 'female', label: 'Gender: Female' },
        { attr: 'c', value: 'blue', label: 'Color: Blue' },
        { attr: 'p', value: 'premium', label: 'Price Tier: Premium' },
    ];

    for (const test of tests) {
        // Find a category that has products with this attribute value
        const catRes = await db.query(
            `SELECT DISTINCT (jsonb_array_elements_text(si.metadata->'category_ids')) AS cat_id
             FROM search_indexes si
             WHERE si.tenant_id = $1 AND si.is_active = true AND si.content_type = 'product'
               AND LOWER(si.metadata->'attributes'->>$2) = LOWER($3)
             LIMIT 1`,
            [tenantId, test.attr, test.value]
        );

        if (catRes.rows.length === 0) {
            console.log(`❌ ${test.label}: No products found with ${test.attr}=${test.value}`);
            continue;
        }

        const catId = catRes.rows[0].cat_id;
        const catName = await db.query(`SELECT name FROM categories WHERE id = $1`, [catId]);

        const img1 = await cache.getClauseImage(tenantId, catId, test.attr, test.value);
        const img2 = await cache.getClauseImage(tenantId, catId, test.attr, test.value);

        const status = img1 === img2 ? '✅' : '❌';
        console.log(`${status} ${test.label} in "${catName.rows[0]?.name}"`);
        console.log(`   Image: ${img1 || '(no image)'}`);
        console.log(`   Cache: ${img1 === img2 ? 'HIT' : 'MISMATCH'}`);
        console.log('');
    }

    process.exit(0);
})();
