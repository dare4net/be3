/**
 * Test Script - Create a Tenant
 * Run with: node test-create-tenant.js
 */

const http = require('http');

const tenantData = {
    name: 'Test Company',
    subdomain: 'testco',
    timezone: 'UTC'
};

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/tenants',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    }
};

const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log('\n=== Response ===');
        console.log('Status:', res.statusCode);
        console.log('Headers:', JSON.stringify(res.headers, null, 2));
        console.log('\nBody:', data);

        try {
            const parsed = JSON.parse(data);
            console.log('\nParsed:', JSON.stringify(parsed, null, 2));

            if (parsed.success) {
                console.log('\n✅ SUCCESS! Tenant created:');
                console.log('   Tenant ID:', parsed.tenant.id);
                console.log('   Subdomain:', parsed.tenant.subdomain);
                console.log('\nNext: Use this tenant ID in X-Tenant-ID header for other requests');
            } else {
                console.log('\n❌ FAILED:', parsed.message || parsed.error);
            }
        } catch (err) {
            console.log('\n❌ Failed to parse response');
        }
    });
});

req.on('error', (error) => {
    console.error('❌ Request failed:', error.message);
    console.log('\nTroubleshooting:');
    console.log('1. Is the server running? (npm run dev)');
    console.log('2. Is it on port 3000?');
    console.log('3. Check server logs for errors');
});

console.log('Creating tenant:', tenantData.name);
console.log('Subdomain:', tenantData.subdomain);
console.log('\nSending request to http://localhost:3000/tenants\n');

req.write(JSON.stringify(tenantData));
req.end();
