const { query } = require('../config/database');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function audit() {
    try {
        console.log("--- VENDORS IN USERS TABLE ---");
        const usersRes = await query(`
            SELECT id, email, business_name, first_name, last_name 
            FROM users 
            WHERE tenant_id = $1
            ORDER BY business_name ASC
        `, [TENANT_ID]);
        
        usersRes.rows.forEach(u => {
            console.log(`[USER] ID: ${u.id} | Email: ${u.email} | Business: ${u.business_name} | Name: ${u.first_name} ${u.last_name}`);
        });

        console.log("\n--- UNIQUE VENDOR ATTRIBUTES ON PRODUCTS ---");
        const attrRes = await query(`
            SELECT 
                attributes->>'vendor' as vendor_name, 
                COUNT(*) as product_count,
                COUNT(CASE WHEN deleted_at IS NULL AND is_variant = false THEN 1 END) as active_parent_count
            FROM products
            WHERE tenant_id = $1
            GROUP BY attributes->>'vendor'
            ORDER BY product_count DESC
        `, [TENANT_ID]);
        
        attrRes.rows.forEach(a => {
            console.log(`[ATTR] Vendor: ${a.vendor_name || 'UNASSIGNED'} | Total Products: ${a.product_count} | Active Parents: ${a.active_parent_count}`);
        });

        console.log("\n--- PRODUCTS MISSING FROM PREVIOUS LIST ---");
        // Let's check products that might be soft-deleted or variants, just in case their products are all variants or deleted
        const hiddenRes = await query(`
            SELECT p.id, p.name, p.attributes->>'vendor' as vendor, p.deleted_at, p.is_variant
            FROM products p
            WHERE p.tenant_id = $1 
            AND (p.deleted_at IS NOT NULL OR p.is_variant = true)
        `, [TENANT_ID]);
        console.log(`Hidden Products Found: ${hiddenRes.rows.length}`);

    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        process.exit(0);
    }
}

audit();
