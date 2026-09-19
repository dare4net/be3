const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

async function run() {
    try {
        console.log('Connecting to database...');
        await client.connect();

        console.log('1. Ensuring wildcard (*) permission exists...');
        await client.query(`
        INSERT INTO permissions (name, module, description)
        VALUES ('*', 'system', 'Full Access')
        ON CONFLICT (name) DO NOTHING;
      `);

        const permRes = await client.query("SELECT id FROM permissions WHERE name = '*'");
        const permId = permRes.rows[0].id;
        console.log(`   Wildcard permission ID: ${permId}`);

        console.log('2. Finding all Admin roles...');
        const roleRes = await client.query("SELECT id, tenant_id FROM roles WHERE name = 'Admin'");
        console.log(`   Found ${roleRes.rows.length} Admin roles.`);

        for (const role of roleRes.rows) {
            console.log(`   - Updating Admin role ${role.id} (Tenant: ${role.tenant_id})`);
            await client.query(`
            INSERT INTO role_permissions (tenant_id, role_id, permission_id)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
          `, [role.tenant_id, role.id, permId]);
        }

        console.log('\n✅ FAILURE PROOF UPDATE COMPLETE.');
        console.log('Please ask the user to LOG OUT and LOG BACK IN to see the changes.');

        await client.end();
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

run();
