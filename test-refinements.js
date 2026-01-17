/**
 * Test Script - Module Refinements
 * Verifies Coupons and Raw Analytics Events
 * 
 * Run: node test-refinements.js
 */

const http = require('http');

const TENANT_ID = 'd2c70441-582d-4c12-bed9-90e71a8e67e9';

// Helper for requests
function makeRequest(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const defaultHeaders = {
            'Content-Type': 'application/json',
            ...headers
        };

        const options = {
            hostname: 'localhost',
            port: 3000,
            path,
            method,
            headers: defaultHeaders
        };

        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (err) {
                    resolve({ status: res.statusCode, data: responseData });
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function runTest() {
    console.log('🚀 Testing Refinements (Coupons, Analytics Events)\n');

    try {
        // 1. Login
        console.log('🔑 Logging in...');
        const loginRes = await makeRequest('POST', '/auth/login', {
            email: 'john@demo.com',
            password: 'Test1234!'
        }, { 'X-Tenant-ID': TENANT_ID });

        if (!loginRes.data.success) {
            // Fallback for demo flow if user doesn't exist
            console.log('Login failed, assuming fresh DB. PLEASE ENSURE A USER EXISTS.');
            return;
        }

        const token = loginRes.data.accessToken;
        const authHeaders = {
            'X-Tenant-ID': TENANT_ID,
            'Authorization': `Bearer ${token}`
        };

        // ---------------------------------------------------------
        // 2. Test Coupons
        // ---------------------------------------------------------
        console.log('\n🎟️ Testing Coupons...');

        // Create Coupon
        const code = 'SAVE20-' + Date.now();
        const couponRes = await makeRequest('POST', '/marketing/coupons', {
            code: code,
            discount_type: 'percentage',
            discount_value: 20
        }, authHeaders);

        if (couponRes.data.success) {
            console.log('✅ Created Coupon:', code);

            // Validate Coupon
            const validRes = await makeRequest('POST', '/marketing/coupons/validate', {
                code: code,
                cartTotal: 100
            }, { 'X-Tenant-ID': TENANT_ID });

            if (validRes.data.success) {
                console.log('✅ Validated Coupon (20% Off)');
            } else {
                console.error('❌ Validation Failed:', validRes.data);
            }
        } else {
            console.error('❌ Coupon Creation Failed:', couponRes.data);
        }

        // ---------------------------------------------------------
        // 3. Test Analytics Raw Events
        // ---------------------------------------------------------
        console.log('\n📈 Testing Analytics Collection...');

        const eventRes = await makeRequest('POST', '/analytics/collect', {
            event_type: 'PAGE_VIEWED',
            session_id: 'sess_12345',
            metadata: { url: '/homepage', referrer: 'google' }
        }, { 'X-Tenant-ID': TENANT_ID });

        if (eventRes.data.success) {
            console.log('✅ Collected PAGE_VIEWED Event');
        } else {
            console.error('❌ Event Collection Failed:', eventRes.data);
        }

        console.log('\n🎉 Refinements Verified!');

    } catch (err) {
        console.error('\n❌ Test Failed:', err.message);
    }
}

runTest();
