/**
 * Migration 050: Add default_value to system_attributes and enforce text type
 * 
 * System attributes are always type 'text' and hold a single value or variable.
 * The default_value is automatically applied to products (e.g., '[BUSINESS_NAME]').
 */

const { query } = require('../config/database');

async function up() {
    console.log('[Migration 050] Adding default_value to system_attributes...');

    await query(`ALTER TABLE system_attributes ADD COLUMN IF NOT EXISTS default_value TEXT`);

    // Update existing rows to enforce text type
    await query(`UPDATE system_attributes SET type = 'text' WHERE type != 'text'`);

    console.log('[Migration 050] Done.');
}

async function down() {
    await query(`ALTER TABLE system_attributes DROP COLUMN IF EXISTS default_value`);
}

module.exports = { up, down };
