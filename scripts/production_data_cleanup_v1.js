const { query } = require('../config/database');
const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

const FIX_TO_TECH = [
    'Alaye', 'Dell Precision 7875 (Threadripper Pro)', 'Iphone 12 Pro',
    'Laptop', 'RGB Wired Gaming Mouse', 'Samsung Galaxy Tab s10 Ultra',
    'The Samsung Galaxy Z Fold5', 'Dell Laptop', 'Google Pixel 2',
    'Infinix Hot 30 i', 'Ipad air 2', 'Iphone 12 pro', 'iphone 17 pro',
    'Macbook air', 'Mechanical Backlit Keyboard', 'Surround Sound Headset',
    'Virtual Reality Headset', '4K Ultra-Wide Monitor', 'Apple Vision Pro',
    'Ergonomic Gaming Chair', 'Mini Portable Projector', 'Samsung s26 Ultra',
    'Smart Home Hub', 'Wireless Gaming Controller'
];

const FIX_TO_FOOD = [
    'Artisan Sourdough Bread', 'Grade A Maple Syrup', 
    'Organic Hass Avocado', 'Himalayan Pink Salt'
];

async function runProductionCleanup() {
    try {
        console.log(`Starting Production Cleanup for Tenant: ${TENANT_ID}...`);

        console.log("-> Gathering Environment-Agnostic Vendor UUIDs...");
        const getVendorId = async (name) => {
            const res = await query("SELECT id FROM users WHERE business_name = $1 AND tenant_id = $2 LIMIT 1", [name, TENANT_ID]);
            if (!res.rows[0]) throw new Error(`CRITICAL: Vendor '${name}' not found in production database.`);
            return res.rows[0].id;
        };

        const BOLA_FOODS_ID = await getVendorId("Bola Foods");
        const DREY_TECH_ID = await getVendorId("Drey Tech Store");
        const DAREYMI_ID = await getVendorId("Dareymi");
        const TAYE_HOME_DECOR_ID = await getVendorId("Taye's Home Decor");

        console.log("-> Gathering Categories...");
        const getCategoryId = async (name) => {
            const res = await query("SELECT id FROM categories WHERE name ilike $1 AND tenant_id = $2 LIMIT 1", [name, TENANT_ID]);
            return res.rows[0]?.id; // Might be null if category is completely gone
        };
        const foodId = await getCategoryId("Food");
        const homeDecorId = await getCategoryId("Home Decor");
        const ultrabooksId = await getCategoryId("ultrabooks");

        // ==========================================
        // STEP 1: FIX DELL LAPTOP (UNCATEGORIZED)
        // ==========================================
        console.log("-> Fixing Uncategorized 'Dell Laptop'...");
        await query(`
            UPDATE products SET 
                created_by = $2, 
                attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{vendor}', to_jsonb($3::text)) 
            WHERE name = 'Dell Laptop' AND tenant_id = $1;
        `, [TENANT_ID, DREY_TECH_ID, "Drey Tech Store"]);
        
        if (ultrabooksId) {
            await query(`
                INSERT INTO product_categories (product_id, category_id, tenant_id)
                SELECT id, $2, $1 FROM products WHERE name = 'Dell Laptop' AND tenant_id = $1
                ON CONFLICT DO NOTHING;
            `, [TENANT_ID, ultrabooksId]);
        }

        // ==========================================
        // STEP 2: IDEMPOTENT UNTANGLING OF TEST PRODUCTS
        // ==========================================
        console.log("-> Safely Untangling 'gch' and 'hgch'...");
        
        // Isolate Dareymi's original gch (The Food one) using vendor history dynamically
        const gchDareymi = await query(`SELECT id FROM products WHERE name IN ('gch', 'gch (Food Test)') AND tenant_id = $1 AND attributes->>'vendor' = 'Dareymi'`, [TENANT_ID]);
        if(gchDareymi.rowCount > 0 && foodId) {
            await query(`UPDATE products SET name = 'gch (Food Test)', created_by = $2, attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{vendor}', to_jsonb($3::text)) WHERE id = $1`, [gchDareymi.rows[0].id, DAREYMI_ID, "Dareymi"]);
            await query(`DELETE FROM product_categories WHERE product_id = $1`, [gchDareymi.rows[0].id]);
            await query(`INSERT INTO product_categories (product_id, category_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [gchDareymi.rows[0].id, foodId, TENANT_ID]);
        }

        // Isolate the newer gch (The Decor one)
        const gchOther = await query(`SELECT id FROM products WHERE name IN ('gch', 'gch (Decor Test)') AND tenant_id = $1 AND attributes->>'vendor' IN ('Bola Foods', 'Taye''s Home Decor')`, [TENANT_ID]);
        if(gchOther.rowCount > 0 && homeDecorId) {
            await query(`UPDATE products SET name = 'gch (Decor Test)', created_by = $2, attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{vendor}', to_jsonb($3::text)) WHERE id = $1`, [gchOther.rows[0].id, TAYE_HOME_DECOR_ID, "Taye's Home Decor"]);
            await query(`DELETE FROM product_categories WHERE product_id = $1`, [gchOther.rows[0].id]);
            await query(`INSERT INTO product_categories (product_id, category_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [gchOther.rows[0].id, homeDecorId, TENANT_ID]);
        }

        // Setup hgch
        const hgchRes = await query(`SELECT id FROM products WHERE name = 'hgch' AND tenant_id = $1 LIMIT 1`, [TENANT_ID]);
        if(hgchRes.rowCount > 0 && homeDecorId) {
            await query(`UPDATE products SET created_by = $2, attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{vendor}', to_jsonb($3::text)) WHERE id = $1`, [hgchRes.rows[0].id, TAYE_HOME_DECOR_ID, "Taye's Home Decor"]);
            await query(`INSERT INTO product_categories (product_id, category_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [hgchRes.rows[0].id, homeDecorId, TENANT_ID]);
        }

        // ==========================================
        // STEP 3: CATEGORY / VENDOR MISMATCHES
        // ==========================================
        console.log("-> Processing bulk reassignment for mismatched Tech items...");
        await query(`
            UPDATE products p SET created_by = $2, attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{vendor}', to_jsonb($3::text))
            WHERE p.tenant_id = $1 AND p.name = ANY($4)
        `, [TENANT_ID, DREY_TECH_ID, "Drey Tech Store", FIX_TO_TECH]);

        console.log("-> Processing bulk reassignment for mismatched Food items...");
        await query(`
            UPDATE products p SET created_by = $2, attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{vendor}', to_jsonb($3::text))
            WHERE p.tenant_id = $1 AND p.name = ANY($4)
        `, [TENANT_ID, BOLA_FOODS_ID, "Bola Foods", FIX_TO_FOOD]);

        // ==========================================
        // STEP 4: REBUILD CATEGORY LEDGERS
        // ==========================================
        console.log("-> Wiping and Rebuilding vendor_category_ledger...");
        await query('DELETE FROM vendor_category_ledger WHERE tenant_id = $1', [TENANT_ID]);
        const ledgerRes = await query(`
            INSERT INTO vendor_category_ledger (tenant_id, vendor_id, vendor_name, category_id, product_count)
            SELECT p.tenant_id, u.id as vendor_id, p.attributes->>'vendor' as vendor_name, pc.category_id, COUNT(p.id)::int as product_count
            FROM products p
            JOIN product_categories pc ON p.id = pc.product_id
            JOIN users u ON u.business_name = p.attributes->>'vendor' AND u.tenant_id = p.tenant_id
            WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND p.is_variant = false
            GROUP BY p.tenant_id, u.id, p.attributes->>'vendor', pc.category_id
        `, [TENANT_ID]);

        console.log(`\n✅ Production cleanup complete! Generated ${ledgerRes.rowCount} category ledger records.`);

    } catch(e) {
        console.error("❌ Error during production cleanup:", e.message);
    } finally {
        process.exit();
    }
}

runProductionCleanup();
