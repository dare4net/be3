/**
 * Migration 088: Add dropdown_mode column to menu_items
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 088_add_dropdown_mode_to_menu_items.js');

    await query(`
        ALTER TABLE menu_items
        ADD COLUMN IF NOT EXISTS dropdown_mode VARCHAR(20) DEFAULT 'auto';
    `);

    // Backfill any nulls
    await query(`
        UPDATE menu_items SET dropdown_mode = 'auto' WHERE dropdown_mode IS NULL;
    `);

    console.log('  ✓ Added dropdown_mode column to menu_items');
    console.log('Migration complete: 088_add_dropdown_mode_to_menu_items.js');
}

async function down() {
    await query(`ALTER TABLE menu_items DROP COLUMN IF EXISTS dropdown_mode;`);
    console.log('Rolled back: 088_add_dropdown_mode_to_menu_items.js');
}

module.exports = { up, down };
