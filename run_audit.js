const { query } = require('./config/database');
const fs = require('fs');

async function audit() {
    const results = {};
    try {
        const users = await query('SELECT id, email, first_name, last_name, business_name FROM users');
        const collections = await query('SELECT id, name, slug, created_by, is_active FROM collections');
        const products = await query('SELECT id, name, created_by FROM products');

        results.users = users.rows;
        results.collections = collections.rows;
        results.products_sample = products.rows.slice(0, 20); // Just a sample

        fs.writeFileSync('vendor_audit.json', JSON.stringify(results, null, 2));
    } catch (e) {
        fs.writeFileSync('vendor_audit.json', JSON.stringify({ error: e.message }, null, 2));
    } finally {
        process.exit(0);
    }
}
audit();
