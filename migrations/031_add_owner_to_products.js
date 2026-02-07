const { query } = require('../config/database');

exports.up = async function () {
    console.log('--- Migration: Add created_by to products ---');
    try {
        // 1. Add column
        await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id)`);

        // 2. Try to backfill based on existing vendor tags if possible? 
        // For now, we'll just leave it null for old products or let the repair script handle it if we can match tags to users

        console.log('✓ Migration successful');
    } catch (error) {
        console.error('Migration failed:', error);
        throw error;
    }
};

exports.down = async function () {
    await query(`ALTER TABLE products DROP COLUMN IF EXISTS created_by`);
};
