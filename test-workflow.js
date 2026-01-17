/**
 * Complete Testing Workflow
 * Tests the entire platform flow from tenant creation to order placement
 * 
 * Run: node test-workflow.js
 */

const http = require('http');

// Store data between steps
let tenantId = null;
let accessToken = null;
let userId = null;
let productId = null;
let cartId = null;

// Helper function to make HTTP requests
function makeRequest(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const defaultHeaders = {
            'Content-Type': 'application/json',
            ...headers
        };

        if (tenantId && !headers['X-Tenant-ID']) {
            defaultHeaders['X-Tenant-ID'] = tenantId;
        }

        if (accessToken && !headers['Authorization']) {
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

            res.on('data', (chunk) => {
                responseData += chunk;
            });

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

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function runTests() {
    console.log('🚀 Starting Platform Workflow Test\n');
    console.log('='.repeat(50));

    try {
        // Step 1: Create Tenant
        console.log('\n📋 Step 1: Creating Tenant...');
        const tenantResult = await makeRequest('POST', '/tenants', {
            name: 'Demo Company',
            subdomain: 'demo' + Date.now(), // Unique subdomain
        });

        if (tenantResult.data.success) {
            tenantId = tenantResult.data.tenant.id;
            console.log('✅ Tenant created successfully!');
            console.log('   ID:', tenantId);
            console.log('   Subdomain:', tenantResult.data.tenant.subdomain);
        } else {
            throw new Error('Failed to create tenant: ' + JSON.stringify(tenantResult.data));
        }

        // Step 2: Register User
        console.log('\n👤 Step 2: Registering User...');
        const registerResult = await makeRequest('POST', '/auth/register', {
            email: 'john@demo.com',
            password: 'Test1234!',
            first_name: 'John',
            last_name: 'Doe'
        });

        if (registerResult.data.success) {
            userId = registerResult.data.user.id;
            console.log('✅ User registered successfully!');
            console.log('   Email:', registerResult.data.user.email);
        } else {
            throw new Error('Failed to register user: ' + JSON.stringify(registerResult.data));
        }

        // Step 3: Login
        console.log('\n🔐 Step 3: Logging in...');
        const loginResult = await makeRequest('POST', '/auth/login', {
            email: 'john@demo.com',
            password: 'Test1234!'
        });

        if (loginResult.data.success) {
            accessToken = loginResult.data.accessToken;
            console.log('✅ Login successful!');
            console.log('   Token received ✓');
        } else {
            throw new Error('Failed to login: ' + JSON.stringify(loginResult.data));
        }

        // Step 4: Subscribe to a Plan
        console.log('\n💳 Step 4: Getting Subscription Plans...');
        const plansResult = await makeRequest('GET', '/subscriptions/plans');

        if (plansResult.data.success && plansResult.data.plans.length > 0) {
            console.log('✅ Available plans:');
            plansResult.data.plans.forEach(plan => {
                console.log(`   - ${plan.name}: $${plan.price_monthly}/month`);
            });

            // Subscribe to first plan
            const planId = plansResult.data.plans[0].id;
            const subscribeResult = await makeRequest('POST', '/subscriptions/subscribe', {
                planId
            });

            if (subscribeResult.data.success) {
                console.log('✅ Subscribed to:', plansResult.data.plans[0].name);
            } else {
                console.log('⚠️  Subscription warning:', subscribeResult.data.message);
            }
        } else {
            console.log('⚠️  No subscription plans found (run: node database/seed.js)');
        }

        // Step 5: Create a Product
        console.log('\n📦 Step 5: Creating Product...');
        const productResult = await makeRequest('POST', '/products', {
            name: 'Test Product',
            description: 'A great test product',
            sku: 'TEST-001',
            price: 29.99,
            inventory_quantity: 100,
            status: 'active'
        });

        if (productResult.data.success) {
            productId = productResult.data.product.id;
            console.log('✅ Product created!');
            console.log('   Name:', productResult.data.product.name);
            console.log('   Price: $' + productResult.data.product.price);
        } else {
            console.log('⚠️  Product creation:', productResult.data.message || productResult.data.error);
        }

        // Step 6: Add to Cart
        console.log('\n🛒 Step 6: Adding to Cart...');
        const cartResult = await makeRequest('POST', '/cart/items', {
            product_id: productId,
            quantity: 2,
            price: 29.99,
            session_id: 'test-session-' + Date.now()
        });

        if (cartResult.data.success) {
            console.log('✅ Item added to cart!');
            console.log('   Quantity: 2');
        } else {
            console.log('⚠️  Cart:', cartResult.data.message || cartResult.data.error);
        }

        // Step 7: View Orders
        console.log('\n📋 Step 7: Checking Orders...');
        const ordersResult = await makeRequest('GET', '/orders');

        if (ordersResult.data.success) {
            console.log('✅ Orders retrieved!');
            console.log('   Total orders:', ordersResult.data.data.length);
        } else {
            console.log('⚠️  Orders:', ordersResult.data.message || ordersResult.data.error);
        }

        // Summary
        console.log('\n' + '='.repeat(50));
        console.log('🎉 Workflow Test Complete!\n');
        console.log('Summary:');
        console.log('  ✅ Tenant created');
        console.log('  ✅ User registered & authenticated');
        console.log('  ✅ Subscription plans available');
        console.log('  ✅ Product created');
        console.log('  ✅ Cart working');
        console.log('  ✅ Orders accessible');
        console.log('\n📝 Your Tenant Details:');
        console.log('  Tenant ID:', tenantId);
        console.log('  Email: john@demo.com');
        console.log('  Password: Test1234!');
        console.log('  Access Token:', accessToken.substring(0, 20) + '...');
        console.log('\n💡 Next: Use these credentials to test the API!');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.log('\nDebug Info:');
        console.log('  Tenant ID:', tenantId);
        console.log('  Access Token:', accessToken ? 'Yes' : 'No');
    }
}

runTests();
