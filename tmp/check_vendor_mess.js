const { query, pool } = require('../config/database');

async function checkDatabaseMess() {
    try {
        console.log('\n--- 1. Checking System Attributes ---');
        const sysAttr = await query(`SELECT id, label, options FROM system_attributes WHERE code = 'vendor'`);
        if (sysAttr.rows.length > 0) {
            console.log('Vendor Attribute Options array:', sysAttr.rows[0].options);
        } else {
            console.log('Vendor Attribute not found.');
        }

        console.log('\n--- 2. Checking Actual Vendor User Info vs Collection Names ---');
        const vendors = await query(`
            SELECT u.id, u.business_name, u.first_name, u.last_name, 
                   COUNT(p.id) as product_count,
                   (SELECT name FROM collections c WHERE c.created_by = u.id LIMIT 1) as collection_name
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            LEFT JOIN products p ON p.created_by = u.id
            WHERE r.name = 'Vendor'
            GROUP BY u.id, u.business_name, u.first_name, u.last_name
            ORDER BY u.business_name
        `);
        console.table(vendors.rows);

        console.log('\n--- 3. Checking Product Vendor Attributes Currently Assigned ---');
        const prodAttrs = await query(`
            SELECT attributes->>'vendor' as assigned_vendor, COUNT(id) as product_count
            FROM products
            WHERE attributes ? 'vendor'
            GROUP BY assigned_vendor
        `);
        console.table(prodAttrs.rows);

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

checkDatabaseMess();
