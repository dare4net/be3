const axios = require('axios');
const { query } = require('../config/database');

async function runIsolationTest() {
    console.log('🧪 Starting Vendor Isolation Verification...');

    const API_URL = 'http://localhost:3000';
    const TEST_EMAIL_ADMIN = 'admin_market@example.com';
    const TEST_EMAIL_A = 'vendor_a_market@example.com';
    const TEST_EMAIL_B = 'vendor_b_market@example.com';
    const PASSWORD = 'Password123!';

    const SUBDOMAIN = 'market-' + Date.now();

    try {
        // 1. Setup Tenant & Admin
        console.log(`Setting up Marketplace Tenant (${SUBDOMAIN})...`);
        let adminToken, tenantId, adminId;
        try {
            const signupRes = await axios.post(`${API_URL}/auth/signup`, {
                email: TEST_EMAIL_ADMIN,
                password: PASSWORD,
                companyName: 'Marketplace Store',
                name: 'Main Admin',
                subdomain: SUBDOMAIN
            });
            adminToken = signupRes.data.token;
            tenantId = signupRes.data.tenant.id;
            adminId = signupRes.data.user.id;
        } catch (e) {
            console.log('Signup failed, attempting login context lookup...');
            // We need to find the tenant ID first if signup failed (e.g. user exists but tenant changed)
            const tenantRes = await query('SELECT id FROM tenants WHERE subdomain LIKE $1', ['market-%']);
            if (tenantRes.rows[0]) {
                tenantId = tenantRes.rows[0].id;
                const loginRes = await axios.post(`${API_URL}/auth/login`,
                    { email: TEST_EMAIL_ADMIN, password: PASSWORD },
                    { headers: { 'X-Tenant-ID': tenantId } }
                );
                adminToken = loginRes.data.token;
                adminId = loginRes.data.user.id;
            } else {
                throw e;
            }
        }

        // Enable analytics
        await query('INSERT INTO tenant_modules (tenant_id, module_name, is_enabled) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [tenantId, 'analytics', true]);

        // Seed Roles and Upgrade Admin for test
        console.log('Seeding Roles & Upgrading Admin...');
        const RoleService = require('../platform/core/roles/services/RoleService');
        await RoleService.seedDefaultRoles(tenantId);
        await RoleService.assignRoleToUser(tenantId, adminId, 'Admin');

        // 2. Create Vendor Users A and B in same tenant
        console.log('Creating Vendor Users...');
        const createUser = async (email, name) => {
            // We use the admin token to create users if there's an endpoint for it, 
            // but for this test we can just manually insert into DB to bypass complex signup flows for second users
            // Or if auth/signup allows creating users in existing tenant? (Usually not)
            // Let's manually insert and then login.
            const bcrypt = require('bcrypt');
            const hash = await bcrypt.hash(PASSWORD, 10);
            const res = await query(
                `INSERT INTO users (tenant_id, email, password_hash, first_name, status) 
                 VALUES ($1, $2, $3, $4, 'active') 
                 ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = $3 
                 RETURNING id`,
                [tenantId, email, hash, name]
            );
            return res.rows[0].id;
        };

        const userIdA = await createUser(TEST_EMAIL_A, 'Vendor A');
        const userIdB = await createUser(TEST_EMAIL_B, 'Vendor B');

        // Login to get tokens
        const tokenA = (await axios.post(`${API_URL}/auth/login`,
            { email: TEST_EMAIL_A, password: PASSWORD },
            { headers: { 'X-Tenant-ID': tenantId } }
        )).data.token;
        const tokenB = (await axios.post(`${API_URL}/auth/login`,
            { email: TEST_EMAIL_B, password: PASSWORD },
            { headers: { 'X-Tenant-ID': tenantId } }
        )).data.token;

        // 3. Create Products for each vendor
        console.log('Creating Products...');
        const createProduct = async (name, ownerId) => {
            const handle = name.toLowerCase().replace(/ /g, '-') + '-' + Date.now();
            const sku = 'SKU-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
            const res = await query(
                `INSERT INTO products (tenant_id, name, handle, created_by, status, price, sku, track_inventory, inventory_quantity) 
                 VALUES ($1, $2, $3, $4, 'active', 29.99, $5, false, 0) RETURNING id`,
                [tenantId, name, handle, ownerId, sku]
            );
            return res.rows[0].id;
        };

        const pA = await createProduct('Product A', userIdA);
        const pB = await createProduct('Product B', userIdB);

        // 4. Simulate Traffic
        console.log('Simulating Traffic...');
        const headersA = { Authorization: `Bearer ${tokenA}`, 'X-Tenant-ID': tenantId };
        const collectEvent = async (entityId, type = 'impression') => {
            await axios.post(`${API_URL}/analytics/collect`, {
                event_type: type,
                entity_type: 'product',
                entity_id: entityId
            }, { headers: headersA });
        };

        await collectEvent(pA, 'impression');
        await collectEvent(pA, 'click');
        await collectEvent(pB, 'impression');

        console.log('\n--- VERIFYING ISOLATION ---');

        // Vendor A Stats
        const statsA = (await axios.get(`${API_URL}/analytics/stats`, { headers: headersA })).data.data;
        console.log(`Vendor A sees ${statsA.length} products`);
        const hasBInA = statsA.some(s => s.entity_id === pB.toString());
        const hasAInA = statsA.some(s => s.entity_id === pA.toString());

        if (hasAInA && !hasBInA) {
            console.log('✅ Vendor A isolation verified (sees only own product)');
        } else {
            console.log('❌ Vendor A isolation failed', { hasA: hasAInA, hasB: hasBInA });
        }

        // Vendor B Stats
        const headersB = { Authorization: `Bearer ${tokenB}`, 'X-Tenant-ID': tenantId };
        const statsB = (await axios.get(`${API_URL}/analytics/stats`, { headers: headersB })).data.data;
        console.log(`Vendor B sees ${statsB.length} products`);
        const hasAInB = statsB.some(s => s.entity_id === pA.toString());
        const hasBInB = statsB.some(s => s.entity_id === pB.toString());

        if (hasBInB && !hasAInB) {
            console.log('✅ Vendor B isolation verified');
        } else {
            console.log('❌ Vendor B isolation failed');
        }

        // Admin Stats (should see both)
        const headersAdmin = { Authorization: `Bearer ${adminToken}`, 'X-Tenant-ID': tenantId };
        const statsAdmin = (await axios.get(`${API_URL}/analytics/stats`, { headers: headersAdmin })).data.data;
        console.log(`Admin sees ${statsAdmin.length} products`);
        if (statsAdmin.length >= 2) {
            console.log('✅ Admin global view verified');
        } else {
            console.log('❌ Admin global view failed');
        }

        process.exit(0);
    } catch (e) {
        console.error('❌ Isolation Verification Failed:', e.response?.data || e.message);
        process.exit(1);
    }
}

runIsolationTest();
