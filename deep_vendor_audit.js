const { query } = require('./config/database');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function deepAudit() {
    try {
        console.log(`--- DEEP AUDIT FOR TENANT: ${TENANT_ID} ---`);

        // 1. Get all users with 'Vendor' role in this tenant
        const vendorUsers = await query(`
            SELECT u.id, u.email, u.first_name, u.last_name, u.business_name 
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            WHERE u.tenant_id = $1 AND r.name = 'Vendor'
        `, [TENANT_ID]);

        const report = [];

        for (const user of vendorUsers.rows) {
            const userId = user.id;
            const vendorName = user.business_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Vendor';

            // 2. Check for collection
            const colRes = await query(`
                SELECT id, name, rules, collection_type, is_active 
                FROM collections 
                WHERE tenant_id = $1 AND created_by = $2
            `, [TENANT_ID, userId]);

            const collection = colRes.rows[0] || null;
            let collectionStatus = 'Missing';
            let ruleType = 'N/A';

            if (collection) {
                collectionStatus = collection.is_active ? 'Active' : 'Inactive';
                const rules = collection.rules;
                const usesAttribute = JSON.stringify(rules).includes('"attribute_code": "vendor"');
                ruleType = usesAttribute ? 'New (Attribute)' : 'Old (Tag/Other)';
            }

            // 3. Sample products for this vendor to see if they HAVE the vendor attribute
            const prodRes = await query(`
                SELECT COUNT(*) as total,
                       COUNT(*) FILTER (WHERE attributes->>'vendor' IS NOT NULL) as with_attr
                FROM products 
                WHERE tenant_id = $1 AND created_by = $2
            `, [TENANT_ID, userId]);

            const stats = prodRes.rows[0];

            report.push({
                Email: user.email,
                Name: vendorName,
                Collection: collectionStatus,
                CollectionType: collection?.collection_type || 'N/A',
                RuleLogic: ruleType,
                Products: stats.total,
                WithAttr: stats.with_attr
            });
        }

        console.table(report);

    } catch (e) {
        console.error('Audit failed:', e.message);
    } finally {
        process.exit(0);
    }
}

deepAudit();
