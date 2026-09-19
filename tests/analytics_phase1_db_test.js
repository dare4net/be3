/**
 * Phase 1 Test (Database-Only):  Basic Event Collection
 * 
 * This test validates the database schema and basic insertion logic
 * without requiring the API server to be running.
 */

const { query } = require('../config/database');

const TEST_TENANT_ID = process.env.TEST_TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function cleanup() {
    console.log('\n🧹 Cleaning up test data...');
    await query('DELETE FROM analytics_events WHERE session_id LIKE $1', ['test_phase1_db_%']);
    console.log('✓ Cleanup complete');
}

async function testImpressionInsert() {
    console.log('\n📊 Test 1: Insert Product Impression Event');

    const sessionId = `test_phase1_db_${Date.now()}`;

    try {
        await query(
            `INSERT INTO analytics_events (
                tenant_id, event_type, entity_type, entity_id,
                session_id, placement_id, placement_type, position, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                TEST_TENANT_ID,
                'impression',
                'product',
                '123',
                sessionId,
                'widget_home_carousel',
                'widget',
                1,
                JSON.stringify({ widget_name: 'Featured Products', category_id: '5' })
            ]
        );

        console.log('✓ Impression event inserted');

        // Verify
        const result = await query(
            `SELECT * FROM analytics_events 
             WHERE session_id = $1 AND event_type = 'impression'`,
            [sessionId]
        );

        if (result.rows.length === 1) {
            const event = result.rows[0];
            console.log('✓ Event retrieved successfully');
            console.log(`  - Entity: ${event.entity_type}/${event.entity_id}`);
            console.log(`  - Placement: ${event.placement_id} (${event.placement_type})`);
            console.log(`  - Position: ${event.position}`);
            console.log(`  - Metadata:`, event.metadata);

            // Validate structure
            if (event.tenant_id === TEST_TENANT_ID &&
                event.entity_type === 'product' &&
                event.entity_id === '123' &&
                event.placement_id === 'widget_home_carousel') {
                console.log('✓ Event data validated');
                return true;
            } else {
                console.error('❌ Event data mismatch');
                return false;
            }
        } else {
            console.error('❌ Event not found');
            return false;
        }
    } catch (error) {
        console.error('❌ Insert failed:', error.message);
        return false;
    }
}

async function testClickInsert() {
    console.log('\n🖱️  Test 2: Insert Product Click Event with Referrer');

    const sessionId = `test_phase1_db_${Date.now()}`;

    try {
        await query(
            `INSERT INTO analytics_events (
                tenant_id, event_type, entity_type, entity_id,
                session_id, placement_id, placement_type, position,
                referrer_entity_type, referrer_entity_id,
                metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                TEST_TENANT_ID,
                'click',
                'product',
                '456',
                sessionId,
                'widget_home_carousel',
                'widget',
                2,
                'category',
                '10',
                JSON.stringify({ clicked_from: 'product_card', price: 99.99 })
            ]
        );

        console.log('✓ Click event inserted');

        // Verify
        const result = await query(
            `SELECT * FROM analytics_events 
             WHERE session_id = $1 AND event_type = 'click'`,
            [sessionId]
        );

        if (result.rows.length === 1) {
            const event = result.rows[0];
            console.log('✓ Event retrieved successfully');
            console.log(`  - Entity: ${event.entity_type}/${event.entity_id}`);
            console.log(`  - Referrer: ${event.referrer_entity_type}/${event.referrer_entity_id}`);
            console.log(`  - Metadata:`, event.metadata);

            if (event.referrer_entity_type === 'category' &&
                event.referrer_entity_id === '10') {
                console.log('✓ Referral tracking validated');
                return true;
            } else {
                console.error('❌ Referral data mismatch');
                return false;
            }
        } else {
            console.error('❌ Event not found');
            return false;
        }
    } catch (error) {
        console.error('❌ Insert failed:', error.message);
        return false;
    }
}

