const axios = require('axios');

async function testBatching() {
    console.log('🧪 Testing Analytics Batching...');

    const API_URL = 'http://localhost:3000';
    const TEST_EMAIL = 'test_tenant_stats@example.com';
    const TEST_PASSWORD = 'Password123!';

    try {
        console.log('🔑 Authenticating...');
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: TEST_EMAIL,
            password: TEST_PASSWORD
        });

        const token = loginRes.data.token;
        const tenantId = loginRes.data.user.tenant_id;
        console.log(`✅ Authenticated. Tenant ID: ${tenantId}`);

        const headers = {
            'X-Tenant-ID': tenantId,
            'Authorization': `Bearer ${token}`
        };

        const batchPayload = {
            batch: true,
            events: [
                {
                    event_type: 'impression',
                    entity_type: 'product',
                    entity_id: 'batch-p-1',
                    placement_id: 'test-widget-batch',
                    session_id: 'batch-sess-99'
                },
                {
                    event_type: 'click',
                    entity_type: 'product',
                    entity_id: 'batch-p-1',
                    placement_id: 'test-widget-batch',
                    session_id: 'batch-sess-99'
                }
            ]
        };

        console.log('📡 Sending batch payload (2 events)...');
        const res = await axios.post(`${API_URL}/analytics/collect`, batchPayload, { headers });

        console.log('✅ Response:', res.data);
        if (res.data.success && res.data.processed === 2) {
            console.log('🎉 Batch processed correctly!');
        } else {
            console.error('❌ Batch count mismatch:', res.data);
            process.exit(1);
        }

        process.exit(0);
    } catch (e) {
        console.error('❌ Test failed:', e.response?.data || e.message);
        process.exit(1);
    }
}

testBatching();
