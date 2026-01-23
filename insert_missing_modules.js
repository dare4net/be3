const { query, pool } = require('./config/database');

async function run() {
    console.log('Checking for missing modules...');

    const modules = [
        { name: 'storefront', display_name: 'Storefront', version: '1.0.0', description: 'Storefront themes, pages, navigation, and SEO' },
        { name: 'products', display_name: 'Products', version: '1.0.0', description: 'Product catalog with variants, categories, and media' },
        { name: 'cart', display_name: 'Shopping Cart', version: '1.0.0', description: 'Shopping cart for guest and authenticated users' },
        { name: 'checkout', display_name: 'Checkout', version: '1.0.0', description: 'Checkout flow and validation' },
        { name: 'orders', display_name: 'Orders', version: '1.0.0', description: 'Order lifecycle management' },
        { name: 'page_builder', display_name: 'Page Builder', version: '1.0.0', description: 'CMS page builder with widgets, layouts, and themes' },
        { name: 'payments', display_name: 'Payments', version: '1.0.0', description: 'Payment processing and webhooks' },
        { name: 'shipping', display_name: 'Shipping', version: '1.0.0', description: 'Shipping zones, rates, and tracking' },
        { name: 'marketing', display_name: 'Marketing', version: '1.0.0', description: 'Promotions, campaigns, and coupons' },
        { name: 'analytics', display_name: 'Analytics', version: '1.0.0', description: 'Metrics, reporting, and funnel tracking' },
        { name: 'search', display_name: 'Search', version: '1.0.0', description: 'Advanced search with filters, autocomplete, and analytics' },
    ];

    try {
        for (const mod of modules) {
            console.log(`Ensuring ${mod.name} exists...`);
            await query(`
                INSERT INTO modules (name, display_name, version, is_core, description)
                VALUES ($1, $2, $3, false, $4)
                ON CONFLICT (name) DO UPDATE 
                SET display_name = EXCLUDED.display_name,
                    description = EXCLUDED.description,
                    version = EXCLUDED.version
            `, [mod.name, mod.display_name, mod.version, mod.description || `${mod.display_name} module`]);
        }
        console.log('✅ Missing modules inserted/updated!');
    } catch (err) {
        console.error('Error', err);
    } finally {
        await pool.end();
    }
}

run();
