const { pool } = require('./config/database');

async function analyzeReferenceTenant() {
    const tenantId = '129d825e-9483-4899-89d6-c4552e0e5938';
    console.log(`Analyzing Tenant: ${tenantId}`);

    try {
        // 1. Get Tenant Info
        const tRes = await pool.query("SELECT * FROM tenants WHERE id = $1", [tenantId]);
        console.log('Tenant:', tRes.rows[0]);

        // 2. Get Roles
        const rRes = await pool.query("SELECT id, name, description FROM roles WHERE tenant_id = $1", [tenantId]);
        const roles = rRes.rows;

        console.log('\n--- Roles & Permissions ---');
        for (const role of roles) {
            console.log(`\n[Role] ${role.name} (${role.description})`);
            const pRes = await pool.query(`
                SELECT p.slug, p.description 
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                WHERE rp.role_id = $1
            `, [role.id]);

            if (pRes.rows.length === 0) {
                console.log('  (No permissions)');
            } else {
                pRes.rows.forEach(p => console.log(`  - ${p.slug}`));
            }
        }

        // 3. Get Users to understand the "two account" pattern
        console.log('\n--- Users ---');
        const uRes = await pool.query("SELECT email, first_name FROM users WHERE tenant_id = $1", [tenantId]);
        uRes.rows.forEach(u => console.log(`- ${u.email} (${u.first_name})`));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

analyzeReferenceTenant();
