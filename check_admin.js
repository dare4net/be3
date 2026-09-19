const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function run() {
    try {
        const res = await query(`
            SELECT u.id, u.email, u.business_name, string_agg(r.name, ', ') as roles 
            FROM users u 
            JOIN user_roles ur ON u.id = ur.user_id 
            JOIN roles r ON ur.role_id = r.id 
            WHERE u.tenant_id = $1 AND u.email = $2
            GROUP BY u.id, u.email, u.business_name
        `, [tid, 'admin@demo.com']);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
