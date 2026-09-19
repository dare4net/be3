/**
 * Migration 089: Add color column to menu_items
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 089_add_color_to_menu_items.js');

    await query(`
        ALTER TABLE menu_items
        ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT NULL;
    `);

    console.log('  ✓ Added color column to menu_items');
    console.log('Migration complete: 089_add_color_to_menu_items.js');
}

async function down() {
    await query(`ALTER TABLE menu_items DROP COLUMN IF EXISTS color;`);
    console.log('Rolled back: 089_add_color_to_menu_items.js');
}

module.exports = { up, down };
