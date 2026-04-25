const { query } = require('../config/database');

async function run() {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    
    try {
        console.log(`Registering default legacy search layout for branded_search`);

        // Get Active Layout
        const layoutRes = await query(
            'SELECT id FROM layouts WHERE tenant_id = $1 AND is_active = true LIMIT 1',
            [tenantId]
        );
        
        if (layoutRes.rows.length === 0) {
            console.error('No active layout found');
            process.exit(1);
        }
        
        const layoutId = layoutRes.rows[0].id;

        // Check if search_layout already exists for branded_search
        const existing = await query(
            "SELECT id FROM page_widgets WHERE tenant_id = $1 AND page_type = 'branded_search' AND config->>'legacy_type' = 'search_layout'",
            [tenantId]
        );

        if (existing.rows.length === 0) {
            await query(
                `INSERT INTO page_widgets (tenant_id, layout_id, page_type, widget_type, config, sort_order, is_active)
                 VALUES ($1, $2, 'branded_search', 'unknown_widget', $3, 0, true)`,
                [tenantId, layoutId, JSON.stringify({ legacy_type: 'search_layout' })]
            );
            console.log('✓ Registered legacy search_layout for branded_search');
        } else {
            console.log('! Search layout already exists for branded_search');
        }

        process.exit(0);
    } catch (error) {
        console.error('✗ Failed to register branded_search widgets:', error);
        process.exit(1);
    }
}

run();
