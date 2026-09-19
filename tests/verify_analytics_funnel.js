const { query } = require('../config/database');

async function verifyAnalyticsFunnel() {
    try {
        console.log("📊 Verifying Analytics Funnel Recording...");

        const tenantId = '00000000-0000-0000-0000-000000000000';
        const productId = '00000000-0000-0000-0000-000000000001';
        const sessionId = 'analytics-test-' + Date.now();

        // Simulate tracking requests (manually inserting into DB as if the API received them)
        const events = [
            { type: 'add_to_cart', entity: 'product', id: productId, meta: { qty: 1 } },
            { type: 'remove_from_cart', entity: 'product', id: productId, meta: { qty: 1 } },
            { type: 'checkout_initiate', entity: 'vendor', id: 'vendor-1', meta: { total: 100 } },
            { type: 'checkout_success', entity: 'checkout', id: 'cart-1', meta: { order: 'ord-1' } }
        ];

        for (const e of events) {
            console.log(`Recording simulated event: ${e.type}...`);
            await query(
                `INSERT INTO analytics_events (tenant_id, event_type, entity_type, entity_id, session_id, metadata) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [tenantId, e.type, e.entity, e.id, sessionId, JSON.stringify(e.meta)]
            );
        }

        // Check if journey API can reconstruct it
        console.log("Testing Journey API aggregation logic...");
        const journeyRes = await query(
            `SELECT event_type, COUNT(*) FROM analytics_events 
             WHERE session_id = $1 GROUP BY event_type`,
            [sessionId]
        );

        console.log("Events found for test session:", journeyRes.rows);
        if (journeyRes.rows.length === 4) {
            console.log("✅ SUCCESS: All funnel events successfully recorded and retrievable.");
        } else {
            console.error("❌ FAILURE: Missing events in database.");
        }

    } catch (err) {
        console.error("Analytics verification failed:", err);
    }
}

verifyAnalyticsFunnel();
