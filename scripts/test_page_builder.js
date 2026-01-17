const api = require('../config/database');

// Test Page Builder API
async function testPageBuilder() {
    const { query } = require('../config/database');

    // Get a tenant ID
    const tenantRes = await query('SELECT id FROM tenants LIMIT 1');
    const tenantId = tenantRes.rows[0].id;

    console.log(`Testing with tenant: ${tenantId}`);

    // Create a sample Hero widget
    const widgetData = {
        page_type: 'home',
        widget_type: 'hero',
        config: JSON.stringify({
            title: 'Welcome to Our Store',
            subtitle: 'Discover amazing products at great prices',
            ctaText: 'Shop Now',
            ctaLink: '/products',
            backgroundImage: '/images/hero-bg.jpg',
            textColor: '#ffffff',
            overlayOpacity: 0.5
        }),
        sort_order: 0,
        is_active: true
    };

    const insertResult = await query(
        `INSERT INTO page_widgets (tenant_id, page_type, widget_type, config, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, widgetData.page_type, widgetData.widget_type, widgetData.config, widgetData.sort_order, widgetData.is_active]
    );

    console.log('✓ Created widget:', insertResult.rows[0]);

    // Fetch widgets for home page
    const fetchResult = await query(
        `SELECT * FROM page_widgets WHERE tenant_id = $1 AND page_type = 'home'`,
        [tenantId]
    );

    console.log(`✓ Found ${fetchResult.rows.length} widgets for home page`);

    process.exit(0);
}

testPageBuilder().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
