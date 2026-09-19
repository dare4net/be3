const { query } = require('../config/database');

exports.up = async function () {
    console.log('--- Migration: Add created_by to collections ---');
    try {
        await query(`ALTER TABLE collections ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id)`);
        console.log('✓ Migration successful');
    } catch (error) {
        console.error('Migration failed:', error);
        throw error;
    }
};

exports.down = async function () {
    await query(`ALTER TABLE collections DROP COLUMN IF EXISTS created_by`);
};
