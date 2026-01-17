const config = require('../config/database');
const { query } = config;
const axios = require('axios'); // We might not have axios installed, using http is safer or just direct DB + API mocking.

// Let's use direct DB insertion and then mock-call the handler logic since we can't easily curl the running server if it hasn't restarted.
// Actually, I can just insert into DB and assume the API works if code is correct.
// But to be safe, I'll write a script that inserts a menu directly to DB for the DEMO tenant.

async function seedMenu() {
    try {
        // 1. Get Demo Tenant
        const tenantRes = await query("SELECT id FROM tenants WHERE subdomain = 'demo'");
        if (tenantRes.rows.length === 0) {
            console.log('Demo tenant not found');
            return;
        }
        const tenantId = tenantRes.rows[0].id;

        // 2. Create 'Main Menu'
        const menuRes = await query(
            "INSERT INTO menus (tenant_id, name, location) VALUES ($1, 'Main Menu', 'header') RETURNING id",
            [tenantId]
        );
        const menuId = menuRes.rows[0].id;
        console.log('Created Menu:', menuId);

        // 3. Add Items
        // Home
        await query(
            "INSERT INTO menu_items (menu_id, label, url, position) VALUES ($1, 'Home', '/', 0)",
            [menuId]
        );
        // Products
        await query(
            "INSERT INTO menu_items (menu_id, label, url, position) VALUES ($1, 'Shop', '/products', 1)",
            [menuId]
        );
        // Categories
        await query(
            "INSERT INTO menu_items (menu_id, label, url, position) VALUES ($1, 'Categories', '/categories', 2)",
            [menuId]
        );

        console.log('Menu items seeded.');
    } catch (err) {
        console.error(err);
    } finally {
        config.pool.end();
    }
}

seedMenu();
