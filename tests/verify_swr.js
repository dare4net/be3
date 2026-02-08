const fs = require('fs');
const logFile = 'swr_debug.log';
fs.writeFileSync(logFile, 'START OF TEST LOG\n');
function log(msg) {
    fs.appendFileSync(logFile, msg + '\n');
    console.log(msg);
}
log('START OF TEST SCRIPT');
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

async function verifySWR() {
    try {
        const service = RandomizationService;
        const tenantId = '34e3c420-a95b-4195-8749-94ed9a1836d5';
        const pageHandle = 'swr_test_page';
        const widgets = [
            {
                id: 'w1',
                intent: { allowedTypes: ['category'], count: 2 },
                config: { randomize: { enabled: true } }
            }
        ];

        // 1. Setup: Create a "previous" snapshot
        const minuteWindow = 15;
        const bucketTimestamp = Math.floor(Date.now() / (minuteWindow * 60 * 1000));
        const currentBucketKey = `15m_${bucketTimestamp}`;
        const prevBucketKey = `15m_${bucketTimestamp - 1}`;

        log(`--- Setup: Creating stale snapshot for ${prevBucketKey} ---`);
        const stalePlan = [{ widgetId: 'w1', resolvedType: 'stale_magic' }];
        await query(
            `INSERT INTO randomization_snapshots (tenant_id, page_handle, bucket_key, plan_data)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, page_handle, bucket_key) DO UPDATE SET plan_data = $4`,
            [tenantId, pageHandle, prevBucketKey, JSON.stringify(stalePlan)]
        );

        // Ensure current is MISSing
        await query('DELETE FROM randomization_snapshots WHERE tenant_id = $1 AND page_handle = $2 AND bucket_key = $3', [tenantId, pageHandle, currentBucketKey]);
        if (redisClient && typeof redisClient.del === 'function') {
            await redisClient.del(`randomization:snapshot:${tenantId}:${pageHandle}:${currentBucketKey}`);
            await redisClient.del(`randomization:snapshot:${tenantId}:${pageHandle}:${prevBucketKey}`);
        }

        log('\n--- Step 1: Request Current (Should Trigger SWR) ---');
        const { result: servedPlan, ms } = await benchmark('SWR_HIT', () => service.getSnapshotPlan(tenantId, pageHandle, widgets));

        log(`Time: ${ms}ms (Sub-10ms expected for stale SQL hit)`);
        log(`Served Plan: ${JSON.stringify(servedPlan)}`);

        const isStale = servedPlan[0].resolvedType === 'stale_magic';
        log(`Correctly served stale data: ${isStale ? '✅ YES' : '❌ NO'}`);

        log('\n--- Step 2: Wait for background revalidation ---');
        await new Promise(r => setTimeout(r, 2000)); // Give it 2 seconds

        const checkCurrent = await query(
            'SELECT plan_data FROM randomization_snapshots WHERE tenant_id = $1 AND page_handle = $2 AND bucket_key = $3',
            [tenantId, pageHandle, currentBucketKey]
        );

        const revalidated = checkCurrent.rows.length > 0;
        log(`Background revalidation successful (Current bucket exists): ${revalidated ? '✅ YES' : '❌ NO'}`);

        if (revalidated) {
            let planData = checkCurrent.rows[0].plan_data;
            if (typeof planData === 'string') {
                planData = JSON.parse(planData);
            }
            log(`New Plan Identity: ${planData[0].resolvedType || 'dynamic'}`);
        }

        // Cleanup
        await query('DELETE FROM randomization_snapshots WHERE tenant_id = $1 AND page_handle = $2', [tenantId, pageHandle]);
        process.exit(revalidated && isStale ? 0 : 1);
    } catch (err) {
        log('FATAL TEST ERROR:');
        log(err.stack || err);
        process.exit(1);
    }
}

verifySWR().catch(err => {
    log(err);
    process.exit(1);
});
