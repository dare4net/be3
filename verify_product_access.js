const axios = require('axios');

async function checkAccess() {
    try {
        console.log('1. Fetching Demo Tenant...');
        const tenantRes = await axios.get('http://127.0.0.1:3000/tenants/lookup?subdomain=demo');
        const tenant = tenantRes.data.tenant;
        console.log('Tenant:', tenant.id);

        console.log('\n2. Attempting to fetch Storefront Products (Public)...');
        const res = await axios.get('http://127.0.0.1:3000/products/storefront', {
            headers: {
                'X-Tenant-ID': tenant.id
            }
        });

        console.log('Response Status:', res.status);
        console.log('Products found:', res.data.data.length);
        console.log('⚠️ API Access Successful (Should be blocked if module is disabled!)');

    } catch (err) {
        if (err.response) {
            console.error('✅ Request blocked with status:', err.response.status);
        } else {
            console.error('❌ Request error:', err.message);
        }
    }
}

checkAccess();
