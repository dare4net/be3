const { query } = require('./config/database');

async function listAllVendorDetails() {
    try {
        console.log('--- ALL USERS WITH BUSINESS NAMES ---');
        const users = await query('SELECT id, email, first_name, last_name, business_name, created_at FROM users ORDER BY created_at DESC');
        console.table(users.rows.map(u => ({
            id: u.id,
            email: u.email,
            name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
            business: u.business_name || 'N/A',
            joined: u.created_at
        })));

        console.log('\n--- ALL COLLECTIONS ---');
        const collections = await query('SELECT id, name, slug, created_by, is_active, created_at FROM collections ORDER BY created_at DESC');
        console.table(collections.rows.map(c => ({
            id: c.id,
            name: c.name,
            creator: c.created_by || 'SYSTEM',
            active: c.is_active,
            created: c.created_at
        })));

        console.log('\n--- VENDOR-COLLECTION MAPPING ---');
        const mapping = [];
        for (const user of users.rows) {
            const userCollections = collections.rows.filter(c => c.created_by === user.id);
            mapping.push({
                user_email: user.email,
                business_name: user.business_name || 'N/A',
                collections: userCollections.map(c => c.name).join(', ') || 'NONE'
            });
        }
        console.table(mapping);

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

listAllVendorDetails();
