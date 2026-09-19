/**
 * Migration: Register Location Module
 * Adds location module to the modules table
 */

const { query } = require('../config/database');

async function up() {
    console.log('Registering location module...');

    await query(`
        INSERT INTO modules (name, display_name, description, is_core, mount_path, version)
        VALUES (
            'location',
            'Location Management',
            'Vendor location management with geographic scope support',
            false,
            '/location',
            '1.0.0'
        )
        ON CONFLICT (name) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            description = EXCLUDED.description,
            mount_path = EXCLUDED.mount_path,
            version = EXCLUDED.version,
            updated_at = NOW();
    `);

    console.log('✓ Location module registered successfully');
}

async function down() {
    console.log('Unregistering location module...');
    await query(`DELETE FROM modules WHERE name = 'location';`);
    console.log('✓ Location module unregistered');
}

module.exports = { up, down };
