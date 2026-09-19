/**
 * Category Randomization Test — Pool Audit + 10 turns per source type
 * Usage: node scratch/test-category-randomization.js
 */

require('dotenv').config();
const randomizationService = require('../modules/search/services/RandomizationService');
const { query } = require('../config/database');

const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
const TURNS = 10;
const RANDOM_COUNT = 6;

function makeWidget(sourceType, extra = {}) {
    return {
        id: `test_widget_${sourceType}`,
        intent: {
            allowedTypes: ['category'],
            sourceType,
            randomCount: RANDOM_COUNT,
            count: RANDOM_COUNT,
            ...extra
        },
        config: {
            sourceType,
            randomize: { enabled: true },
            ...extra
        }
    };
}

async function runTurns(sourceType, widget) {
    const allTurns = [];
    const frequency = {};

    for (let turn = 1; turn <= TURNS; turn++) {
        const plan = await randomizationService.resolveMasterPlan(TENANT_ID, [widget], null);
        const result = plan[0];

        let picked = [];
        if (result.multiple) {
            picked = result.selections.map(s => s.selection).filter(Boolean);
        } else if (result.selection) {
            picked = [result.selection];
        }

        allTurns.push(picked);
        picked.forEach(cat => {
            frequency[cat.name] = (frequency[cat.name] || 0) + 1;
        });

        const names = picked.map(c => c.name);
        console.log(`  Turn ${String(turn).padStart(2, '0')}: ${names.join(', ') || '(empty)'}`);
    }

    // Always-present
    const sorted = Object.entries(frequency).sort((a, b) => b[1] - a[1]);
    const alwaysPresent = sorted.filter(([, c]) => c === TURNS).map(([n]) => n);
    const highFreq = sorted.filter(([, c]) => c >= Math.ceil(TURNS * 0.5) && c < TURNS).map(([n, c]) => `${n} (${c}/${TURNS})`);

    console.log(`\n  Frequency (top categories):`);
    sorted.slice(0, 8).forEach(([name, count]) => {
        const bar = '█'.repeat(count) + '░'.repeat(TURNS - count);
        console.log(`    ${bar}  [${count}/${TURNS}]  ${name}`);
    });

    if (alwaysPresent.length > 0) {
        console.log(`\n  ⚠️  APPEARED IN ALL ${TURNS} TURNS (pool likely too small):`);
        alwaysPresent.forEach(n => console.log(`    → ${n}`));
    } else {
        console.log(`\n  ✅  No category in all turns.`);
    }
    if (highFreq.length > 0) {
        console.log(`  ⚡ High-freq (≥50%): ${highFreq.join(', ')}`);
    }

    const unique = Object.keys(frequency).length;
    console.log(`  Unique seen: ${unique} — Pool coverage: ${((unique / (TURNS * RANDOM_COUNT)) * 100).toFixed(0)}% unique slots\n`);
}

async function auditPools() {
    console.log('\n════════════════════════════════════════════════════');
    console.log('  POOL SIZE AUDIT (categories with products, per source type)');
    console.log('════════════════════════════════════════════════════');

    // Full product-verified pool (what randomization service uses)
    const fullPool = await query(
        `SELECT c.id, c.name, c.parent_id
         FROM categories c
         WHERE c.tenant_id = $1 AND c.is_active = true
         AND EXISTS (
             SELECT 1 FROM search_indexes si
             WHERE si.tenant_id = $1 AND si.is_active = true
             AND si.content_type = 'product'
             AND si.metadata->'category_ids' ? c.id::text
         )
         ORDER BY c.name`,
        [TENANT_ID]
    );
    const all = fullPool.rows;
    const topLevel = all.filter(c => !c.parent_id);
    const subs = all.filter(c => c.parent_id);

    console.log(`  'all'             → ${all.length} categories with indexed products`);
    console.log(`  'top-level'       → ${topLevel.length} top-level categories (no parent)`);
    console.log(`  'all-subcategories' → ${subs.length} subcategories`);
    console.log(`\n  You are picking ${RANDOM_COUNT} per turn.`);

    if (topLevel.length <= RANDOM_COUNT + 2) {
        console.log(`\n  ⚠️  TOP-LEVEL POOL IS TINY! Only ${topLevel.length} categories, picking ${RANDOM_COUNT}.`);
        console.log(`     That means ${topLevel.length - RANDOM_COUNT} categories get swapped each turn — very little variety.`);
        console.log(`     Top-level categories: ${topLevel.map(c => c.name).join(', ')}`);
    }

    if (all.length > topLevel.length) {
        console.log(`\n  ℹ️  Switching to 'all' would expand pool from ${topLevel.length} → ${all.length} categories.`);
    }

    console.log('════════════════════════════════════════════════════\n');
    return { all, topLevel, subs };
}

