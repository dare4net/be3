/**
 * Migration 073: Add Email Verification Expiry
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 073_add_email_verification_expiry.js');
    try {
        await query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP;
        `);
    } catch (e) {
        console.error('Migration 073 failed:', e.message);
        throw e;
    }
    console.log('Migration complete: 073_add_email_verification_expiry.js');
}

async function down() {
    console.log('Rolling back: 073_add_email_verification_expiry.js');
    await query(`
        ALTER TABLE users
        DROP COLUMN IF EXISTS email_verification_expires;
    `);
    console.log('Rollback complete: 073_add_email_verification_expiry.js');
}

module.exports = { up, down };
