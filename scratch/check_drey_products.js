const { query } = require('../config/database');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function check() {
    try {
        console.log(`Searching for vendor: dare@gmail.com within tenant ${TENANT_ID}`);
        const userRes = await query('SELECT id, business_name FROM users WHERE email = $1 AND tenant_id = $2', ['dare@gmail.com', TENANT_ID]);
        
        if (userRes.rows.length === 0) {
            console.log('Vendor not found');
            return;
        }

        const user = userRes.rows[0];
        console.log(`Found Vendor: ${user.business_name} (${user.id})`);

        const pRes = await query(`
            SELECT id, name, sku, attributes->>'vendor' as vendor_attr, status, created_at
            FROM products 
            WHERE tenant_id = $3
            AND (
                created_by = $1 
                OR attributes->>'vendor' = $2 
                OR tags @> ARRAY[$2]::text[]
            )
            ORDER BY created_at DESC
        `, [user.id, user.business_name, TENANT_ID]);

        console.log('\n--- PRODUCT LIST ---');
        pRes.rows.forEach(p => {
            console.log(`${p.id} | ${p.sku || 'NO-SKU'} | ${p.name} (Attr: ${p.vendor_attr})`);
        });
        
        console.log(`\nTotal Products Found: ${pRes.rows.length}`);

    } catch(e) {
        console.error('Error running check:', e);
    } finally {
        process.exit();
    }
}

check();
