const { query } = require('../config/database');

async function up() {
    console.log('Adding business_description column to users table...');
    await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS business_description TEXT;');
    console.log('Migration 068 complete.');
}

async function down() {
    console.log('Removing business_description column from users table...');
    await query('ALTER TABLE users DROP COLUMN IF EXISTS business_description;');
}

module.exports = { up, down };
