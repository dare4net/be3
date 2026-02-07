const { query } = require('./config/database');
const PermissionService = require('./platform/core/roles/services/PermissionService');

async function verify() {
    try {
        const email = 'dare@gmail.com';
        const userRes = await query('SELECT id, tenant_id FROM users WHERE email = $1', [email]);
        const user = userRes.rows[0];
        const tid = user.tenant_id;

        console.log(`Verifying for vendor: ${email} (ID: ${user.id})`);

        // Check permission context
        const context = await PermissionService.getUserPermissionContext(tid, user.id);
        console.log('Is Vendor:', context.isVendor);

        // Check collections with created_by filter (simulating the updated route logic)
        const sql = `SELECT id, name, created_by FROM collections WHERE tenant_id = $1 AND (created_by = $2 OR created_by IS NULL)`;
        const res = await query(sql, [tid, user.id]);

        console.log('Collections visible to vendor:', JSON.stringify(res.rows, null, 2));

        if (res.rows.some(r => r.created_by === user.id)) {
            console.log('✓ SUCCESS: Vendor-owned collection is visible');
        } else {
            console.log('✗ FAILURE: Vendor-owned collection NOT found in query');
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

verify();
