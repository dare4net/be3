const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 071_add_oauth_to_users.js');
    try {
        await query(`
            ALTER TABLE users
            ADD COLUMN google_id VARCHAR(255) UNIQUE,
            ALTER COLUMN password_hash DROP NOT NULL;
        `);
    } catch (e) {
        if (e.code === '42701') {
            console.log('Column google_id already exists, skipping...');
        } else {
            throw e;
        }
    }
    console.log('Migration complete: 071_add_oauth_to_users.js');
}

async function down() {
    console.log('Rolling back: 071_add_oauth_to_users.js');
    // Note: If rolling back, we might have users with NULL passwords. 
    // Best practice is to set a dummy password or delete them before setting NOT NULL,
    // but for simplicity in the down migration, we just attempt it.
    await query(`
        ALTER TABLE users
        DROP COLUMN google_id,
        ALTER COLUMN password_hash SET NOT NULL;
    `);
    console.log('Rollback complete: 071_add_oauth_to_users.js');
}

module.exports = { up, down };
