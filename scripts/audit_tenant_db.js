const { query } = require('../config/database');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function audit() {
    try {
        console.log(`=== Auditing Tenant: ${TENANT_ID} ===\n`);

        // 1. Check Pages
        console.log("--- Pages Table ---");
        const pagesRes = await query(`
            SELECT id, slug, title, is_system, is_published 
            FROM pages 
            WHERE tenant_id = $1 
            ORDER BY slug ASC
        `, [TENANT_ID]);
        
        if (pagesRes.rows.length === 0) {
            console.log("!!! NO PAGES FOUND FOR THIS TENANT !!!");
        } else {
            console.table(pagesRes.rows);
        }

        // 2. Check Layouts
        console.log("\n--- Layouts Table ---");
        const layoutsRes = await query(`
            SELECT id, name, is_active, created_at 
            FROM layouts 
            WHERE tenant_id = $1
        `, [TENANT_ID]);
        console.table(layoutsRes.rows);

        const activeLayout = layoutsRes.rows.find(l => l.is_active);
        if (!activeLayout) {
            console.log("!!! NO ACTIVE LAYOUT FOUND !!!");
        } else {
            console.log(`\nActive Layout ID: ${activeLayout.id} (${activeLayout.name})`);

            // 3. Check Widgets for Active Layout
            console.log("\n--- Widgets for Active Layout ---");
            const widgetsRes = await query(`
                SELECT id, page_type, widget_type, config->>'legacy_type' as legacy_type, sort_order, is_active
                FROM page_widgets
                WHERE tenant_id = $1 AND layout_id = $2
                ORDER BY page_type, sort_order
            `, [TENANT_ID, activeLayout.id]);
            
            if (widgetsRes.rows.length === 0) {
                console.log("!!! NO WIDGETS FOUND FOR THIS LAYOUT !!!");
            } else {
                console.table(widgetsRes.rows);
            }
        }

    } catch (err) {
        console.error("\n[!] AUDIT FAILED:", err.message);
    } finally {
        console.log("\n=== Audit Complete ===");
        process.exit(0);
    }
}

audit();
