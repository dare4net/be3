const { query } = require('../config/database');

async function debug() {
    try {
        console.log('--- Debugging Storefront Data ---');

        // 1. Check Tenant 'demo'
        const tenantRes = await query(`SELECT * FROM tenants WHERE subdomain = 'demo'`);
        if (tenantRes.rows.length === 0) {
            console.log('❌ Tenant "demo" NOT FOUND!');
        } else {
            console.log('✅ Tenant "demo" found:', tenantRes.rows[0].id);
        }

        const tenantId = tenantRes.rows[0]?.id;

        // 2. Check Product by UUID
        const productId = '58d5c65d-0a86-4044-8a80-6a9df9e6a3c5';
        console.log(`\nChecking Product ID: ${productId}`);

        const prodRes = await query(`SELECT * FROM products WHERE id = $1`, [productId]);
        if (prodRes.rows.length === 0) {
            console.log('❌ Product NOT FOUND by ID');
        } else {
            const p = prodRes.rows[0];
            console.log('✅ Product Found:');
            console.log(`   ID: ${p.id}`);
            console.log(`   Name: ${p.name}`);
            console.log(`   Handle: ${p.handle}`);
            console.log(`   Status: ${p.status}`);
            console.log(`   Tenant ID: ${p.tenant_id}`);

            if (p.tenant_id === tenantId) {
                console.log('✅ Product belongs to "demo" tenant.');
            } else {
                console.log(`❌ MISMATCH: Product belongs to tenant ${p.tenant_id}, but we are looking in ${tenantId}`);
            }

            if (p.status !== 'active') {
                console.log(`❌ WARNING: Product status is "${p.status}", expected "active"`);
            }
        }

    } catch (e) {
        console.error('Debug script error:', e);
    } finally {
        process.exit();
    }
}

debug();
