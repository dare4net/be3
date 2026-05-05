/**
 * Migration 072: Add User Profile Fields
 * 
 * Adds avatar_url, gender, and dob columns to the users table.
 */

const up = async (query) => {
    console.log('Running migration 072: Adding user profile fields...');
    
    await query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(1024),
        ADD COLUMN IF NOT EXISTS gender VARCHAR(50),
        ADD COLUMN IF NOT EXISTS dob DATE;
    `);
    
    console.log('Successfully added user profile fields.');
};

const down = async (query) => {
    console.log('Reverting migration 072: Removing user profile fields...');
    
    await query(`
        ALTER TABLE users
        DROP COLUMN IF EXISTS avatar_url,
        DROP COLUMN IF EXISTS gender,
        DROP COLUMN IF EXISTS dob;
    `);
};

module.exports = {
    up,
    down,
};
