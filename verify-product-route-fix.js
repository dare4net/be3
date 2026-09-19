const { query } = require('./config/database');
const PermissionService = require('./platform/core/roles/services/PermissionService');

async function verify() {
    try {
        const email = 'dare@gmail.com';
        const userRes = await query('SELECT id, tenant_id FROM users WHERE email = $1', [email]);
        const user = userRes.rows[0];
        const tid = user.tenant_id;

        console.log(`Verifying Product Creation for: ${email}`);

        // Mocking the permission context that would be in the route
        const context = await PermissionService.getUserPermissionContext(tid, user.id);
        const { isVendor, vendorName, categoryAccess: { hasUnrestrictedAccess } } = context;

        console.log(`Context: isVendor=${isVendor}, vendorName=${vendorName}, hasUnrestrictedAccess=${hasUnrestrictedAccess}`);

        // If this part of the code (below) runs without ReferenceError, we are good
        const tags = [];
        if (isVendor && vendorName && !hasUnrestrictedAccess && !tags.includes(vendorName)) {
            tags.push(vendorName);
        }
        console.log(`Final tags for product creation: ${JSON.stringify(tags)}`);

        if (tags.includes(vendorName)) {
            console.log('✓ SUCCESS: Tags correctly include vendor name');
        } else {
            console.log('✗ FAILURE: Vendor name not found in tags');
        }

        process.exit(0);
    } catch (e) {
        console.error('✗ ERROR encountered:', e.message);
        process.exit(1);
    }
}

verify();
