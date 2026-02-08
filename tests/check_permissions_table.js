const { query } = require('../config/database');
async function check() {
    try {
        const res = await query("SELECT * FROM permissions WHERE name = '*'");
        console.log('Permission "*":', res.rows.length > 0 ? 'Exists' : 'NOT FOUND');

        const allPerms = await query("SELECT name FROM permissions LIMIT 10");
        console.log('Sample permissions:', allPerms.rows.map(r => r.name).join(', '));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
