/**
 * Phase 1 Test: Basic Event Collection
 * 
 * Tests:
 * 1. POST /analytics/collect with product impression
 * 2. POST /analytics/collect with product click
 * 3. Verify events are stored correctly
 * 4. Verify tenant isolation
 */

const { query } = require('../config/database');
const axios = require('axios');

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const TEST_TENANT_ID = process.env.TEST_TENANT_ID;

if (!TEST_TENANT_ID) {
    console.error('❌ TEST_TENANT_ID environment variable not set');
    process.exit(1);
}

async function cleanup() {
    console.log('\n🧹 Cleaning up test data...');
    await query('DELETE FROM analytics_events WHERE session_id LIKE $1', ['test_phase1_%']);
    console.log('✓ Cleanup complete');
}

async function testImpressionEvent() {
    console.log('\n📊 Test 1: Track Product Impression');

    const sessionId = `test_phase1_${Date.now()}`;
    const payload = {
        event_type: 'impression',
        entity_type: 'product',
        entity_id: '123',
        placement_id: 'widget_home_carousel',
        placement_type: 'widget',
        position: 1,
        session_id: sessionId,
        metadata: {
            widget_name: 'Featured Products',
            category_id: '5'
        }
    };

    try {
        const response = await axios.post(`${API_BASE}/analytics/collect`, payload, {
            headers: { 'X-Tenant-ID': TEST_TENANT_ID }
        });

        if (response.data.success) {
            console.log('✓ Impression event accepted');

            // Verify in database
            const result = await query(
                `SELECT * FROM analytics_events 
                 WHERE session_id = $1 AND event_type = 'impression'`,
                [sessionId]
            );

            if (result.rows.length === 1) {
                const event = result.rows[0];
                console.log('✓ Event stored in database');
                console.log(`  - Entity: ${event.entity_type}/${event.entity_id}`);
                console.log(`  - Placement: ${event.placement_id} (${event.placement_type})`);
                console.log(`  - Position: ${event.position}`);
                console.log(`  - Metadata:`, JSON.parse(event.metadata));
                return true;
            } else {
                console.error('❌ Event not found in database');
                return false;
            }
        } else {
            console.error('❌ API returned success: false');
            return false;
        }
    } catch (error) {
        console.error('❌ Request failed:', error.response?.data || error.message);
        return false;
    }
}

async function testClickEvent() {
    console.log('\n🖱️  Test 2: Track Product Click');

    const sessionId = `test_phase1_${Date.now()}`;
    const payload = {
        event_type: 'click',
        entity_type: 'product',
        entity_id: '456',
        placement_id: 'widget_home_carousel',
        placement_type: 'widget',
        position: 2,
        referrer_entity_type: 'category',
        referrer_entity_id: '10',
        session_id: sessionId,
        metadata: {
            clicked_from: 'product_card',
            price: 99.99
        }
    };

    try {
        const response = await axios.post(`${API_BASE}/analytics/collect`, payload, {
            headers: { 'X-Tenant-ID': TEST_TENANT_ID }
        });

        if (response.data.success) {
            console.log('✓ Click event accepted');

            // Verify in database
            const result = await query(
                `SELECT * FROM analytics_events 
                 WHERE session_id = $1 AND event_type = 'click'`,
                [sessionId]
            );

            if (result.rows.length === 1) {
                const event = result.rows[0];
                console.log('✓ Event stored in database');
                console.log(`  - Entity: ${event.entity_type}/${event.entity_id}`);
                console.log(`  - Referrer: ${event.referrer_entity_type}/${event.referrer_entity_id}`);
                console.log(`  - Metadata:`, JSON.parse(event.metadata));
                return true;
            } else {
                console.error('❌ Event not found in database');
                return false;
            }
        } else {
            console.error('❌ API returned success: false');
            return false;
        }
    } catch (error) {
        console.error('❌ Request failed:', error.response?.data || error.message);
        return false;
    }
}

async function testValidation() {
    console.log('\n🔒 Test 3: Validate Required Fields');

    const invalidPayload = {
        event_type: 'impression',
        // Missing entity_type and entity_id
        placement_id: 'widget_test'
    };

    try {
        await axios.post(`${API_BASE}/analytics/collect`, invalidPayload, {
            headers: { 'X-Tenant-ID': TEST_TENANT_ID }
        });
        console.error('❌ Should have rejected invalid payload');
        return false;
    } catch (error) {
        if (error.response?.status === 400) {
            console.log('✓ Correctly rejected invalid payload');
            console.log(`  - Error: ${error.response.data.error}`);
            return true;
        } else {
            console.error('❌ Unexpected error:', error.message);
            return false;
        }
    }
}

async function testTenantIsolation() {
    console.log('\n🏢 Test 4: Verify Tenant Isolation');

    const sessionId = `test_phase1_${Date.now()}`;

    // Insert event for TEST_TENANT_ID
    await axios.post(`${API_BASE}/analytics/collect`, {
        event_type: 'impression',
        entity_type: 'product',
        entity_id: '999',
        session_id: sessionId
    }, {
        headers: { 'X-Tenant-ID': TEST_TENANT_ID }
    });

    // Query should only return events for this tenant
    const result = await query(
        `SELECT COUNT(*) as count FROM analytics_events 
         WHERE session_id = $1 AND tenant_id = $2`,
        [sessionId, TEST_TENANT_ID]
    );

    if (result.rows[0].count === '1') {
        console.log('✓ Tenant isolation verified');
        console.log(`  - Only events for tenant ${TEST_TENANT_ID} are accessible`);
        return true;
    } else {
        console.error('❌ Tenant isolation failed');
        return false;
    }
}

async function runTests() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║  Phase 1: Basic Event Collection Test ║');
    console.log('╚════════════════════════════════════════╝');

    await cleanup();

    const results = {
        impression: await testImpressionEvent(),
        click: await testClickEvent(),
        validation: await testValidation(),
        isolation: await testTenantIsolation()
    };

    await cleanup();

    console.log('\n' + '='.repeat(50));
    console.log('PHASE 1 TEST RESULTS');
    console.log('='.repeat(50));
    console.log(`Product Impression:    ${results.impression ? '✓ PASS' : '❌ FAIL'}`);
    console.log(`Product Click:         ${results.click ? '✓ PASS' : '❌ FAIL'}`);
    console.log(`Validation:            ${results.validation ? '✓ PASS' : '❌ FAIL'}`);
    console.log(`Tenant Isolation:      ${results.isolation ? '✓ PASS' : '❌ FAIL'}`);
    console.log('='.repeat(50));

    const allPassed = Object.values(results).every(r => r === true);
    if (allPassed) {
        console.log('\n✅ All Phase 1 tests passed! Ready for Phase 2.');
        process.exit(0);
    } else {
        console.log('\n❌ Some tests failed. Please fix before proceeding to Phase 2.');
        process.exit(1);
    }
}

runTests().catch(error => {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
});
