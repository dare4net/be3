/**
 * Test Script - Decoupled Attributes
 * Verifies Global Attribute Creation and Linking to Categories
 * 
 * Run: node test-decoupled.js
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
    console.log('🚀 Testing Decoupled Attributes...\n');

    try {
        // 1. Login
        console.log('🔑 Logging in...');
        const loginRes = await makeRequest('POST', '/auth/login', {
            email: 'john@demo.com',
            password: 'Test1234!'
        }, { 'X-Tenant-ID': TENANT_ID });

        if (!loginRes.data.success) {
            console.log('Login failed');
            return;
        }

        const token = loginRes.data.accessToken;
        const authHeaders = {
            'X-Tenant-ID': TENANT_ID,
            'Authorization': `Bearer ${token}`
        };

        // 2. Create Global Attribute
        console.log('\n✨ Creating Global Attribute "Material"...');
        const attrRes = await makeRequest('POST', '/products/attributes', {
            code: 'material',
            label: 'Material',
            type: 'select',
            options: ['Wood', 'Metal', 'Plastic']
        }, authHeaders);

        if (attrRes.data.success) {
            console.log('✅ Created Attribute:', attrRes.data.attribute.label);

            // 3. Create Category
            console.log('\n📁 Creating Category "Furniture"...');
            const catRes = await makeRequest('POST', '/products/categories', {
                name: 'Furniture ' + Date.now()
            }, authHeaders);

            if (catRes.data.success) {
                console.log('✅ Created Category:', catRes.data.category.name);

                // 4. Link Attribute to Category
                console.log('\n🔗 Linking "Material" to "Furniture"...');
                const linkRes = await makeRequest('POST', `/products/categories/${catRes.data.category.id}/attributes`, {
                    attribute_id: attrRes.data.attribute.id,
                    is_required: true
                }, authHeaders);

                if (linkRes.data.success) {
                    console.log('✅ Linked Attribute Successfully');

                    // 5. Verify Fetch
                    console.log('\n🔍 Fetching Category Details...');
                    const fetchRes = await makeRequest('GET', `/products/categories/${catRes.data.category.id}`, null, authHeaders);

                    const linkedAttrs = fetchRes.data.category.attributes;
                    if (linkedAttrs && linkedAttrs.length > 0) {
                        console.log('✅ Verification Passed: Category has linked attributes');
                        console.log('   Attributes:', JSON.stringify(linkedAttrs.map(a => a.label)));
                    } else {
                        console.error('❌ Verification Failed: No attributes found on category');
                    }

                } else {
                    console.error('❌ Link Failed:', linkRes.data);
                }
            }
        } else {
            console.error('❌ Attribute Creation Failed:', attrRes.data);
        }

    } catch (err) {
        console.error('\n❌ Test Failed:', err.message);
    }
}

runTest();
