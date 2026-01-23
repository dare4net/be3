const { query } = require('./config/database');

async function checkCategories() {
    try {
        const tenants = await query('SELECT id, name FROM tenants');
        console.log('Found tenants:', tenants.rows.length);

        for (const tenant of tenants.rows) {
            const cats = await query('SELECT COUNT(*) FROM categories WHERE tenant_id = $1', [tenant.id]);
            console.log(`Tenant ${tenant.name} (${tenant.id}): ${cats.rows[0].count} categories`);
        }
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkCategories();
