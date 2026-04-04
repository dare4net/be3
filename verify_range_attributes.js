/**
 * Verification Script - Range Attributes
 * Verifies that the new 'range' attribute type correctly filters products.
 */

const http = require('http');

const TENANT_ID = 'd2c70441-582d-4c12-bed9-90e71a8e67e9'; // Standard test tenant

function makeRequest(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path,
            method,
            headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT_ID, ...headers }
        };
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
                catch (e) { resolve({ status: res.statusCode, data: body }); }
            });
        });
        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function verifyRange() {
    console.log('🚀 Verifying Range Attributes...');

    try {
        // 1. Login
        console.log('🔑 Logging in...');
        const loginRes = await makeRequest('POST', '/auth/login', {
            email: 'john@demo.com',
            password: 'Test1234!'
        });

        if (!loginRes.data.success) {
            console.error('❌ Login failed:', loginRes.data);
            return;
        }
        const authHeaders = { 'Authorization': `Bearer ${loginRes.data.accessToken}` };

        // 2. Create a Range Attribute
        console.log('📝 Creating "Measurement" range attribute...');
        const attrRes = await makeRequest('POST', '/products/attributes', {
            code: 'measurement_' + Date.now(),
            label: 'Measurement',
            type: 'range'
        }, authHeaders);

        if (!attrRes.data.success) {
            console.error('❌ Failed to create attribute:', attrRes.data);
            return;
        }
        const attrCode = attrRes.data.attribute.code;
        console.log('✅ Created attribute:', attrCode);

        // 3. Create a Product with a Range
        console.log('📦 Creating product with range 10-50...');
        const prodRes = await makeRequest('POST', '/products', {
            name: 'Range Test Product',
            price: 100,
            sku: 'RNG-' + Date.now(),
            attributes: {
                [attrCode]: { min: 10, max: 50 }
            }
        }, authHeaders);

        if (!prodRes.data.success) {
            console.error('❌ Failed to create product:', prodRes.data);
            return;
        }
        console.log('✅ Created product');

        // 3. Test Point Match (25 should find it)
        console.log('\n🔍 Testing point match (25)...');
        const search1 = await makeRequest('POST', '/search', {
            filters: { [`attribute.${attrCode}`]: 25 }
        }, authHeaders);
        const found1 = search1.data.results?.some(r => r.content_id === prodRes.data.product.id);
        console.log(found1 ? '✅ PASS: Found product with point 25' : '❌ FAIL: Could not find product with point 25');

        // 4. Test Range Overlap (45-60 should find it)
        console.log('🔍 Testing range overlap (45-60)...');
        const search2 = await makeRequest('POST', '/search', {
            filters: { [`attribute.${attrCode}`]: { min: 45, max: 60 } }
        }, authHeaders);
        const found2 = search2.data.results?.some(r => r.content_id === prodRes.data.product.id);
        console.log(found2 ? '✅ PASS: Found product with overlapping range 45-60' : '❌ FAIL: Could not find product with overlapping range 45-60');

        // 5. Test Non-match (60 point should NOT find it)
        console.log('🔍 Testing non-match point (60)...');
        const search3 = await makeRequest('POST', '/search', {
            filters: { [`attribute.${attrCode}`]: 60 }
        }, authHeaders);
        const found3 = search3.data.results?.some(r => r.content_id === prodRes.data.product.id);
        console.log(!found3 ? '✅ PASS: Correctly ignored point 60' : '❌ FAIL: Unexpectedly found product with point 60');

    } catch (err) {
        console.error('💥 Verification Error:', err.message);
    }
}

verifyRange();
