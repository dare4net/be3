const { query } = require('../config/database');
const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
const DREY_TECH_ID = '5b708d12-e1db-49b0-98e1-4c0a4c9a7750';
const TAYE_HOME_DECOR_ID = 'afe03e4b-2a3c-4d40-b25b-b2e299174116';

async function assignCategoriesAndVendors() {
    try {
        console.log("Fetching Category IDs...");
        
        // Find Home Decor category
        const hdCat = await query("SELECT id FROM categories WHERE name ilike 'Home Decor' AND tenant_id = $1 LIMIT 1", [TENANT_ID]);
        const homeDecorId = hdCat.rows[0]?.id;
        
        // Find ultrabooks category
        const ubCat = await query("SELECT id FROM categories WHERE name ilike 'ultrabooks' AND tenant_id = $1 LIMIT 1", [TENANT_ID]);
        const ultrabooksId = ubCat.rows[0]?.id;

        if(!homeDecorId || !ultrabooksId) {
            throw new Error("Could not find required categories in the DB.");
        }

        console.log("Categories found. Home Decor:", homeDecorId, "| ultrabooks:", ultrabooksId);

        // Dell Laptop -> ultrabooks & Drey Tech Store
        await query(`
            UPDATE products SET 
                created_by = $2, 
                attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{vendor}', '"Drey Tech Store"') 
            WHERE name = 'Dell Laptop' AND tenant_id = $1;
        `, [TENANT_ID, DREY_TECH_ID]);

        await query(`
            INSERT INTO product_categories (product_id, category_id, tenant_id)
            SELECT id, $2, $1 FROM products WHERE name = 'Dell Laptop' AND tenant_id = $1
            ON CONFLICT DO NOTHING;
        `, [TENANT_ID, ultrabooksId]);
        console.log("Assigned 'Dell Laptop' -> Category: 'ultrabooks' | Vendor: 'Drey Tech Store'");

        // gch & hgch -> Home Decor & Taye's Home Decor
        await query(`
            UPDATE products SET 
                created_by = $2, 
                attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{vendor}', '"Taye''s Home Decor"') 
            WHERE name IN ('gch', 'hgch') AND tenant_id = $1;
        `, [TENANT_ID, TAYE_HOME_DECOR_ID]);

        await query(`
            INSERT INTO product_categories (product_id, category_id, tenant_id)
            SELECT id, $2, $1 FROM products WHERE name IN ('gch', 'hgch') AND tenant_id = $1
            ON CONFLICT DO NOTHING;
        `, [TENANT_ID, homeDecorId]);
        console.log("Assigned 'gch' and 'hgch' -> Category: 'Home Decor' | Vendor: 'Taye\\'s Home Decor'");

        console.log("\nRebuilding vendor_category_ledger for accurate dashboard counts...");
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

        console.log("Done! All 3 uncategorized products assigned correct vendors and categories, and ledger rebuilt.");

    } catch(e) {
        console.error("Error:", e.message);
    } finally {
        process.exit();
    }
}

assignCategoriesAndVendors();
