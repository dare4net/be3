const { query } = require('../config/database');
const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function check() {
    const res = await query(`
        SELECT 
            p.id, p.name, p.created_by, 
            p.attributes->>'vendor' AS vendor_attr,
            creator.business_name AS creator_business_name,
            vendor_user.id AS vendor_user_id,
            vendor_user.business_name AS vendor_business_name
        FROM products p
        LEFT JOIN users creator ON creator.id = p.created_by AND creator.tenant_id = p.tenant_id
        LEFT JOIN users vendor_user ON LOWER(vendor_user.business_name) = LOWER(p.attributes->>'vendor') AND vendor_user.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 
          AND p.deleted_at IS NULL
          AND p.created_by IS NOT NULL
          AND p.attributes->>'vendor' IS NOT NULL
          AND p.created_by != vendor_user.id
    `, [TENANT_ID]);

    if (res.rows.length === 0) {
        console.log('✅ No mismatches! created_by and attributes.vendor always point to the same user.');
    } else {
        console.log(`⚠️  Found ${res.rows.length} mismatches:\n`);
        res.rows.forEach(r => {
            console.log(`  Product: ${r.name.substring(0, 50)}`);
            console.log(`    created_by: ${r.created_by} (business: "${r.creator_business_name}")`);
            console.log(`    attr.vendor: "${r.vendor_attr}" -> user: ${r.vendor_user_id} (business: "${r.vendor_business_name}")`);
            console.log('');
        });
    }
}

check().catch(console.error).finally(() => process.exit());
