const { query } = require('../config/database');

async function registerStorefrontPages() {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    
    try {
        console.log(`Registering storefront pages for tenant: ${tenantId}`);

        // 1. Get Active Layout
        const layoutRes = await query(
            'SELECT id FROM layouts WHERE tenant_id = $1 AND is_active = true LIMIT 1',
            [tenantId]
        );
        
        if (layoutRes.rows.length === 0) {
            console.error('No active layout found for tenant');
            process.exit(1);
        }
        
        const layoutId = layoutRes.rows[0].id;
        console.log(`Using layout: ${layoutId}`);

        // 2. Clear existing widgets for these types to avoid duplicates
        const pageTypes = ['collection_detail', 'category_detail', 'search'];
        await query(
            'DELETE FROM page_widgets WHERE tenant_id = $1 AND layout_id = $2 AND page_type = ANY($3)',
            [tenantId, layoutId, pageTypes]
        );

        // 3. Register Widgets for Collection Detail
        const searchBase = {
            columns: { desktop: 5, tablet: 3, mobile: 2 },
            sidebarEnabled: true,
            showFilters: true,
            showActiveFiltersBar: true,
            showPrice: true,
            showAddToCart: true,
            showFeaturedBadge: true,
            showViewDetails: true,
            showTags: false,
            showDescription: true,
            showAttributes: false,
            showSocialProof: true,
            showRating: false,
            cardScale: 0.9,
        };

        const collectionWidgets = [
            { type: 'unknown_widget',     config: { legacy_type: 'collection_hero' }, order: 0 },
            { type: 'search_page_layout', config: { ...searchBase, showSearchBar: false, showImageSearchBar: true }, order: 1 }
        ];

        for (const w of collectionWidgets) {
            await query(
                `INSERT INTO page_widgets (tenant_id, layout_id, page_type, widget_type, config, sort_order, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6, true)`,
                [tenantId, layoutId, 'collection_detail', w.type, JSON.stringify(w.config), w.order]
            );
        }
        console.log('✓ Registered widgets for collection_detail');

        // 4. Register Widgets for Category Detail
        const categoryWidgets = [
            { type: 'unknown_widget',     config: { legacy_type: 'category_hero' },        order: 0 },
            { type: 'unknown_widget',     config: { legacy_type: 'category_subnav' },      order: 1 },
            { type: 'search_page_layout', config: { ...searchBase, showSearchBar: true, showImageSearchBar: true }, order: 2 },
            { type: 'unknown_widget',     config: { legacy_type: 'category_suggestions' }, order: 3 }
        ];

        for (const w of categoryWidgets) {
            await query(
                `INSERT INTO page_widgets (tenant_id, layout_id, page_type, widget_type, config, sort_order, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6, true)`,
                [tenantId, layoutId, 'category_detail', w.type, JSON.stringify(w.config), w.order]
            );
        }
        console.log('✓ Registered widgets for category_detail');

        // 5. Register Widgets for Standard Search Page
        const searchWidgets = [
            { type: 'search_page_layout', config: { ...searchBase, showSearchBar: true, showImageSearchBar: true }, order: 0 }
        ];

        for (const w of searchWidgets) {
            await query(
                `INSERT INTO page_widgets (tenant_id, layout_id, page_type, widget_type, config, sort_order, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6, true)`,
                [tenantId, layoutId, 'search', w.type, JSON.stringify(w.config), w.order]
            );
        }
        console.log('✓ Registered widgets for search');

        // 6. Register an arbitrary Branded Search Page
        const brandedSlug = 'luxury-watches';
        // Ensure page exists
        const pageExist = await query('SELECT id FROM pages WHERE tenant_id = $1 AND slug = $2', [tenantId, brandedSlug]);
        if (pageExist.rows.length === 0) {
            await query(
                `INSERT INTO pages (tenant_id, slug, title, meta_description, is_published, is_system)
                 VALUES ($1, $2, $3, $4, true, false)`,
                [tenantId, brandedSlug, 'Luxury Watches', 'Explore our curated collection of luxury timepieces']
            );
            console.log(`✓ Created page: /${brandedSlug}`);
        }

        // Register widgets for this specific slug
        await query(
            'DELETE FROM page_widgets WHERE tenant_id = $1 AND layout_id = $2 AND page_type = $3',
            [tenantId, layoutId, brandedSlug]
        );
        
        await query(
            `INSERT INTO page_widgets (tenant_id, layout_id, page_type, widget_type, config, sort_order, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true)`,
            [tenantId, layoutId, brandedSlug, 'search_page_layout', JSON.stringify({ ...searchBase, showSearchBar: true, showImageSearchBar: true }), 0]
        );
        console.log(`✓ Registered widgets for branded page: /${brandedSlug}`);

        console.log('\n✓ Storefront registration completed');
        process.exit(0);
    } catch (error) {
        console.error('✗ Registration failed:', error);
        process.exit(1);
    }
}

registerStorefrontPages();
