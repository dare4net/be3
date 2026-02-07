// Check permissions in database
const pool = require('./database/pool');

async function checkPermissions() {
    try {
        // Check all permissions
        const permsResult = await pool.query('SELECT name, module FROM permissions ORDER BY module, name');
        console.log('\n=== PERMISSIONS IN DATABASE ===');
        console.log(`Total: ${permsResult.rows.length}`);

        const byModule = {};
        permsResult.rows.forEach(p => {
            if (!byModule[p.module]) byModule[p.module] = [];
            byModule[p.module].push(p.name);
        });

        Object.keys(byModule).sort().forEach(module => {
            console.log(`\n${module.toUpperCase()}: ${byModule[module].length} permissions`);
            byModule[module].forEach(p => console.log(`  - ${p}`));
        });

        // Check if settings.view exists
        const settingsCheck = await pool.query("SELECT * FROM permissions WHERE name = 'settings.view'");
        console.log('\n=== SETTINGS.VIEW CHECK ===');
        console.log('Exists:', settingsCheck.rows.length > 0);
        if (settingsCheck.rows.length > 0) {
            console.log('Details:', settingsCheck.rows[0]);
        }

        // Check Admin role permissions
        const adminPerms = await pool.query(`
            SELECT DISTINCT p.name 
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            JOIN roles r ON rp.role_id = r.id
            WHERE r.name = 'Admin'
            ORDER BY p.name
        `);
        console.log('\n=== ADMIN ROLE PERMISSIONS ===');
        console.log('Permissions:', adminPerms.rows.map(r => r.name));

        await pool.end();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkPermissions();
