const { query } = require('./config/database');
const VendorService = require('./modules/vendor/services/VendorService');

async function debug() {
    try {
        const email = 'dare@gmail.com';
        const userRes = await query('SELECT id, tenant_id, email FROM users WHERE email = $1', [email]);
        const user = userRes.rows[0];
        console.log(`User: ${user.email} (ID: ${user.id})`);

        // Direct call for testing
        console.log('--- Calling initializeVendor Directly ---');
        await VendorService.initializeVendor(user.tenant_id, user.id);

        console.log('--- Checking DB ---');
        const res = await query('SELECT id, name, created_by FROM collections WHERE created_by = $1', [user.id]);
        console.log('Result:', JSON.stringify(res.rows, null, 2));

        if (res.rows.length > 0) {
            console.log('✓ Success: Collection found');
        } else {
            console.log('✗ Failure: Collection NOT found');
            const all = await query('SELECT id, name, created_by FROM collections');
            console.log('All Collections created_by values:', all.rows.map(r => r.created_by));
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

debug();
