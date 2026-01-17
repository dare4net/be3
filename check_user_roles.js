const { pool } = require('./config/database');

async function checkUserRoles() {
    const tenantId = '129d825e-9483-4899-89d6-c4552e0e5938';
    try {
        const uRes = await pool.query("SELECT id, email, first_name FROM users WHERE tenant_id = $1", [tenantId]);
        for (const user of uRes.rows) {
            console.log(`\nUser: ${user.email}`);
            const rRes = await pool.query(`
                SELECT r.name 
                FROM roles r
                JOIN user_roles ur ON r.id = ur.role_id
                WHERE ur.user_id = $1
            `, [user.id]);
            rRes.rows.forEach(r => console.log(`  - Role: ${r.name}`));
        }
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

checkUserRoles();
