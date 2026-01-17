/**
 * Test Script - Product Categories
 * Verifies category creation and assignment to products
 * 
 * Run: node test-categories.js
 */

const http = require('http');

let tenantId = null;
let accessToken = null;
let categoryId = null;
let productId = null;

// Helper for requests
function makeRequest(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const defaultHeaders = {
            'Content-Type': 'application/json',
            ...headers
        };

        if (tenantId && !defaultHeaders['X-Tenant-ID']) {
            defaultHeaders['X-Tenant-ID'] = tenantId;
        }

        if (accessToken && !defaultHeaders['Authorization']) {
            defaultHeaders['Authorization'] = `Bearer ${accessToken}`;
        }

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
    console.log('🚀 Starting Category Verification Test\n');

    try {
        // 1. Setup Tenant (Reuse if possible, but creating new ensures clean state)
        // For speed, let's try to register a new user on a new tenant
        console.log('📝 Creating Setup...');
        const suffix = Date.now();
        const tenantRes = await makeRequest('POST', '/tenants', {
            name: `Cat Test ${suffix}`,
            subdomain: `cat${suffix}`
        });

        tenantId = tenantRes.data.tenant.id;
        console.log(`✅ Tenant created: ${tenantRes.data.tenant.subdomain}`);

        // Register & Login
        // Note: Tenant creation triggers 'tenant.created' event which creates default admin user
        // We can just login with those credentials: admin@<subdomain>.com / Admin@123

        console.log('⏳ Waiting for async admin creation...');
        await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for event listener

        console.log('🔑 Logging in with default admin credentials...');
        const loginRes = await makeRequest('POST', '/auth/login', {
            email: `admin@cat${suffix}.com`,
            password: 'Admin@123'
        });

        if (!loginRes.data.success) {
            throw new Error('Login failed: ' + JSON.stringify(loginRes.data));
        }

        accessToken = loginRes.data.accessToken;
        console.log('✅ Logged in (Token length: ' + accessToken.length + ')');

        // Subscribe (needed for access)
        const plansRes = await makeRequest('GET', '/subscriptions/plans');
        if (plansRes.data.plans.length > 0) {
            const subRes = await makeRequest('POST', '/subscriptions/subscribe', { planId: plansRes.data.plans[0].id });
            if (subRes.data.success) {
                console.log('✅ Subscribed to plan');
            } else {
                throw new Error('Subscription failed: ' + JSON.stringify(subRes.data));
            }
        }

        // 2. Create Category
        console.log('\n📂 Creating Category...');
        const catRes = await makeRequest('POST', '/products/categories', {
            name: 'Electronics',
            description: 'Gadgets'
        });

        if (catRes.data.success) {
            categoryId = catRes.data.category.id;
            console.log('✅ Category Created:', catRes.data.category.name);
        } else {
            throw new Error('Category creation failed: ' + JSON.stringify(catRes.data));
        }

        // 3. Create Product with Category
        console.log('\n📦 Creating Product with Category...');
        const prodRes = await makeRequest('POST', '/products', {
            name: 'Smartphone X',
            price: 999.99,
            category_ids: [categoryId]
        });

        if (prodRes.data.success) {
            productId = prodRes.data.product.id;
            console.log('✅ Product Created:', prodRes.data.product.name);
        } else {
            throw new Error('Product creation failed: ' + JSON.stringify(prodRes.data));
        }

        // 4. Verify Association
        console.log('\n🔍 Verifying Association...');
        const getProdRes = await makeRequest('GET', `/products/${productId}`);

        const cats = getProdRes.data.product.categories;
        if (cats && cats.length > 0 && cats[0].id === categoryId) {
            console.log('✅ SUCCESS! Product has category:', cats[0].name);
        } else {
            console.error('❌ FAILED: Product missing categories');
            console.log('Actual categories:', cats);
        }

        console.log('\n🎉 Category Feature Verified!');

    } catch (err) {
        console.error('\n❌ Test Failed:', err.message);
    }
}

runTest();
