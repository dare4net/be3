const { query } = require('../config/database');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function check() {
    try {
        const res = await query(`
            SELECT 
                p.id,
                p.name AS product_name,
                p.sku,
                p.attributes->>'vendor' AS vendor_attr,
                u.business_name AS owner_business_name,
                u.email AS owner_email,
                STRING_AGG(DISTINCT c.name, ', ') AS categories
            FROM products p
            LEFT JOIN users u ON p.created_by = u.id AND u.tenant_id = $1
            LEFT JOIN product_categories pc ON p.id = pc.product_id
            LEFT JOIN categories c ON pc.category_id = c.id AND c.tenant_id = $1
            WHERE p.tenant_id = $1
              AND p.deleted_at IS NULL
              AND p.is_variant = false
            GROUP BY p.id, p.name, p.sku, p.attributes, u.business_name, u.email
            ORDER BY vendor_attr ASC, p.name ASC
        `, [TENANT_ID]);

        console.log(`\nTotal Products: ${res.rows.length}\n`);
        console.log(`${'#'.padEnd(4)} | ${'Product Name'.padEnd(45)} | ${'Vendor (attr)'.padEnd(20)} | ${'Owner Account'.padEnd(20)} | Categories`);
        console.log('-'.repeat(160));

        res.rows.forEach((p, i) => {
            const num = String(i + 1).padEnd(4);
            const name = (p.product_name || '').substring(0, 44).padEnd(45);
            const vendorAttr = (p.vendor_attr || 'UNASSIGNED').substring(0, 19).padEnd(20);
            const owner = (p.owner_business_name || p.owner_email || 'UNKNOWN').substring(0, 19).padEnd(20);
            const cats = (p.categories || 'Uncategorized');
            console.log(`${num} | ${name} | ${vendorAttr} | ${owner} | ${cats}`);
        });

    } catch(e) {
        console.error('Error:', e.message);
    } finally {
        process.exit();
    }
}

check();
