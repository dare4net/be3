const { query } = require('../config/database');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function check() {
    try {
        const res = await query(`
            SELECT 
                p.id,
                p.name AS product_name,
                p.attributes->>'vendor' AS vendor_attr,
                STRING_AGG(DISTINCT c.name, ', ') AS categories
            FROM products p
            LEFT JOIN product_categories pc ON p.id = pc.product_id
            LEFT JOIN categories c ON pc.category_id = c.id AND c.tenant_id = $1
            WHERE p.tenant_id = $1
              AND p.deleted_at IS NULL
              AND p.is_variant = false
            GROUP BY p.id, p.name, p.attributes
            ORDER BY vendor_attr ASC, p.name ASC
        `, [TENANT_ID]);

        console.log("--- FULL VENDOR PRODUCT LIST ---");
        
        let currentVendor = '';
        res.rows.forEach((p, i) => {
            const vendor = p.vendor_attr || 'UNASSIGNED';
            if (vendor !== currentVendor) {
                console.log(`\n=== ${vendor} ===`);
                currentVendor = vendor;
            }
            console.log(`- ${p.product_name.padEnd(50)} [${p.categories || 'Uncategorized'}]`);
        });

    } catch(e) {
        console.error('Error:', e.message);
    } finally {
        process.exit();
    }
}

check();
