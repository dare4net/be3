const { query } = require('./config/database');
const SearchService = require('./modules/search/services/SearchService');

async function test() {
    try {
        const tenantRes = await query('SELECT id FROM tenants LIMIT 1');
        const tenantId = tenantRes.rows[0].id;
        const searchService = new SearchService();

        // 1. Find an attribute with a clause
        const attrRes = await query(`SELECT code, clauses FROM attributes WHERE clauses IS NOT NULL AND clauses != '[]' LIMIT 1`);
        if (attrRes.rows.length === 0) {
            console.log('No attributes with clauses found.');
            return;
        }

        const attrCode = attrRes.rows[0].code;
        const clauses = typeof attrRes.rows[0].clauses === 'string' ? JSON.parse(attrRes.rows[0].clauses) : attrRes.rows[0].clauses;
        const clauseName = clauses[0].name;

        console.log(`Testing with Attribute: ${attrCode}, Clause: ${clauseName}`);

        // 2. Perform search
        const filters = {};
        filters[`attribute.${attrCode}:${clauseName}`] = 1;

        const results = await searchService.search(tenantId, {
            filters,
            contentTypes: ['product']
        });

        console.log('--- Search Metadata ---');
        console.log('Category:', results.category?.name || 'MISSING');
        console.log('Clause:', results.clause?.name || 'MISSING');
        console.log('Result Count:', results.results.length);

        if (results.facets?.categories) {
            console.log('Eligible Categories (Facets):', Object.keys(results.facets.categories));
        }

    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        process.exit();
    }
}

test();
