const SearchService = require('./modules/search/services/SearchService');
const { query } = require('./config/database');

async function test() {
    const searchService = new SearchService();
    const tenantId = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

    // 1. Find a parent category with children and products
    const parents = await query(`
        SELECT c.id, c.name, COUNT(sub.id) as child_count
        FROM categories c
        JOIN categories sub ON sub.parent_id = c.id
        WHERE c.tenant_id = $1
        GROUP BY c.id, c.name
        HAVING COUNT(sub.id) > 0
        LIMIT 1
    `, [tenantId]);

    if (parents.rows.length === 0) {
        console.log('No parent categories found.');
        return;
    }

    const parent = parents.rows[0];
    console.log(`Testing Parent Category: ${parent.name} (${parent.id})`);

    // 2. Get descendants
    const descendants = await searchService.getDescendantCategoryIds(tenantId, parent.id);
    console.log(`Descendants found: ${descendants.length} (${descendants.join(', ')})`);

    // 3. Perform search using SearchService
    console.log('\n--- Performing Search ---');
    const results = await searchService.search(tenantId, {
        query: '',
        filters: { category_id: parent.id },
        contentTypes: ['product']
    });

    console.log(`Results found: ${results.results.length}`);
    results.results.forEach(r => {
        const meta = r.metadata || {};
        console.log(` - ${meta.name} (Categories: ${JSON.stringify(meta.category_ids)})`);
    });

    // 4. Manual check - how many products SHOULD match?
    const manualResult = await query(`
        SELECT COUNT(*) as total
        FROM search_indexes
        WHERE tenant_id = $1 
        AND content_type = 'product'
        AND (metadata->>'category_ids')::jsonb ?| $2
    `, [tenantId, descendants]);
    console.log(`\nManual count for any of these categories in index: ${manualResult.rows[0].total}`);
}

test().catch(console.error).finally(() => process.exit());
