const { query } = require('../config/database');
const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
const DAREYMI_ID = '397b6118-2a98-4144-aa18-88ef225f69bb';

async function fixGch() {
    try {
        console.log("--- FIXING THE 'gch' MIX-UP ---");
        
        // Find the Food category
        const foodCat = await query("SELECT id FROM categories WHERE name ilike 'Food' AND tenant_id = $1 LIMIT 1", [TENANT_ID]);
        const foodId = foodCat.rows[0]?.id;

        // Find the Home Decor category
        const hdCat = await query("SELECT id FROM categories WHERE name ilike 'Home Decor' AND tenant_id = $1 LIMIT 1", [TENANT_ID]);
        const homeDecorId = hdCat.rows[0]?.id;

        // The older one (often has a lower created_at or we can just isolate via the one that had Food)
        // Since both currently just say "Home Decor", let's get both IDs.
        const res = await query(`SELECT id, created_at FROM products WHERE name = 'gch' AND tenant_id = $1 ORDER BY created_at ASC`, [TENANT_ID]);
        
        if (res.rows.length >= 2) {
            const originalGchId = res.rows[0].id;
            const newGchId = res.rows[1].id;

            // 1. Revert Original GCH back to Dareymi and ONLY Food
            await query(`
                UPDATE products SET 
                    created_by = $2, 
                    name = 'gch (Food Test)',
                    attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{vendor}', '"Dareymi"') 
                WHERE id = $1
            `, [originalGchId, DAREYMI_ID]);

            // Clear its categories and put it exclusively back in Food
            await query(`DELETE FROM product_categories WHERE product_id = $1`, [originalGchId]);
            await query(`INSERT INTO product_categories (product_id, category_id, tenant_id) VALUES ($1, $2, $3)`, [originalGchId, foodId, TENANT_ID]);

            // 2. Keep the Newer GCH at Taye's Home Decor but rename it slightly
            await query(`
                UPDATE products SET name = 'gch (Decor Test)' WHERE id = $1
            `, [newGchId]);
            
            // Clear its categories and put it exclusively in Home Decor
            await query(`DELETE FROM product_categories WHERE product_id = $1`, [newGchId]);
            await query(`INSERT INTO product_categories (product_id, category_id, tenant_id) VALUES ($1, $2, $3)`, [newGchId, homeDecorId, TENANT_ID]);

            console.log("Successfully untangled the two 'gch' products!");
            console.log("- Original reverted to Dareymi (Food) as 'gch (Food Test)'");
            console.log("- Second kept at Taye's (Home Decor) as 'gch (Decor Test)'");
        }

        // Rebuild ledger
        await query('DELETE FROM vendor_category_ledger WHERE tenant_id = $1', [TENANT_ID]);
        await query(`
            INSERT INTO vendor_category_ledger (tenant_id, vendor_id, vendor_name, category_id, product_count)
            SELECT 
                p.tenant_id,
                u.id as vendor_id,
                p.attributes->>'vendor' as vendor_name,
                pc.category_id,
                COUNT(p.id)::int as product_count
            FROM products p
            JOIN product_categories pc ON p.id = pc.product_id
            JOIN users u ON u.business_name = p.attributes->>'vendor' AND u.tenant_id = p.tenant_id
            WHERE p.tenant_id = $1
              AND p.deleted_at IS NULL
              AND p.is_variant = false
            GROUP BY p.tenant_id, u.id, p.attributes->>'vendor', pc.category_id
        `, [TENANT_ID]);

    } catch(e) { console.error(e.message); }
    process.exit();
}
fixGch();
