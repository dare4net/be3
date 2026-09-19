const { query } = require('../config/database');
const fs = require('fs');
const path = require('path');

const TARGET_TENANT = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
const TARGET_PAGES = ['collection_detail', 'category_detail', 'branded_search'];

async function exportWidgets() {
    console.log(`Starting export from LOCAL database for tenant: ${TARGET_TENANT}`);

    try {
        // Find the active layout first
        const layoutRes = await query(
            'SELECT id, name FROM layouts WHERE tenant_id = $1 AND is_active = true',
            [TARGET_TENANT]
        );

        if (layoutRes.rows.length === 0) {
            console.error('✗ ERROR: No active layout found locally for this tenant.');
            process.exit(1);
        }

        const layoutId = layoutRes.rows[0].id;
        console.log(`  Using Local Active Layout: ${layoutRes.rows[0].name} (${layoutId})`);

        // Fetch all widgets for the target pages
        const widgetsRes = await query(`
            SELECT page_type, widget_type, config, sort_order, is_active
            FROM page_widgets
            WHERE tenant_id = $1 AND layout_id = $2 AND page_type = ANY($3)
            ORDER BY page_type, sort_order ASC
        `, [TARGET_TENANT, layoutId, TARGET_PAGES]);

        const data = {
            tenant_id: TARGET_TENANT,
            layout_name: layoutRes.rows[0].name,
            exported_at: new Date().toISOString(),
            widgets: widgetsRes.rows
        };

        const filePath = path.join(__dirname, '../local_widgets_dump.json');
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        console.log(`\n✓ SUCCESS: Exported ${widgetsRes.rows.length} widgets to ${filePath}`);
        console.log('Now rotate to your PRODUCTION database and tell me when you are ready to import.');
        
        process.exit(0);
    } catch (err) {
        console.error('\n✗ EXPORT FAILED:', err.message);
        process.exit(1);
    }
}

exportWidgets();
