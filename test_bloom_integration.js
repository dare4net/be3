/**
 * Integration Test: Bloom Module
 * 
 * Tests the full bloom module against a running backend.
 * Run: node test_bloom_integration.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/bloom';
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
    console.log(`\n${C.bold}${C.cyan}=== Bloom Module Integration Tests ===${C.reset}\n`);
    console.log(`${C.dim}Backend: ${BASE_URL}${C.reset}`);
    console.log(`${C.dim}Tenant:  ${TENANT_ID}${C.reset}\n`);

    // ─── Test 1: Health (before rebuild — might be empty) ───
    console.log(`${C.bold}Test 1: Health check (pre-rebuild)${C.reset}`);
    try {
        const healthRes = await axios.get(`${BASE_URL}/health`, { headers });
        assert(healthRes.status === 200, 'Health endpoint responds 200');
        console.log(`  ${C.dim}Has filter: ${healthRes.data.hasGlobalFilter}${C.reset}`);
    } catch (e) {
        assert(false, 'Health endpoint responds', e.message);
    }

    // ─── Test 2: Full Rebuild ───
    console.log(`\n${C.bold}Test 2: Full rebuild${C.reset}`);
    let rebuildResult;
    try {
        const rebuildRes = await axios.post(`${BASE_URL}/rebuild`, {}, { headers, timeout: 120000 });
        rebuildResult = rebuildRes.data;
        assert(rebuildRes.status === 200, 'Rebuild responds 200');
        assert(rebuildResult.success === true, 'Rebuild success flag is true');

        const g = rebuildResult.global;
        assert(g && g.stats, 'Global filter stats exist');
        if (g && g.stats) {
            console.log(`  ${C.dim}Global: ${g.stats.itemCount} tokens, ${g.stats.byteSize} bytes, FPR: ${g.stats.estimatedFPR}${C.reset}`);
        }
        if (g && g.sources) {
            console.log(`  ${C.dim}Sources: ${JSON.stringify(g.sources)}${C.reset}`);
        }

        assert(Array.isArray(rebuildResult.categories), 'Category filters array exists');
        console.log(`  ${C.dim}Category filters built: ${rebuildResult.categories?.length || 0}${C.reset}`);
    } catch (e) {
        assert(false, 'Rebuild completes without error', e.response?.data?.message || e.message);
    }

    // ─── Test 3: Health (after rebuild) ───
    console.log(`\n${C.bold}Test 3: Health check (post-rebuild)${C.reset}`);
    try {
        const healthRes = await axios.get(`${BASE_URL}/health`, { headers });
        assert(healthRes.data.hasGlobalFilter === true, 'Global filter now exists');
        assert(healthRes.data.lastRebuild !== null, 'Last rebuild timestamp is set');
        assert(healthRes.data.globalStats?.itemCount > 0, `Token count > 0 (got ${healthRes.data.globalStats?.itemCount})`);
    } catch (e) {
        assert(false, 'Health check after rebuild', e.message);
    }

    // ─── Test 4: Test known tokens (should pass) ───
    console.log(`\n${C.bold}Test 4: Test known tokens via admin /test${C.reset}`);
    try {
        // Use generic tokens that should be in any eCommerce store
        const testRes = await axios.post(`${BASE_URL}/test`, { tokens: ['laptop', 'phone', 'gaming'] }, { headers });
        assert(testRes.status === 200, 'Test endpoint responds 200');
        const g = testRes.data.global;
        console.log(`  ${C.dim}Hits: [${g.hits.join(', ')}] | Misses: [${g.misses.join(', ')}]${C.reset}`);
        // At least something should exist in the store
        assert(g.hits.length > 0 || g.misses.length > 0, 'Results contain hits or misses (not empty)');
    } catch (e) {
        assert(false, 'Admin test endpoint', e.message);
    }

    // ─── Test 5: Test garbage tokens (should fail) ───
    console.log(`\n${C.bold}Test 5: Test garbage tokens (should miss)${C.reset}`);
    try {
        const testRes = await axios.post(`${BASE_URL}/test`, 
            { tokens: ['xyznonexistent123', 'qwertyuiop789', 'zzzznotaproduct'] }, { headers });
        const g = testRes.data.global;
        assert(g.passed === false, 'Garbage tokens should NOT pass');
        assert(g.misses.length === 3, `All 3 should miss (got ${g.misses.length})`);
        console.log(`  ${C.dim}Misses: [${g.misses.join(', ')}]${C.reset}`);
    } catch (e) {
        assert(false, 'Garbage token test', e.message);
    }

    // ─── Test 6: AI endpoint batch check ───
    console.log(`\n${C.bold}Test 6: AI endpoint /ai/check${C.reset}`);
    try {
        // Get a category ID from the rebuild results
        let catId = null;
        if (rebuildResult?.categories?.length > 0) {
            catId = rebuildResult.categories[0].categoryId;
        }

        const body = {
            tenantId: TENANT_ID,
            tokens: ['dell', 'laptop', 'xyzfake'],
            candidateCategories: catId ? [catId] : []
        };

        const aiRes = await axios.post(`${BASE_URL}/ai/check`, body, { headers });
        assert(aiRes.status === 200, 'AI check endpoint responds 200');

        const g = aiRes.data.global;
        assert(g !== undefined, 'Global result present');
        console.log(`  ${C.dim}Global — passed: ${g.passed}, hits: [${g.hits.join(', ')}], misses: [${g.misses.join(', ')}]${C.reset}`);

        if (catId) {
            const catResult = aiRes.data.categories[catId];
            assert(catResult !== undefined, `Category result for ${catId} present`);
            console.log(`  ${C.dim}Category ${catId.substring(0, 8)}... — passed: ${catResult?.passed}, hits: [${catResult?.hits?.join(', ')}]${C.reset}`);
        }
    } catch (e) {
        assert(false, 'AI batch check', e.response?.data?.message || e.message);
    }

    // ─── Summary ───
    console.log(`\n${C.bold}${C.cyan}═══════════════════════════${C.reset}`);
    console.log(`  ${C.green}Passed: ${passed}${C.reset}  ${failed > 0 ? `${C.red}Failed: ${failed}${C.reset}` : ''}`);
    console.log(`${C.bold}${C.cyan}═══════════════════════════${C.reset}\n`);

    if (failed > 0) process.exitCode = 1;
}

run().catch(e => {
    console.error(`\n${C.red}Fatal error: ${e.message}${C.reset}`);
    if (e.code === 'ECONNREFUSED') {
        console.error(`${C.yellow}Make sure the backend is running on ${BASE_URL}${C.reset}`);
    }
    process.exitCode = 1;
});
