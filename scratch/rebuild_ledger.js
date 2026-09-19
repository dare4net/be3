const { query } = require('../config/database');
const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function rebuild() {
    try {
        // 1. Delete all current ledger entries
        console.log("Wiping stale vendor_category_ledger data...");
        await query('DELETE FROM vendor_category_ledger WHERE tenant_id = $1', [TENANT_ID]);

        // 2. Re-calculate and insert accurate data
        console.log("Recalculating category counts per vendor...");
        const res = await query(`
            INSERT INTO vendor_category_ledger (tenant_id, vendor_id, vendor_name, category_id, product_count)
            SELECT 
                p.tenant_id,
                u.id as vendor_id,
                p.attributes->>'vendor' as vendor_name,
                pc.category_id,
                COUNT(p.id)::int as product_count
            FROM products p
            JOIN product_categories pc ON p.id = pc.product_id
            -- Use the actual user table to guarantee the correct vendor UUID is attached
            JOIN users u ON u.business_name = p.attributes->>'vendor' AND u.tenant_id = p.tenant_id
            WHERE p.tenant_id = $1
              AND p.deleted_at IS NULL
              AND p.is_variant = false
            GROUP BY p.tenant_id, u.id, p.attributes->>'vendor', pc.category_id
            RETURNING *;
        `, [TENANT_ID]);

        console.log(`Success! Rebuilt ${res.rowCount} category ledger records across all vendors.`);
    } catch(e) {
        console.error("Error building ledger:", e.message);
    } finally {
        process.exit();
    }
}

rebuild();