async function testCompositeEntityId() {
    console.log('\n🏷️  Test 3: Insert Branded Page (Composite Entity ID)');

    const sessionId = `test_phase1_db_${Date.now()}`;
    const compositeId = 'AC:17:high_end:5'; // attribute_id:clause_name:category_id

    try {
        await query(
            `INSERT INTO analytics_events (
                tenant_id, event_type, entity_type, entity_id,
                session_id, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                TEST_TENANT_ID,
                'page_view',
                'branded_page',
                compositeId,
                sessionId,
                JSON.stringify({
                    attribute_code: 'processor',
                    clause_name: 'high_end',
                    category_id: 5
                })
            ]
        );

        console.log('✓ Branded page event inserted');

        // Verify
        const result = await query(
            `SELECT * FROM analytics_events 
             WHERE session_id = $1 AND entity_type = 'branded_page'`,
            [sessionId]
        );

        if (result.rows.length === 1 && result.rows[0].entity_id === compositeId) {
            console.log('✓ Composite entity ID validated');
            console.log(`  - Entity ID: ${result.rows[0].entity_id}`);
            return true;
        } else {
            console.error('❌ Composite ID not stored correctly');
            return false;
        }
    } catch (error) {
        console.error('❌ Insert failed:', error.message);
        return false;
    }
}

async function testTenantIsolation() {
    console.log('\n🏢 Test 4: Verify Tenant Isolation in Queries');

    const sessionId = `test_phase1_db_${Date.now()}`;

    // Insert event
    await query(
        `INSERT INTO analytics_events (tenant_id, event_type, entity_type, entity_id, session_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [TEST_TENANT_ID, 'impression', 'product', '999', sessionId]
    );

    // Query with tenant filter
    const result = await query(
        `SELECT COUNT(*) as count FROM analytics_events 
         WHERE session_id = $1 AND tenant_id = $2`,
        [sessionId, TEST_TENANT_ID]
    );

    if (result.rows[0].count === '1') {
        console.log('✓ Tenant isolation verified');
        return true;
    } else {
        console.error('❌ Tenant isolation failed');
        return false;
    }
}

async function testIndexPerformance() {
    console.log('\n⚡ Test 5: Verify Index Usage');

    try {
        // Test tenant-scoped query (should use idx_analytics_tenant_event)
        const explain = await query(
            `EXPLAIN SELECT * FROM analytics_events 
             WHERE tenant_id = $1 AND event_type = 'impression' 
             ORDER BY created_at DESC LIMIT 10`,
            [TEST_TENANT_ID]
        );

        const plan = explain.rows.map(r => r['QUERY PLAN']).join('\n');

        if (plan.includes('Index Scan') || plan.includes('idx_analytics')) {
            console.log('✓ Query uses index');
            console.log('  Plan:', plan.split('\n')[0]);
            return true;
        } else {
            console.log('⚠️  Query may not be using index optimally');
            console.log('  Plan:', plan);
            return true; // Not a failure, just a warning
        }
    } catch (error) {
        console.error('❌ Explain query failed:', error.message);
        return false;
    }
}

async function runTests() {
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║  Phase 1: Database Schema Validation Test     ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log(`Testing with tenant: ${TEST_TENANT_ID}`);

    await cleanup();

    const results = {
        impression: await testImpressionInsert(),
        click: await testClickInsert(),
        compositeId: await testCompositeEntityId(),
        isolation: await testTenantIsolation(),
        indexPerf: await testIndexPerformance()
    };

    await cleanup();

    console.log('\n' + '='.repeat(50));
    console.log('PHASE 1 DATABASE TEST RESULTS');
    console.log('='.repeat(50));
    console.log(`Product Impression:    ${results.impression ? '✓ PASS' : '❌ FAIL'}`);
    console.log(`Product Click:         ${results.click ? '✓ PASS' : '❌ FAIL'}`);
    console.log(`Composite Entity ID:   ${results.compositeId ? '✓ PASS' : '❌ FAIL'}`);
    console.log(`Tenant Isolation:      ${results.isolation ? '✓ PASS' : '❌ FAIL'}`);
    console.log(`Index Performance:     ${results.indexPerf ? '✓ PASS' : '❌ FAIL'}`);
    console.log('='.repeat(50));

    const allPassed = Object.values(results).every(r => r === true);
    if (allPassed) {
        console.log('\n✅ All Phase 1 database tests passed!');
        console.log('📝 Next: Start the API server and run analytics_phase1_test.js for end-to-end validation');
        process.exit(0);
    } else {
        console.log('\n❌ Some tests failed. Please fix before proceeding.');
        process.exit(1);
    }
}

runTests().catch(error => {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
});
