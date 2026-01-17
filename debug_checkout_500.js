const axios = require('axios');
const { query, pool } = require('./config/database');

async function debugCheckoutWithRealData() {
    try {
        console.log('1. Fetching Demo Tenant...');
        const tenantRes = await axios.get('http://localhost:3000/tenants/lookup?subdomain=demo');
        const tenant = tenantRes.data.tenant;
        console.log('Tenant:', tenant.id, tenant.name);

        console.log('\n2. Getting a product from DB...');
        const prodRes = await query(`
            SELECT id as product_id, price 
            FROM products 
            WHERE tenant_id = $1 AND status = 'active'
            LIMIT 1
        `, [tenant.id]);

        if (prodRes.rows.length === 0) {
            console.error('❌ No active products found for tenant');
            return;
        }

        const product = prodRes.rows[0];
        // Default variant to null if not checking variants table
        product.variant_id = null;
        console.log('Using Product:', product);

        console.log('\n3. Creating Cart & Adding Item...');
        const sessionId = `debug_sess_${Date.now()}`;

        // Add item (this should auto-create cart)
        const addToCartRes = await axios.post('http://localhost:3000/cart/items', {
            product_id: product.product_id,
            variant_id: product.variant_id,
            quantity: 1,
            price: product.price,
            session_id: sessionId
        }, {
            headers: { 'X-Tenant-ID': tenant.id }
        });

        // Get the cart ID from the response or by fetching cart
        console.log('Item Added:', addToCartRes.data.success);

        const cartRes = await axios.get(`http://localhost:3000/cart?session_id=${sessionId}`, {
            headers: { 'X-Tenant-ID': tenant.id }
        });
        const cartId = cartRes.data.cart.id;
        console.log('Cart ID:', cartId);

        console.log('\n4. Processing Checkout...');
        const checkoutPayload = {
            cartId: cartId,
            email: "debug_user@example.com",
            paymentMethod: "credit_card",
            shippingAddress: {
                firstName: "Debug",
                lastName: "User",
                address: "123 Test St",
                city: "Test City",
                state: "Test State",
                zip: "12345",
                country: "US"
            },
            billingAddress: {
                firstName: "Debug",
                lastName: "User",
                address: "123 Test St",
                city: "Test City",
                state: "Test State",
                zip: "12345",
                country: "US"
            }
        };

        const res = await axios.post('http://localhost:3000/checkout/process', checkoutPayload, {
            headers: { 'X-Tenant-ID': tenant.id }
        });

        console.log('\n✅ Checkout Success!');
        console.log('Transaction ID:', res.data.transactionId);

    } catch (err) {
        console.error('\n❌ Checkout Failed!');
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', JSON.stringify(err.response.data, null, 2));
        } else {
            console.error('Error:', err.message);
        }
    } finally {
        await pool.end();
    }
}

debugCheckoutWithRealData();
