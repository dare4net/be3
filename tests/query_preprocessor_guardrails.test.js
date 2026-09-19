const assert = require('assert');

const QueryPreprocessor = require('../modules/search/core/query/QueryPreprocessor');

const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
// Observed "Gaming" category id from earlier debug logs.
const GAMING_CATEGORY_ID = '63efd70e-2daf-46f9-b801-d9da53209930';

async function run() {
    const qp = new QueryPreprocessor();

    // 1) Category inference should strip only category-matched tokens (not everything).
    {
        const input = 'asus rog 8 gaming smartphone';
        const { processedQuery, additionalFilters } = await qp.preprocessQuery(TENANT_ID, input, null);

        assert.ok(processedQuery.includes('asus') && processedQuery.includes('rog') && processedQuery.includes('smartphone'),
            'Non-category tokens should remain after category stripping');
        assert.ok(!processedQuery.includes('gaming'), 'Category token should be stripped when inference is used');
        assert.ok(additionalFilters && additionalFilters.category_id, 'Category detection should infer category_id');
    }

    // 2) Category inference should be allowed to strip all matched tokens (even to empty).
    {
        const input = 'something for gaming game';
        const { processedQuery, additionalFilters } = await qp.preprocessQuery(TENANT_ID, input, null);

        assert.ok(!processedQuery.includes('gaming'), 'Category token should be stripped');
        // "game" is not a direct match for category name/slug "gaming", so it should remain.
        assert.ok(processedQuery.includes('game'), 'Non-matched token should remain in query');
        assert.ok(additionalFilters && additionalFilters.category_id, 'Category detection should infer category_id');
    }

    // 3) If categoryId is already known, we should not strip category tokens or infer category_id.
    {
        const input = 'something for gaming game';
        const { processedQuery, additionalFilters } = await qp.preprocessQuery(TENANT_ID, input, GAMING_CATEGORY_ID);

        assert.strictEqual(processedQuery, input, 'When categoryId is known, processedQuery should stay intact (no stripping)');
        assert.ok(!additionalFilters || !additionalFilters.category_id, 'When categoryId is known, should not infer category_id');
    }

    // 4) Attribute inference should strip matched tokens when used, and allow filter-only search downstream.
    {
        const input = 'white';
        const { processedQuery, additionalFilters } = await qp.preprocessQuery(TENANT_ID, input, GAMING_CATEGORY_ID);

        assert.strictEqual(processedQuery, '', 'Used attribute inference may strip query to empty');
        const keys = Object.keys(additionalFilters || {});
        assert.ok(keys.some(k => k.startsWith('attribute.')), 'Attribute inference should produce attribute.* filters');
    }

    // 5) If an explicit attribute filter exists for a code, inference should not strip or add a duplicate.
    {
        const input = 'white';
        const explicit = { 'attribute.c': 'black' };
        const { processedQuery, additionalFilters } = await qp.preprocessQuery(TENANT_ID, input, GAMING_CATEGORY_ID, explicit);
        assert.strictEqual(processedQuery, input, 'Explicit attribute should prevent stripping of inferred matches');
        assert.strictEqual(Object.keys(additionalFilters || {}).length, 0, 'Explicit attribute should prevent adding inferred filters for that code');
    }

    console.log('query_preprocessor_guardrails.test.js: PASS');
}

run().catch((err) => {
    console.error('query_preprocessor_guardrails.test.js: FAIL');
    console.error(err);
    process.exit(1);
});

