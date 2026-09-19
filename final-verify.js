const { query } = require('./config/database');
const RoleService = require('./platform/core/roles/services/RoleService');
const eventBus = require('./platform/events/EventBus');
const { bootstrap } = require('./modules/vendor/index');

async function debug() {
    try {
        await bootstrap({ eventBus, app: {} });

        const email = 'dare@gmail.com';
        const userRes = await query('SELECT id, tenant_id FROM users WHERE email = $1', [email]);
        const user = userRes.rows[0];
        console.log(`User ID: ${user.id}`);

        // 1. Find an existing product
        const pRes = await query('SELECT id, created_by, tags FROM products WHERE tenant_id = $1 LIMIT 1', [user.tenant_id]);
        const product = pRes.rows[0];
        const originalOwner = product.created_by;
        console.log(`Testing with Product: ${product.id} (Owner: ${originalOwner})`);

        // 2. Temporarily take ownership
        await query('UPDATE products SET created_by = $1 WHERE id = $2', [user.id, product.id]);

        // 3. Trigger Vendor Logic
        console.log('--- Triggering Event ---');
        eventBus.emitEvent('role.assigned', {
            tenantId: user.tenant_id,
            userId: user.id,
            roleName: 'Vendor'
        });

        console.log('Waiting 5s for event processing...');
        await new Promise(r => setTimeout(r, 5000));

        // 4. Verify
        console.log('--- Verifying Results ---');
        const colRes = await query('SELECT name FROM collections WHERE created_by = $1', [user.id]);
        const vendorName = colRes.rows[0]?.name;
        console.log('Vendor Name:', vendorName);

        const prodRes = await query('SELECT tags FROM products WHERE id = $1', [product.id]);
        console.log('Product tags:', JSON.stringify(prodRes.rows[0]?.tags));

        if (vendorName && prodRes.rows[0]?.tags?.includes(vendorName)) {
            console.log('✓ SUCCESS: Core flow verified');
        } else {
            console.log('✗ FAILURE: Core flow failed check');
        }

        // Cleanup
        await query('UPDATE products SET created_by = $1 WHERE id = $2', [originalOwner, product.id]);
        process.exit(0);
    } catch (e) {
        console.error('Debug script failed:', e);
        process.exit(1);
    }
}

debug();
