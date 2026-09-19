const { query } = require('./config/database');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713'; // From your logs

async function runTenantAudit() {
    try {
        console.log(`--- AUDIT FOR TENANT: ${TENANT_ID} ---`);
        
        const users = await query('SELECT id, email, first_name, last_name, business_name FROM users WHERE tenant_id = $1', [TENANT_ID]);
        const collections = await query('SELECT id, name, created_by, is_active FROM collections WHERE tenant_id = $1', [TENANT_ID]);
        
        console.log('\n[USERS FOUND]');
        console.table(users.rows.map(u => ({
            ID: u.id,
            Email: u.email,
            Name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
            Business: u.business_name || 'N/A'
        })));

        console.log('\n[COLLECTIONS FOUND]');
        console.table(collections.rows.map(c => ({
            ID: c.id,
            Name: c.name,
            CreatorID: c.created_by,
            Active: c.is_active
        })));

    } catch (e) {
        console.error('Audit failed:', e.message);
    } finally {
        process.exit(0);
    }
}

runTenantAudit();
