const { query } = require('./config/database');
const VendorService = require('./modules/vendor/services/VendorService');
const { bootstrap: bootstrapVendor } = require('./modules/vendor/index');
const eventBus = require('./platform/events/EventBus');

async function testThumbnailSync() {
    try {
        console.log('--- Starting Business Thumbnail Sync Test ---');

        // 1. Setup module
        await bootstrapVendor({ eventBus, app: { use: () => { } } });

        const email = 'dare@gmail.com';
        const userRes = await query('SELECT id, tenant_id FROM users WHERE email = $1', [email]);
        const user = userRes.rows[0];
        const tid = user.tenant_id;

        const testThumb = 'https://example.com/vendor-logo.png';

        console.log(`\nStep 1: Updating User with Business Name "Logo Corp" and Thumbnail "${testThumb}"`);
        // We simulate the AuthService.updateUser effect (DB update + event)
        await query(
            'UPDATE users SET business_name = $1, business_thumbnail = $2 WHERE id = $3',
            ['Logo Corp', testThumb, user.id]
        );

        // Emit the event manually as AuthService would
        eventBus.emitEvent('user.profile_updated', {
            tenantId: tid,
            userId: user.id,
            businessName: 'Logo Corp',
            businessThumbnail: testThumb
        });

        // 2. Wait for sync
        console.log('Waiting for VendorService sync...');
        await new Promise(r => setTimeout(r, 2000));

        // 3. Verify Collection
        const colRes = await query('SELECT * FROM collections WHERE created_by = $1', [user.id]);
        const col = colRes.rows[0];

        console.log(`Collection results:`);
        console.log(`- Name: ${col.name}`);
        console.log(`- Slug: ${col.slug}`);
        console.log(`- Thumbnail: ${col.thumbnail_url}`);

        if (col.name === 'Logo Corp' && col.thumbnail_url === testThumb) {
            console.log('\n✓ SUCCESS: Business name and thumbnail synced to collection!');
        } else {
            console.log('\n✗ FAILURE: Sync failed. Collection mismatch.');
        }

        process.exit(0);
    } catch (e) {
        console.error('✗ ERROR:', e);
        process.exit(1);
    }
}

testThumbnailSync();
