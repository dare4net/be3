const axios = require('axios');
const { query } = require('../config/database');

async function runAdvancedTest() {
    console.log('🧪 Starting Advanced Analytics Verification...');

    const API_URL = 'http://localhost:3000';
    const TEST_EMAIL_1 = 'vendor_a@example.com';
    const TEST_EMAIL_2 = 'vendor_b@example.com';
    const PASSWORD = 'Password123!';

    async function setupVendor(email, company) {
        console.log(`Setting up ${company}...`);
        try {
            const signupRes = await axios.post(`${API_URL}/auth/signup`, {
                email,
                password: PASSWORD,
                companyName: company,
                name: 'Vendor Case',
                subdomain: 'vendor-' + Date.now() + '-' + Math.floor(Math.random() * 100)
            });
            const token = signupRes.data.token;
            const tenantId = signupRes.data.tenant.id;
            const userId = signupRes.data.user.id;

            // Enable analytics
            await query('INSERT INTO tenant_modules (tenant_id, module_name, is_enabled) VALUES ($1, $2, $3)', [tenantId, 'analytics', true]);

            return { token, tenantId, userId };
        } catch (e) {
            // If already exists, just login (simplified for script)
            const loginRes = await axios.post(`${API_URL}/auth/login`, { email, password: PASSWORD });
            return { token: loginRes.data.token, tenantId: loginRes.data.user.tenant_id, userId: loginRes.data.user.id };
        }
    }

    try {
        const vA = await setupVendor(TEST_EMAIL_1, 'Vendor A Store');
        const vB = await setupVendor(TEST_EMAIL_2, 'Vendor B Store');

        // Verify they share the same tenant for "Storewide" comparison?
        // Actually our multi-tenant system isolation is deep. 
        // "Relative Rank" makes most sense WITHIN a tenant where multiple vendors coexist.
        // Let's assume they are different users in the SAME tenant.

        const tenantId = vA.tenantId; // Use A's tenant
        const headers = { Authorization: `Bearer ${vA.token}`, 'X-Tenant-ID': tenantId };

        console.log('Generating multi-vendor cross-traffic...');

        // Product 1 (Vendor A)
        const p1 = 'product-a-top';
        // Product 2 (Vendor B) - but we'll manually insert into analytics_events to simulate ownership
        // In real world, the join determines owner.

        const events = [
            // Product A: 100 Impressions, 10 Clicks (Market Rank #1)
            ...Array(100).fill().map(() => ({ event_type: 'impression', entity_type: 'product', entity_id: 'p-a1', placement_type: 'carousel' })),
            ...Array(10).fill().map(() => ({ event_type: 'click', entity_type: 'product', entity_id: 'p-a1', placement_type: 'carousel' })),

            // Product B: 50 Impressions, 20 Clicks (Market Rank #2)
            ...Array(50).fill().map(() => ({ event_type: 'impression', entity_type: 'product', entity_id: 'p-b1', placement_type: 'search' })),
            ...Array(20).fill().map(() => ({ event_type: 'click', entity_type: 'product', entity_id: 'p-b1', placement_type: 'search' }))
        ];

        console.log('Cleaning existing events for tenant...');
        await query('DELETE FROM analytics_events WHERE tenant_id = $1', [tenantId]);

        console.log('Injecting simulated events...');
        for (const e of events) {
            await axios.post(`${API_URL}/analytics/collect`, e, { headers });
        }

        console.log('\n--- VERIFICATION ---');

        // 1. Check Global Stats
        const statsRes = await axios.get(`${API_URL}/analytics/stats`, { headers });
        const data = statsRes.data.data;

        console.log('Relative Rank Results:');
        data.forEach(item => {
            console.log(`- ${item.entity_id}: Global Rank #${item.global_rank} | Impressions: ${item.impressions} | CTR: ${item.ctr}%`);
        });

        if (data[0].entity_id === 'p-a1' && data[0].global_rank == 1) {
            console.log('✅ Global Rank #1 verified for high impressions');
        }

        // 2. Check Surface Analysis
        const surfaceRes = await axios.get(`${API_URL}/analytics/surfaces`, { headers });
        const surfaces = surfaceRes.data.data;
        console.log('\nSurface Breakdown:');
        surfaces.forEach(s => {
            console.log(`- ${s.placement_type}: ${s.impressions} Impressions, ${s.ctr}% CTR`);
        });

        const searchSurvace = surfaces.find(s => s.placement_type === 'search');
        if (searchSurvace && parseFloat(searchSurvace.ctr) > 30) {
            console.log('✅ Surface Analysis correctly identified high-performing Search surface');
        }

        // 3. Check Entity Details
        console.log('\nChecking Specific Entity Details (p-a1)...');
        const detailRes = await axios.get(`${API_URL}/analytics/details/product/p-a1`, { headers });
        const entitySurfaces = detailRes.data.surfaces;
        console.log(`- Surfaces for p-a1: ${entitySurfaces.length}`);
        entitySurfaces.forEach(s => {
            console.log(`  > ${s.placement_type}: ${s.impressions} Impressions, ${s.clicks} Clicks`);
        });

        if (entitySurfaces.length > 0) {
            console.log('✅ Entity Detail View verified');
        }

        process.exit(0);
    } catch (e) {
        console.error('❌ Advanced Verification Failed:', e.response?.data || e.message);
        process.exit(1);
    }
}

runAdvancedTest();
