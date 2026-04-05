const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function auditBe3() {
    try {
        // 1. Confirm Be3 products count
        const be3Res = await query(`
            SELECT count(*) 
            FROM products 
            WHERE tenant_id = $1 AND (attributes->>'vendor' = 'Be3' OR tags @> ARRAY['Be3'])
        `, [tid]);
        console.log(`Products with 'Be3' vendor/tag: ${be3Res.rows[0].count}`);

        // 2. Identify 'Home Decor' category
        const catRes = await query(`
            SELECT id, name FROM categories WHERE tenant_id = $1 AND name ILIKE '%Home Decor%'
        `, [tid]);
        console.log('Home Decor categories found:', catRes.rows);

        // 3. Get all vendors to distribute to
        const vendorRes = await query(`
            SELECT u.id, u.email, u.business_name 
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            WHERE u.tenant_id = $1 AND r.name = 'Vendor'
            UNION
            SELECT u.id, u.email, u.business_name
            FROM users u
            WHERE u.tenant_id = $1 AND u.email = 'admin@demo.com'
        `, [tid]);
        console.log('Target vendors:', vendorRes.rows);

        // 4. Sample products in Home Decor with Be3
        if (catRes.rows.length > 0) {
            const homeDecorId = catRes.rows[0].id;
            const homeDecorBe3 = await query(`
                SELECT count(*) FROM products 
                WHERE tenant_id = $1 
                AND category_id = $2
                AND (attributes->>'vendor' = 'Be3' OR tags @> ARRAY['Be3'])
            `, [tid, homeDecorId]);
            console.log(`Be3 products in Home Decor: ${homeDecorBe3.rows[0].count}`);
        }

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
auditBe3();
