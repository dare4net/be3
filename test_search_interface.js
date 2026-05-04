/**
 * Integration Test: Search Interface Service
 * 
 * Tests the be3_ai search module against a running backend.
 * Run: node test_search_interface.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/be3-ai';
const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
const headers = { 'X-Tenant-ID': TENANT_ID, 'Content-Type': 'application/json' };

const C = {
    reset: '\x1b[0m', bold: '\x1b[1m',
    green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m'
};

let passed = 0;
let failed = 0;

function assert(condition, msg, detail = '') {
    if (condition) {
        console.log(`  ${C.green}✓${C.reset} ${msg}`);
        passed++;
    } else {
        console.log(`  ${C.red}✗ FAIL: ${msg}${C.reset} ${detail ? `— ${detail}` : ''}`);
        failed++;
    }
}

async function run() {
    console.log(`\n${C.bold}${C.cyan}=== Search Interface Integration Tests ===${C.reset}\n`);

    // ─── Test 1: Basic query, no category (Stage 4 at minimum) ───
    console.log(`${C.bold}Test 1: Basic keyword query (no category)${C.reset}`);
    try {
        const res = await axios.post(`${BASE_URL}/search`, {
            tenantId: TENANT_ID,
            query: 'laptop',
            categories: [],
            categoryType: 'none',
            limit: 5
        }, { headers });

        assert(res.status === 200, 'Responds 200');
        assert(Array.isArray(res.data.products), 'Products array exists');
        assert(res.data.total > 0, `Found products (total: ${res.data.total})`);
        assert(res.data.classification !== undefined, `Classification: ${res.data.classification}`);
        assert(res.data.stage > 0, `Hit at stage ${res.data.stage}`);
        console.log(`  ${C.dim}Products: ${res.data.products.length}, Stage: ${res.data.stage}, Class: ${res.data.classification}${C.reset}`);
    } catch (e) {
        assert(false, 'Basic query', e.response?.data?.message || e.message);
    }

    // ─── Test 2: Query with single category ───
    console.log(`\n${C.bold}Test 2: Query with single category${C.reset}`);
    try {
        // First, find a category that has products
        const bloomRes = await axios.post('http://localhost:3000/bloom/test', { tokens: ['laptop'] }, { headers });
        
        const res = await axios.post(`${BASE_URL}/search`, {
            tenantId: TENANT_ID,
            query: 'gaming',
            categories: [{ id: '2538245c-6b41-4a66-acf4-2af88fc2783b', slug: 'gaming-laptops', label: 'Gaming Laptops', isWinner: true, isPartial: false }],
            categoryType: 'single',
            limit: 5
        }, { headers });

        assert(res.status === 200, 'Responds 200');
        assert(res.data.category_used !== null || res.data.total === 0, 'Category used is reported');
        console.log(`  ${C.dim}Total: ${res.data.total}, Stage: ${res.data.stage}, Category: ${JSON.stringify(res.data.category_used)}${C.reset}`);
    } catch (e) {
        assert(false, 'Single category query', e.response?.data?.message || e.message);
    }

    // ─── Test 3: Query that returns nothing → vector_fallback_needed ───
    console.log(`\n${C.bold}Test 3: Gibberish query → vector_fallback_needed${C.reset}`);
    try {
        const res = await axios.post(`${BASE_URL}/search`, {
            tenantId: TENANT_ID,
            query: 'xyznonexistent123 qwertyuiop789',
            categories: [],
            categoryType: 'none',
            limit: 5
        }, { headers });

        assert(res.data.total === 0, 'Zero results');
        assert(res.data.vector_fallback_needed === true, 'vector_fallback_needed is true');
        assert(res.data.classification === 'none', `Classification is "none" (got "${res.data.classification}")`);
    } catch (e) {
        assert(false, 'Gibberish query fallback', e.response?.data?.message || e.message);
    }

    // ─── Test 4: Price post-processing that passes ───
    console.log(`\n${C.bold}Test 4: Price filter that passes${C.reset}`);
    try {
        const res = await axios.post(`${BASE_URL}/search`, {
            tenantId: TENANT_ID,
            query: 'laptop',
            categories: [],
            categoryType: 'none',
            priceFilter: { min: 0, max: 999999 },
            limit: 5
        }, { headers });

        if (res.data.total > 0) {
            assert(res.data.price_filter_applied === true, 'Price filter applied');
            assert(res.data.price_filter_failed === false, 'Price filter did not fail');
        } else {
            assert(true, 'No products to price-filter (skip)');
        }
    } catch (e) {
        assert(false, 'Price filter pass', e.response?.data?.message || e.message);
    }

    // ─── Test 5: Price filter that eliminates all → revert ───
    console.log(`\n${C.bold}Test 5: Price filter eliminates all → revert${C.reset}`);
    try {
        const res = await axios.post(`${BASE_URL}/search`, {
            tenantId: TENANT_ID,
            query: 'laptop',
            categories: [],
            categoryType: 'none',
            priceFilter: { min: 99999999, max: 99999999 },
            limit: 5
        }, { headers });

        if (res.data.total > 0) {
            // Products exist but none match the absurd price
            assert(res.data.price_filter_failed === true, 'Price filter failed flag is true');
            assert(res.data.products.length > 0, 'Products returned (reverted to unfiltered)');
        } else {
            assert(true, 'No products in store to test (skip)');
        }
    } catch (e) {
        assert(false, 'Price filter revert', e.response?.data?.message || e.message);
    }

    // ─── Test 6: Multiple categories — multi-loop execution ───
    console.log(`\n${C.bold}Test 6: Multiple category candidates — multi-loop${C.reset}`);
    try {
        // Send 3 sibling categories under Smartphones & Tablets — forces multi-category loop
        const res = await axios.post(`${BASE_URL}/search`, {
            tenantId: TENANT_ID,
            query: 'phone',
            categories: [
                { id: '7b8b5bb4-7878-4203-a550-a0941e1e3eb9', slug: 'smartphones', label: 'Smartphones', isWinner: true, isPartial: false },
                { id: 'c28c4ba9-8160-4905-84d4-dc8f30bd070f', slug: 'phone-accessories', label: 'Phone Accessories', isWinner: false, isPartial: false },
                { id: '045389eb-03ba-4466-bed3-3343870d547a', slug: 'feature-phones', label: 'Feature Phones', isWinner: false, isPartial: false }
            ],
            categoryType: 'multiple',
            limit: 5
        }, { headers });

        assert(res.status === 200, 'Responds 200');
        assert(res.data.classification !== undefined, `Classification: ${res.data.classification}`);
        console.log(`  ${C.dim}Total: ${res.data.total}, Stage: ${res.data.stage}, Category: ${JSON.stringify(res.data.category_used)}${C.reset}`);
    } catch (e) {
        assert(false, 'Multiple categories multi-loop', e.response?.data?.message || e.message);
    }

    // ─── Test 7: Multiple categories with parent-child dedup (SearchInterface) ───
    console.log(`\n${C.bold}Test 7: Multiple categories — parent-child should be handled by caller${C.reset}`);
    try {
        // Send parent + children — SearchInterface executes as given, dedup is caller's job
        // Winner (Smartphones) is a child of Smartphones & Tablets but remains because it's the winner
        const res = await axios.post(`${BASE_URL}/search`, {
            tenantId: TENANT_ID,
            query: 'samsung',
            categories: [
                { id: '7b8b5bb4-7878-4203-a550-a0941e1e3eb9', slug: 'smartphones', label: 'Smartphones', isWinner: true, isPartial: false },
                { id: 'd8aed750-6164-4065-881c-652ef888179f', slug: 'smartphones-tablets', label: 'Smartphones & Tablets', isWinner: false, isPartial: false }
            ],
            categoryType: 'multiple',
            limit: 5
        }, { headers });

        assert(res.status === 200, 'Responds 200');
        assert(res.data.stage > 0 || res.data.total === 0, `Search executed (stage: ${res.data.stage})`);
        console.log(`  ${C.dim}Total: ${res.data.total}, Stage: ${res.data.stage}, Category: ${JSON.stringify(res.data.category_used)}${C.reset}`);
    } catch (e) {
        assert(false, 'Parent-child dedup', e.response?.data?.message || e.message);
    }

    // ─── Test 8: Single candidate with attributes (stage waterfall) ───
    console.log(`\n${C.bold}Test 8: Single category + vendor attribute — stage waterfall${C.reset}`);
    try {
        const res = await axios.post(`${BASE_URL}/search`, {
            tenantId: TENANT_ID,
            query: 'laptop',
            categories: [
                { id: 'f98da916-f2bc-4535-bc68-54ec1233c256', slug: 'laptops', label: 'Laptops', isWinner: true, isPartial: false }
            ],
            categoryType: 'single',
            attributes: { vendor: 'Dell' },
            limit: 5
        }, { headers });

        assert(res.status === 200, 'Responds 200');
        assert(res.data.stage > 0 || res.data.total === 0, `Hit at stage ${res.data.stage}`);
        console.log(`  ${C.dim}Total: ${res.data.total}, Stage: ${res.data.stage}, Class: ${res.data.classification}${C.reset}`);
    } catch (e) {
        assert(false, 'Single category + vendor', e.response?.data?.message || e.message);
    }

    // ─── Summary ───
    console.log(`\n${C.bold}${C.cyan}═══════════════════════════${C.reset}`);
    console.log(`  ${C.green}Passed: ${passed}${C.reset}  ${failed > 0 ? `${C.red}Failed: ${failed}${C.reset}` : ''}`);
    console.log(`${C.bold}${C.cyan}═══════════════════════════${C.reset}\n`);

    if (failed > 0) process.exitCode = 1;
}

run().catch(e => {
    console.error(`\n${C.red}Fatal: ${e.message}${C.reset}`);
    process.exitCode = 1;
});
