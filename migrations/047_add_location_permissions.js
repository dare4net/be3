/**
 * Migration: Add Location Permissions
 * Seeds location module permissions
 */

const { query } = require('../config/database');

async function up() {
    console.log('Adding location permissions...');

    const permissions = [
        { name: 'location.view', module: 'location', description: 'View business locations' },
        { name: 'location.create', module: 'location', description: 'Create new locations' },
        { name: 'location.edit', module: 'location', description: 'Edit existing locations' },
        { name: 'location.delete', module: 'location', description: 'Delete locations' },
        { name: 'location.manage', module: 'location', description: 'Full location management' },
    ];

    for (const perm of permissions) {
        await query(`
            INSERT INTO permissions (name, module, description)
            VALUES ($1, $2, $3)
            ON CONFLICT (name) DO UPDATE SET
                module = EXCLUDED.module,
                description = EXCLUDED.description,
                updated_at = NOW();
        `, [perm.name, perm.module, perm.description]);
    }

    console.log('✓ Location permissions added successfully');
}

async function down() {
    console.log('Removing location permissions...');
    await query(`DELETE FROM permissions WHERE module = 'location';`);
    console.log('✓ Location permissions removed');
}

module.exports = { up, down };
