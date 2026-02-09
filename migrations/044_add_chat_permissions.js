const { query } = require('../config/database');
const permissions = require('../platform/core/roles/seeds/all-permissions');

async function run() {
    console.log('Seeding Chat Permissions...');

    try {
        // 1. Insert Permissions
        const chatPerms = permissions.CHAT;
        if (!chatPerms) {
            console.error('ERROR: permissions.CHAT is undefined. Check all-permissions.js export.');
            process.exit(1);
        }

        for (const perm of chatPerms) {
            await query(`
                INSERT INTO permissions (name, module, description)
                VALUES ($1, $2, $3)
                ON CONFLICT (name) DO UPDATE SET 
                    module = EXCLUDED.module,
                    description = EXCLUDED.description;
            `, [perm.name, perm.module, perm.description]);
        }
        console.log(`✓ Inserted ${chatPerms.length} chat permissions.`);

        // 2. Assign to Admin Role (for all tenants)
        const adminRoles = await query(`SELECT id, tenant_id FROM roles WHERE name = 'Admin'`);

        if (adminRoles.rows.length > 0) {
            console.log(`Found ${adminRoles.rows.length} Admin roles. Assigning permissions...`);

            for (const role of adminRoles.rows) {
                for (const perm of chatPerms) {
                    // Get permission ID
                    const permRes = await query(`SELECT id FROM permissions WHERE name = $1`, [perm.name]);

                    if (!permRes || !permRes.rows || permRes.rows.length === 0) {
                        console.error(`ERROR: Permission ${perm.name} not found despite insertion.`);
                        continue;
                    }

                    const permId = permRes.rows[0].id;

                    try {
                        // Check if already assigned to avoid ON CONFLICT errors if constraint missing
                        const checkRes = await query(`
                            SELECT 1 FROM role_permissions 
                            WHERE role_id = $1 AND permission_id = $2
                        `, [role.id, permId]);

                        if (checkRes.rows.length === 0) {
                            await query(`
                                INSERT INTO role_permissions (role_id, permission_id)
                                VALUES ($1, $2)
                            `, [role.id, permId]);
                        }
                    } catch (err) {
                        console.error(`Failed to assign perm ${permId} to role ${role.id}`, err);
                    }
                }
            }
            console.log('✓ Chat permissions assigned to all Admin roles.');
        } else {
            console.log('! No Admin roles found to assign permissions to.');
        }

    } catch (e) {
        console.error('✗ Failed to seed chat permissions:', e);
    }

    console.log('Migration complete.');
    process.exit(0);
}

run();
