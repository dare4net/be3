const { query } = require('./config/database');

async function checkVendors() {
    try {
        const products = await query('SELECT id, name, created_by FROM products WHERE created_by IS NOT NULL LIMIT 5');
        console.log('Products:', products.rows);

        const creators = [...new Set(products.rows.map(p => p.created_by))];
        console.log('Creators:', creators);

        for (const cid of creators) {
            const user = await query('SELECT id, business_name FROM users WHERE id = $1', [cid]);
            console.log(`User ${cid}:`, user.rows[0]);

            const col = await query('SELECT name FROM collections WHERE created_by = $1', [cid]);
            console.log(`Collection for ${cid}:`, col.rows[0]);
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

checkVendors();
