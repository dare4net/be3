const { query } = require('./config/database');

async function checkTenants() {
    try {
        const res = await query(`SELECT id, name FROM tenants WHERE id = '3d5a4944-595d-4444-9333-333333333333'`);
        console.log(`Tenant exists: ${res.rows.length > 0}`);
        if (res.rows.length > 0) console.log(res.rows[0]);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

checkTenants();
