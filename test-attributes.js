/**
 * Test Script - Product Attributes (Custom Fields)
 * Verifies Categories Schema and Product Attributes
 * 
 * Run: node test-attributes.js
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
    console.log('🚀 Testing Product Attributes...\n');

    try {
        // 1. Login
        console.log('🔑 Logging in...');
        const loginRes = await makeRequest('POST', '/auth/login', {
            email: 'john@demo.com',
            password: 'Test1234!'
        }, { 'X-Tenant-ID': TENANT_ID });

        if (!loginRes.data.success) {
            console.log('Login failed check user / tenant');
            return;
        }

        const token = loginRes.data.accessToken;
        const authHeaders = {
            'X-Tenant-ID': TENANT_ID,
            'Authorization': `Bearer ${token}`
        };

        // ---------------------------------------------------------
        // 2. Create Category with Schema
        // ---------------------------------------------------------
        console.log('\n📁 Creating Category with Schema...');

        // Schema: Electronics need Screen Size and Warranty
        const attributesSchema = [
            { key: "screen_size", label: "Screen Size", type: "text", required: true },
            { key: "warranty", label: "Warranty (Years)", type: "number", required: true }
        ];

        const catRes = await makeRequest('POST', '/products/categories', {
            name: 'Smart Electronics ' + Date.now(),
            attributes_schema: attributesSchema
        }, authHeaders);

        if (catRes.data.success) {
            console.log('✅ Created Category:', catRes.data.category.name);
            console.log('   Schema:', JSON.stringify(catRes.data.category.attributes_schema));

            // ---------------------------------------------------------
            // 3. Create Product with Attributes
            // ---------------------------------------------------------
            console.log('\n📺 Creating Product with Custom Attributes...');

            const prodRes = await makeRequest('POST', '/products', {
                name: 'OLED TV 4K',
                price: 1299.99,
                sku: 'TV-OLED-' + Date.now(),
                category_ids: [catRes.data.category.id],
                attributes: {
                    screen_size: "55 inch",
                    warranty: 2
                }
            }, authHeaders);

            if (prodRes.data.success) {
                console.log('✅ Created Product:', prodRes.data.product.name);
                console.log('   Attributes:', JSON.stringify(prodRes.data.product.attributes));

                // Verify Retrieval
                if (prodRes.data.product.attributes.screen_size === "55 inch") {
                    console.log('✅ Verification Passed: Attribute saved correctly!');
                } else {
                    console.error('❌ Verification Failed: Attributes mismatch');
                }

            } else {
                console.error('❌ Product Creation Failed:', prodRes.data);
            }

        } else {
            console.error('❌ Category Creation Failed:', catRes.data);
        }

    } catch (err) {
        console.error('\n❌ Test Failed:', err.message);
    }
}

runTest();