async function main() {
    const { all, topLevel } = await auditPools();

    // Test top-level (what most widgets are likely using right now)
    console.log(`\n════════════════════════════════════════════════════`);
    console.log(`  SOURCE TYPE: 'top-level'  (pool size: ${topLevel.length})`);
    console.log(`════════════════════════════════════════════════════`);
    await runTurns('top-level', makeWidget('top-level'));

    // Test 'all' (new source type)
    console.log(`════════════════════════════════════════════════════`);
    console.log(`  SOURCE TYPE: 'all'  (pool size: ${all.length})`);
    console.log(`════════════════════════════════════════════════════`);
    await runTurns('all', makeWidget('all'));

    process.exit(0);
}

main().catch(err => {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
});


// Simulate a category widget intent (sourceType: 'all', randomCount: 6)
const WIDGET = {
    id: 'test_category_widget',
    intent: {
        allowedTypes: ['category'],
        sourceType: 'all',   // <-- the new source type
        randomCount: RANDOM_COUNT,
        count: RANDOM_COUNT
    },
    config: {
        sourceType: 'all',
        randomize: { enabled: true }
    }
};

function pad(str, len) {
    return String(str).padEnd(len, ' ').slice(0, len);
}

async function runTest() {
    const service = randomizationService;

    console.log('\n====================================================');
    console.log(`  CATEGORY RANDOMIZATION TEST — ${TURNS} turns`);
    console.log(`  Tenant: ${TENANT_ID}`);
    console.log(`  Widget count per turn: ${RANDOM_COUNT}`);
    console.log(`  Source type: all (product-verified pool)`);
    console.log('====================================================\n');

    const allTurns = [];
    const frequency = {};  // categoryName → how many turns it appeared

    for (let turn = 1; turn <= TURNS; turn++) {
        // Force a fresh plan every turn by calling resolveMasterPlan directly
        // (bypasses the 15-min cache bucket)
        const plan = await service.resolveMasterPlan(TENANT_ID, [WIDGET], null);
        const result = plan[0];

        let picked = [];
        if (result.multiple) {
            picked = result.selections.map(s => s.selection).filter(Boolean);
        } else if (result.selection) {
            picked = [result.selection];
        }

        allTurns.push(picked);

        // Track frequency
        picked.forEach(cat => {
            frequency[cat.name] = (frequency[cat.name] || 0) + 1;
        });

        const names = picked.map(c => c.name);
        console.log(`Turn ${String(turn).padStart(2, '0')}: ${names.join(', ')}`);
    }

    // ── Frequency Analysis ──────────────────────────────────────────────
    console.log('\n====================================================');
    console.log('  FREQUENCY TABLE (how many turns each category appeared)');
    console.log('====================================================');

    const sorted = Object.entries(frequency).sort((a, b) => b[1] - a[1]);
    const totalSlots = TURNS * RANDOM_COUNT;
    const uniqueCategories = sorted.length;

    sorted.forEach(([name, count]) => {
        const bar = '█'.repeat(count) + '░'.repeat(TURNS - count);
        const pct = ((count / TURNS) * 100).toFixed(0).padStart(3);
        console.log(`  ${bar}  ${pct}%  [${String(count).padStart(2)}/${TURNS}]  ${name}`);
    });

    // ── Summary ─────────────────────────────────────────────────────────
    console.log('\n====================================================');
    console.log('  SUMMARY');
    console.log('====================================================');
    console.log(`  Total slots filled:     ${allTurns.reduce((s, t) => s + t.length, 0)} / ${totalSlots}`);
    console.log(`  Unique categories seen: ${uniqueCategories}`);
    console.log(`  Pool utilisation:       ${((uniqueCategories / totalSlots) * 100).toFixed(1)}% unique across all turns`);

    // Always-present check
    const alwaysPresent = sorted.filter(([, c]) => c === TURNS).map(([n]) => n);
    const neverMissed = sorted.filter(([, c]) => c >= TURNS * 0.8).map(([n]) => n);

    if (alwaysPresent.length > 0) {
        console.log(`\n  ⚠️  ALWAYS PRESENT (appeared in ALL ${TURNS} turns):`);
        alwaysPresent.forEach(n => console.log(`     - ${n}`));
        console.log('  → These may indicate the pool is too small or sourceType filter is too narrow.');
    } else {
        console.log('\n  ✅  No category appeared in ALL turns — good diversity!');
    }

    if (neverMissed.length > 0 && alwaysPresent.length === 0) {
        console.log(`\n  ⚡ High-frequency categories (≥80% of turns):`);
        neverMissed.forEach(n => console.log(`     - ${n}`));
    }

    const appearedOnce = sorted.filter(([, c]) => c === 1).length;
    console.log(`\n  Categories that appeared exactly once: ${appearedOnce}`);
    console.log('====================================================\n');

    process.exit(0);
}

runTest().catch(err => {
    console.error('\n[ERROR]', err.message);
    console.error(err.stack);
    process.exit(1);
});
