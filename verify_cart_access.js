const axios = require('axios');

async function checkAccess() {
    try {
        console.log('1. Fetching Demo Tenant...');
        // Using localhost to match frontend
        const tenantRes = await axios.get('http://localhost:3000/tenants/lookup?subdomain=demo');
        const tenant = tenantRes.data.tenant;
        console.log('Tenant:', tenant.id, tenant.name);

        console.log('\n2. Attempting to fetch Cart...');
        const cartRes = await axios.get('http://localhost:3000/cart?session_id=test_session_123', {
            headers: {
                'X-Tenant-ID': tenant.id
            }
        });

        console.log('Response Status:', cartRes.status);
        console.log('Success!', cartRes.data);

    } catch (err) {
        if (err.response) {
            console.error('❌ Request failed with status:', err.response.status);
            console.error('Data:', err.response.data);
        } else {
            console.error('❌ Request error:', err.message);
        }
    }
}

checkAccess();
