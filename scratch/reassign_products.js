const { query } = require('../config/database');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

const BOLA_FOODS_ID = 'bb039752-7b82-45ab-a512-5872f2fcda38';
const DREY_TECH_ID = '5b708d12-e1db-49b0-98e1-4c0a4c9a7750';

// Only targeting the exact mismatched items we audited. No monopolies!
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

async function updateAndList() {
    try {
        console.log("--- EXECUTING SURGICAL REASSIGNMENTS ---");

        // 1. REASSIGN ONLY THE MISMATCHED FOOD TO BOLA FOODS
        const foodUpdate = await query(`
            UPDATE products p
            SET 
                created_by = $2,
                attributes = jsonb_set(attributes, '{vendor}', '"Bola Foods"')
            WHERE p.tenant_id = $1
              AND p.name = ANY($3)
              AND p.attributes->>'vendor' != 'Bola Foods'
            RETURNING p.name, p.attributes->>'vendor' as new_vendor;
        `, [TENANT_ID, BOLA_FOODS_ID, FIX_TO_FOOD]);

        console.log(`Successfully moved ${foodUpdate.rows.length} strict mismatches to Bola Foods.`);

        // 2. REASSIGN ONLY THE MISMATCHED TECH TO DREY TECH STORE
        const techUpdate = await query(`
            UPDATE products p
            SET 
                created_by = $2,
                attributes = jsonb_set(attributes, '{vendor}', '"Drey Tech Store"')
            WHERE p.tenant_id = $1
              AND p.name = ANY($3)
              AND p.attributes->>'vendor' != 'Drey Tech Store'
            RETURNING p.name, p.attributes->>'vendor' as new_vendor;
        `, [TENANT_ID, DREY_TECH_ID, FIX_TO_TECH]);

        console.log(`Successfully moved ${techUpdate.rows.length} strict mismatches to Drey Tech Store.`);

        console.log("\n--- UNCATEGORIZED PRODUCTS LIST ---");
        const uncategorized = await query(`
            SELECT p.id, p.name, p.attributes->>'vendor' as vendor_attr 
            FROM products p
            LEFT JOIN product_categories pc ON p.id = pc.product_id
            WHERE p.tenant_id = $1
              AND p.is_variant = false
              AND p.deleted_at IS NULL
              AND pc.category_id IS NULL
            ORDER BY vendor_attr, p.name
        `, [TENANT_ID]);
        
        uncategorized.rows.forEach(p => {
            console.log(`- ${p.name.padEnd(50)} [ Vendor: ${p.vendor_attr} ]`);
        });

    } catch(e) {
        console.error("Error:", e.message);
    } finally {
        process.exit();
    }
}

updateAndList();
