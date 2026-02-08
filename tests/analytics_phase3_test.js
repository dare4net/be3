const { query } = require('../config/database');
const axios = require('axios');
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Test Data
const TENANT_ID = '3d5a4944-595d-4444-9333-333333333333'; // Using a distinct test tenant for Phase 3
const SESSION_ID = `test_sess_${Date.now()}`;

async function runPhase3Tests() {
    console.log('🚀 Starting Phase 3 (Advanced Analytics) Tests...');
    console.log(`target: ${API_BASE}`);
    console.log(`tenant: ${TENANT_ID}`);
    console.log(`session: ${SESSION_ID}`);

    let errors = 0;

    const assert = (condition, message) => {
        if (condition) {
            console.log(`✅ ${message}`);
        } else {
            console.error(`❌ ${message}`);
            errors++;
        }
    };

    try {
        // --- Setup: Ensure Tenant Exists (Logic omitted, assuming existing or auto-create handling in real app, but for test we rely on DB or mock)
        // Actually, we should probably just send events. The backend checks for tenant existence usually? 
        // In Phase 1 test, we used a valid tenant. Let's use the one from Phase 1 if possible or just assume it works if no FK constraint.
        // Re-using Phase 1 tenant might be safer: '1a2b3c4d-1234-5678-90ab-cdef12345678'
        // But let's stick to the one defined above and see. If it fails, I'll update.

        // 1. Validate "Page View" with Referral (Category Carousel -> Category Page)
        console.log('\n--- Test 1: Page View with Referral ---');
        const pageViewPayload = {
            event_type: 'page_view',
            entity_type: 'category',
            entity_id: 'cat_123',
            session_id: SESSION_ID,
            referrer_entity_type: 'widget',
            referrer_entity_id: 'category_carousel_widget',
            referrer_url: 'http://localhost:3000/',
            metadata: { page_title: 'Electronics', slug: 'electronics' }
        };

        const res1 = await axios.post(`${API_BASE}/analytics/collect`, pageViewPayload, {
            headers: { 'X-Tenant-ID': TENANT_ID }
        });
        assert(res1.status === 200, 'Page View event collected successfully');

        // Verify in DB
        const dbRes1 = await query(
            `SELECT * FROM analytics_events WHERE session_id = $1 AND event_type = 'page_view' AND entity_id = 'cat_123'`,
            [SESSION_ID]
        );
        assert(dbRes1.rows.length === 1, 'Page View record found in DB');
        assert(dbRes1.rows[0].referrer_entity_type === 'widget', 'Referrer Entity Type saved correctly');
        assert(dbRes1.rows[0].referrer_entity_id === 'category_carousel_widget', 'Referrer Entity ID saved correctly');


        // 2. Validate "Branded Page" Tracking (Composite Entity ID)
        console.log('\n--- Test 2: Branded Page (Composite ID) ---');
        const compositeId = 'AC:10:high_end:55'; // Attribute:10, Clause:high_end, Category:55
        const brandedPagePayload = {
            event_type: 'page_view',
            entity_type: 'branded_page',
            entity_id: compositeId,
            session_id: SESSION_ID,
            metadata: { page_title: 'High End Electronics' }
        };

        await axios.post(`${API_BASE}/analytics/collect`, brandedPagePayload, {
            headers: { 'X-Tenant-ID': TENANT_ID }
        });

        const dbRes2 = await query(
            `SELECT * FROM analytics_events WHERE session_id = $1 AND entity_id = $2`,
            [SESSION_ID, compositeId]
        );
        assert(dbRes2.rows.length === 1, 'Branded Page view recorded');
        assert(dbRes2.rows[0].entity_type === 'branded_page', 'Entity Type is branded_page');


        // 3. Validate "Search Autocomplete" Flow (Impression -> Click)
        console.log('\n--- Test 3: Search Autocomplete Flow ---');

        // 3a. Impression
        const searchImpPayload = {
            event_type: 'impression',
            entity_type: 'product',
            entity_id: 'prod_999',
            placement_id: 'search_autocomplete',
            placement_type: 'search',
            position: 1,
            session_id: SESSION_ID,
            metadata: { term: 'iph', suggestion_text: 'iPhone 15' }
        };
        await axios.post(`${API_BASE}/analytics/collect`, searchImpPayload, { headers: { 'X-Tenant-ID': TENANT_ID } });

        // 3b. Click
        const searchClickPayload = {
            event_type: 'click',
            entity_type: 'product',
            entity_id: 'prod_999',
            placement_id: 'search_autocomplete',
            placement_type: 'search',
            position: 1,
            session_id: SESSION_ID,
            metadata: { term: 'iph', suggestion_text: 'iPhone 15' }
        };
        await axios.post(`${API_BASE}/analytics/collect`, searchClickPayload, { headers: { 'X-Tenant-ID': TENANT_ID } });

        const dbRes3 = await query(
            `SELECT * FROM analytics_events WHERE session_id = $1 AND placement_id = 'search_autocomplete' ORDER BY created_at ASC`,
            [SESSION_ID]
        );
        assert(dbRes3.rows.length === 2, 'Two search events recorded (Impression + Click)');
        assert(dbRes3.rows[0].event_type === 'impression', 'First event is impression');
        assert(dbRes3.rows[1].event_type === 'click', 'Second event is click');
        assert(dbRes3.rows[0].metadata.term === 'iph', 'Metadata stored correctly');


        // 4. Validate "Referral Conversion" (Search -> Product Page)
        console.log('\n--- Test 4: Referral Conversion (Search -> Product) ---');
        const productViewPayload = {
            event_type: 'page_view',
            entity_type: 'product',
            entity_id: 'prod_999',
            session_id: SESSION_ID,
            referrer_entity_type: 'search_autocomplete',
            referrer_entity_id: 'search_bar',
            metadata: { product_name: 'iPhone 15' }
        };
        await axios.post(`${API_BASE}/analytics/collect`, productViewPayload, { headers: { 'X-Tenant-ID': TENANT_ID } });

        const dbRes4 = await query(
            `SELECT * FROM analytics_events WHERE session_id = $1 AND event_type = 'page_view' AND entity_id = 'prod_999'`,
            [SESSION_ID]
        );
        assert(dbRes4.rows.length === 1, 'Product Page View recorded');
        assert(dbRes4.rows[0].referrer_entity_type === 'search_autocomplete', 'Referrer type captured from search');

    } catch (err) {
        console.error('💥 Unexpected Error:', err);
        errors++;
    }

    console.log(`\n---------------------------------`);
    if (errors === 0) {
        console.log('🎉 PASSED: All Phase 3 analytics validation tests passed!');
    } else {
        console.log(`⚠️ FAILED: ${errors} errors encountered.`);
        process.exit(1);
    }
    process.exit(0);
}

runPhase3Tests();
