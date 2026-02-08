const axios = require('axios');
const { query } = require('../config/database');

// Configuration
const API_URL = 'http://localhost:3000';
const TEST_EMAIL = 'test_tenant_stats@example.com';
const TEST_PASSWORD = 'Password123!';

async function runTest() {
    console.log('🧪 Starting Analytics Stats Verification...');

    try {
        // 1. Setup Tenant & Auth
        console.log('\nPlease ensure you have run previous analytics tests to populate some data.');
        console.log('Authenticating...');

        let token;
        try {
            const loginRes = await axios.post(`${API_URL}/auth/login`, {
                email: TEST_EMAIL,
                password: TEST_PASSWORD
            });
            token = loginRes.data.token;
            console.log('✅ Authenticated successfully');
        } catch (e) {
            console.log('⚠️ Login failed, attempting registration...');
            // Register if login fails
            try {
                const subdomain = 'stats-test-' + Date.now();
                const regRes = await axios.post(`${API_URL}/auth/signup`, {
                    email: TEST_EMAIL,
                    password: TEST_PASSWORD,
                    companyName: 'Stats Test Store',
                    name: 'Test Admin',
                    subdomain: subdomain
                });
                token = regRes.data.token;
                console.log('✅ Registered successfully (Tenant created)');

                const tenantId = regRes.data.tenant.id;

                await query('INSERT INTO tenant_modules (tenant_id, module_name, is_enabled) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, module_name) DO UPDATE SET is_enabled = $3', [tenantId, 'analytics', true]);
                console.log('✅ Enabled analytics module');

                // Generate some dummy events
                console.log('Generating dummy events...');
                const headers = { Authorization: `Bearer ${token}` };

                // 10 Impressions for Product A
                for (let i = 0; i < 10; i++) {
                    await axios.post(`${API_URL}/analytics/collect`, {
                        event_type: 'impression',
                        entity_type: 'product',
                        entity_id: 101,
                        metadata: { product_name: 'Test Product A' }
                    }, { headers });
                }

                // 5 Clicks for Product A
                for (let i = 0; i < 5; i++) {
                    await axios.post(`${API_URL}/analytics/collect`, {
                        event_type: 'click',
                        entity_type: 'product',
                        entity_id: 101,
                        metadata: { product_name: 'Test Product A' }
                    }, { headers });
                }

                console.log('✅ Generated single events');

                // 4. Batch Test
                console.log('Testing Batching...');
                const batchPayload = {
                    batch: true,
                    events: [
                        {
                            event_type: 'impression',
                            entity_type: 'product',
                            entity_id: 'batch-p-1',
                            placement_id: 'batch-widget',
                            session_id: 'batch-sess-1'
                        },
                        {
                            event_type: 'click',
                            entity_type: 'product',
                            entity_id: 'batch-p-1',
                            placement_id: 'batch-widget',
                            session_id: 'batch-sess-1'
                        }
                    ]
                };

                const batchRes = await axios.post(`${API_URL}/analytics/collect`, batchPayload, { headers });
                if (batchRes.data.success && batchRes.data.processed === 2) {
                    console.log('✅ Batch collection verified');
                } else {
                    console.error('❌ Batch collection failed:', batchRes.data);
                }

                console.log('✅ Generated dummy and batched events');

                // 20 Impressions for Product B
                for (let i = 0; i < 20; i++) {
                    await axios.post(`${API_URL}/analytics/collect`, {
                        event_type: 'impression',
                        entity_type: 'product',
                        entity_id: 102,
                        metadata: { product_name: 'Test Product B' }
                    }, { headers });
                }
                // 1 Click for Product B
                await axios.post(`${API_URL}/analytics/collect`, {
                    event_type: 'click',
                    entity_type: 'product',
                    entity_id: 102,
                    metadata: { product_name: 'Test Product B' }
                }, { headers });

                console.log('✅ Generated dummy events');

            } catch (regError) {
                console.error('❌ Registration/Setup failed:', regError.message);
                if (regError.response) console.error(regError.response.data);
                return;
            }
        }

        const headers = { Authorization: `Bearer ${token}` };

        // 2. Query Stats Endpoint
        console.log('\n2. Querying /analytics/stats...');
        const statsRes = await axios.get(`${API_URL}/analytics/stats`, {
            headers,
            params: {
                limit: 10,
                orderBy: 'impressions'
            }
        });

        if (statsRes.data.success) {
            console.log('✅ API returned success');
            console.log('Data:', JSON.stringify(statsRes.data.data, null, 2));

            const data = statsRes.data.data;
            if (Array.isArray(data) && data.length > 0) {
                const productB = data.find(item => item.entity_id == 102);
                const productA = data.find(item => item.entity_id == 101); // Note: PG returns entity_id as string usually if big int? Or number.

                // Note: entity_id is mixed type in DB? Schema said UUID??
                // Schema for 'analytics_events' says 'entity_id' column... wait.
                // In schema_events.sql it didn't verify the entity_id column type because it wasn't there!
                // But in Step 1064 index.js insert uses $4 for entity_id.
                // If the table was created with 'schema.sql' it likely didn't have entity_id.
                // But inserts worked. So entity_id exists. It is likely VARCHAR or TEXT to support "AC:..."

                // Anyway, let's just check if we see our products.

                if (productB && productB.impressions >= 20) {
                    console.log('✅ Product B stats verified (Impressions >= 20)');
                } else {
                    console.warn('⚠️ Product B stats mismatch or missing');
                }

                if (productA && productA.ctr >= 50) { // 5 clicks / 10 impressions = 50%
                    console.log('✅ Product A CTR verified (~50%)');
                }
            } else {
                console.error('❌ No stats returned');
            }

        } else {
            console.error('❌ API returned failure:', statsRes.data);
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
    }
}

runTest();
