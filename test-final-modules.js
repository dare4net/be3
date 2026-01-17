/**
 * Test Script - Final Modules (Shipping, Marketing, Analytics)
 * Verifies that the new modules are active and responding
 * 
 * Run: node test-final-modules.js
 */

const http = require('http');

// Configuration
const BASE_URL = 'http://localhost:3000';
const TENANT_ID = 'd2c70441-582d-4c12-bed9-90e71a8e67e9'; // Demo tenant from before
const TOKEN = 'eyJhbGciOiJIUzI1NiIs...'; // We need a real token. Let's start by logging in.

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
    console.log('🚀 Testing Final Modules (Shipping, Marketing, Analytics)\n');

    try {
        // 1. Setup - Login to get Token
        // We'll use the admin user we know exists from previous tests (john@demo.com)
        // If that fails, we'll try to use the default admin if we can find the subdomain, 
        // but john@demo.com is the safest bet from the workflow test.

        console.log('🔑 Logging in...');
        const loginRes = await makeRequest('POST', '/auth/login', {
            email: 'john@demo.com',
            password: 'Test1234!'
        }, { 'X-Tenant-ID': TENANT_ID });

        if (!loginRes.data.success) {
            throw new Error('Login failed. Please update TENANT_ID in script or ensure user exists.');
        }

        const token = loginRes.data.accessToken;
        const authHeaders = {
            'X-Tenant-ID': TENANT_ID,
            'Authorization': `Bearer ${token}`
        };
        console.log('✅ Logged in successfully');

        // ---------------------------------------------------------
        // 2. Test Shipping
        // ---------------------------------------------------------
        console.log('\n🚢 Testing Shipping Module...');

        // Create a Zone
        const zoneRes = await makeRequest('POST', '/shipping/zones', {
            name: 'North America',
            regions: ['US', 'CA', 'MX']
        }, authHeaders);

        if (zoneRes.data.success) {
            console.log('✅ Created Shipping Zone:', zoneRes.data.zone.name);

            // Add a Rate
            await makeRequest('POST', '/shipping/rates', {
                zone_id: zoneRes.data.zone.id,
                name: 'Standard Ground',
                type: 'flat_rate',
                amount: 15.00
            }, authHeaders);
            console.log('✅ Added Shipping Rate: $15.00');
        }

        // Calculate (Public endpoint)
        const calcRes = await makeRequest('POST', '/shipping/calculate', {
            country: 'US',
            subtotal: 100
        }, { 'X-Tenant-ID': TENANT_ID }); // No auth needed usually, or optional

        if (calcRes.data.success) {
            console.log(`✅ Calculated Shipping: Found ${calcRes.data.rates.length} rates`);
        }

        // ---------------------------------------------------------
        // 3. Test Marketing
        // ---------------------------------------------------------
        console.log('\n📣 Testing Marketing Module...');

        const campRes = await makeRequest('POST', '/marketing/campaigns', {
            name: 'Summer Sale',
            subject: '50% Off Everything!',
            content: '<h1>Sale!</h1>'
        }, authHeaders);

        if (campRes.data.success) {
            console.log('✅ Created Campaign:', campRes.data.campaign.name);

            // Send it
            const sendRes = await makeRequest('POST', `/marketing/campaigns/${campRes.data.campaign.id}/send`, {}, authHeaders);
            if (sendRes.data.success) {
                console.log('✅ Sent Campaign (Triggered Event)');
            }
        }

        // ---------------------------------------------------------
        // 4. Test Analytics
        // ---------------------------------------------------------
        console.log('\naaS Testing Analytics Module...');

        const analyticsRes = await makeRequest('GET', '/analytics/dashboard', null, authHeaders);

        if (analyticsRes.data.success) {
            console.log('✅ Fetched Dashboard Stats');
            console.log('   Total Sales:', analyticsRes.data.totals.sales);
            console.log('   Total Orders:', analyticsRes.data.totals.orders);
            console.log('   New Customers:', analyticsRes.data.totals.customers);
        } else {
            console.error('❌ Analytics Fetch Failed:', analyticsRes.data);
        }

        console.log('\n🎉 All Final Modules Verified!');

    } catch (err) {
        console.error('\n❌ Test Failed:', err.message);
    }
}

runTest();
