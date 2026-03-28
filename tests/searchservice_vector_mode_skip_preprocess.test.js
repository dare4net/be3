const assert = require('assert');

const SearchService = require('../modules/search/services/SearchService');

async function run() {
    const service = new SearchService();

    // Monkeypatch: if preprocessQuery is called, fail the test.
    service.queryPreprocessor.preprocessQuery = async () => {
        throw new Error('preprocessQuery should not be called in vector mode');
    };

    // We don't need the vector engine to return results; we only verify preprocessing is skipped.
    // Use a query that previously triggered category inference.
    const tenantId = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

    try {
        await service.search(tenantId, {
            query: 'asus rog 8 gaming smartphone',
            contentTypes: ['product'],
            filters: { category_id: 'new-cat' },
            mode: 'vector',
            page: 1,
            perPage: 1
        });
    } catch (err) {
        // It's okay if vector search itself fails due to missing transformer/pgvector in some envs,
        // but it must NOT be our monkeypatch error.
        assert.ok(
            !String(err.message).includes('preprocessQuery should not be called'),
            err.message
        );
    }

    console.log('searchservice_vector_mode_skip_preprocess.test.js: PASS');
}

run().catch((err) => {
    console.error('searchservice_vector_mode_skip_preprocess.test.js: FAIL');
    console.error(err);
    process.exit(1);
});

