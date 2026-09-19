const { Pool } = require('pg');
require('dotenv').config();
const { mergeProductSEO, mergeCategorySEO } = require('../lib/seoHelpers');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

async function run() {
    const tenantId = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    const baseUrl = 'http://localhost:3003';
    
    console.log(`Testing SEO Helpers for Tenant: ${tenantId}`);

    // Fetch a real product
    const productRes = await pool.query(`
        SELECT p.*, 
               (SELECT json_agg(c) FROM (
                   SELECT c.id, c.name, c.slug FROM categories c 
                   JOIN product_categories pc ON c.id = pc.category_id 
                   WHERE pc.product_id = p.id
               ) c) as categories
        FROM products p 
        WHERE p.tenant_id = $1 AND p.status = 'active' AND p.is_variant = false 
        LIMIT 1
    `, [tenantId]);
    
    const product = productRes.rows[0];
    
    if (product) {
        console.log('\n--- Testing Product SEO Helper ---');
        console.log('Product Name:', product.name);
        console.log('Product Handle:', product.handle);
        console.log('Product DB canonical_url:', product.canonical_url);
        
        const primaryCategory = product.categories ? product.categories[0] : null;
        const seo = mergeProductSEO(product, primaryCategory, baseUrl);
        
        console.log('Generated SEO:', JSON.stringify(seo, null, 2));
    }

    // Fetch a real category
    const categoryRes = await pool.query("SELECT * FROM categories WHERE tenant_id = $1 AND is_active = true LIMIT 1", [tenantId]);
    const category = categoryRes.rows[0];

    if (category) {
        console.log('\n--- Testing Category SEO Helper ---');
        console.log('Category Name:', category.name);
        console.log('Category Slug:', category.slug);
        console.log('Category DB canonical_url:', category.canonical_url);
        
        const seo = mergeCategorySEO(category, baseUrl);
        console.log('Generated SEO:', JSON.stringify(seo, null, 2));
    }

    await pool.end();
}

run().catch(console.error);
