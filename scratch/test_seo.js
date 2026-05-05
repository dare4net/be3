const { Pool } = require('pg');
require('dotenv').config();
const axios = require('axios');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

async function run() {
    const tenantId = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    console.log(`Testing SEO for Tenant: ${tenantId}`);

    const productRes = await pool.query("SELECT handle, name FROM products WHERE tenant_id = $1 AND status = 'active' AND is_variant = false LIMIT 1", [tenantId]);
    const categoryRes = await pool.query("SELECT slug, name FROM categories WHERE tenant_id = $1 AND is_active = true LIMIT 1", [tenantId]);

    const product = productRes.rows[0];
    const category = categoryRes.rows[0];

    console.log('Product Found:', product ? product.name : 'NONE');
    console.log('Category Found:', category ? category.name : 'NONE');

    const baseUrl = 'http://localhost:3000/api';

    if (product) {
        console.log('\n--- Testing Product SEO ---');
        try {
            const res = await axios.get(`${baseUrl}/storefront/products/${product.handle}`, {
                headers: { 
                    'x-tenant-id': tenantId,
                    'x-storefront-url': 'http://localhost:3003'
                }
            });
            console.log('Product SEO:', JSON.stringify(res.data.product.seo, null, 2));
        } catch (e) {
            console.error('Product SEO Fetch Failed:', e.message);
            if (e.response) console.log(e.response.data);
        }
    }

    if (category) {
        console.log('\n--- Testing Category SEO ---');
        try {
            const res = await axios.get(`${baseUrl}/storefront/categories/${category.slug}`, {
                headers: { 
                    'x-tenant-id': tenantId,
                    'x-storefront-url': 'http://localhost:3003'
                }
            });
            console.log('Category SEO:', JSON.stringify(res.data.category.seo, null, 2));
        } catch (e) {
            console.error('Category SEO Fetch Failed:', e.message);
            if (e.response) console.log(e.response.data);
        }
    }

    await pool.end();
}

run().catch(console.error);
