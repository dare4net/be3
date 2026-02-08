const { query } = require('../config/database');
const RandomizationService = require('../modules/search/services/RandomizationService');
const { redisClient } = require('../config/redis');

async function benchmark(label, fn) {
    const start = process.hrtime.bigint();
    const result = await fn();
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1_000_000;
    return { result, ms: ms.toFixed(3) };
}

async function verifySnapshots() {
    const service = RandomizationService;
    const tenantId = '34e3c420-a95b-4195-8749-94ed9a1836d5';
    const pageHandle = 'benchmark_home';
    const widgets = [
        {
            id: 'w1',
            intent: { allowedTypes: ['category'], count: 2 },
            config: { randomize: { enabled: true } }
        }
    ];

    // 0. Cleanup forcing a fresh Tier 3 resolution
    console.log('--- Phase 0: Cleanup (Forcing Tier 3 Compute) ---');
    await query('DELETE FROM randomization_snapshots WHERE tenant_id = $1 AND page_handle = $2', [tenantId, pageHandle]);
    if (redisClient && typeof redisClient.del === 'function') {
        const keys = await redisClient.keys(`randomization:snapshot:${tenantId}:${pageHandle}:*`);
        if (keys.length > 0) await redisClient.del(keys);
    }

    console.log('\n--- Phase 1: Tier 3 (Compute + Persist) ---');
    const t3 = await benchmark('T3', () => service.getSnapshotPlan(tenantId, pageHandle, widgets));
    console.log(`Time: ${t3.ms}ms`);

    console.log('\n--- Phase 2: Tier 1 (Redis Hit) ---');
    const t1 = await benchmark('T1', () => service.getSnapshotPlan(tenantId, pageHandle, widgets));
    console.log(`Time: ${t1.ms}ms`);

    console.log('\n--- Phase 3: Tier 2 (SQL Hit + Redis Warmup) ---');
    // Delete only Redis to force SQL lookup
    if (redisClient && typeof redisClient.del === 'function') {
        const keys = await redisClient.keys(`randomization:snapshot:${tenantId}:${pageHandle}:*`);
        if (keys.length > 0) await redisClient.del(keys);
    }
    const t2 = await benchmark('T2', () => service.getSnapshotPlan(tenantId, pageHandle, widgets));
    console.log(`Time: ${t2.ms}ms`);

    console.log('\n--- Final Results ---');
    console.log(`Tier 3 (Compute): ${t3.ms}ms`);
    console.log(`Tier 2 (SQL):     ${t2.ms}ms`);
    console.log(`Tier 1 (Redis):   ${t1.ms}ms`);

    const speedup = (Number(t3.ms) / Number(t1.ms)).toFixed(1);
    console.log(`\nRocket Speed: Redis is ${speedup}x faster than fresh compute! 🚀`);

    process.exit(0);
}

verifySnapshots().catch(err => {
    console.error(err);
    process.exit(1);
});
