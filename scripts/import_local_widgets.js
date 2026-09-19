const { query } = require('../config/database');
const fs = require('fs');
const path = require('path');

const TARGET_TENANT = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
const TARGET_PAGES = ['collection_detail', 'category_detail', 'branded_search'];

async function importWidgets() {
    console.log(`Starting import to current database for tenant: ${TARGET_TENANT}`);

    try {
        const filePath = path.join(__dirname, '../local_widgets_dump.json');
        if (!fs.existsSync(filePath)) {
            console.error(`✗ ERROR: Export file not found at ${filePath}. Did you run the export script on local first?`);
            process.exit(1);
        }

        const importData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const newWidgets = importData.widgets;

        // Find the active layout on PRODUCTION
        const layoutRes = await query(
            'SELECT id, name FROM layouts WHERE tenant_id = $1 AND is_active = true',
            [TARGET_TENANT]
        );

        if (layoutRes.rows.length === 0) {
            console.error('✗ ERROR: No active layout found on this database.');
            process.exit(1);
        }

        const layoutId = layoutRes.rows[0].id;
        console.log(`  Targeting Active Layout: ${layoutRes.rows[0].name} (${layoutId})`);

        // 1. Clear existing widgets for these pages in this layout (Fresh start for sync)
        console.log('  Clearing existing widgets for target pages...');
        await query(`
            DELETE FROM page_widgets 
            WHERE tenant_id = $1 AND layout_id = $2 AND page_type = ANY($3)
        `, [TARGET_TENANT, layoutId, TARGET_PAGES]);

        // 2. Insert new widgets
        console.log(`  Syncing ${newWidgets.length} widgets from local dump...`);
        for (const w of newWidgets) {
            await query(`
                INSERT INTO page_widgets (tenant_id, layout_id, page_type, widget_type, config, sort_order, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [TARGET_TENANT, layoutId, w.page_type, w.widget_type, JSON.stringify(w.config), w.sort_order, w.is_active]);
        }

        console.log(`\n✓ SUCCESS: Production site is now in parity with local configuration.`);
        console.log(`Pages synced: ${TARGET_PAGES.join(', ')}`);
        
        process.exit(0);
    } catch (err) {
        console.error('\n✗ IMPORT FAILED:', err.message);
        process.exit(1);
    }
}

importWidgets();
