const { query } = require('../config/database');
const fs = require('fs');

async function runMigration() {
    try {
        console.log('Running pages migration...');

        const sql = fs.readFileSync('./migrations/013_pages.sql', 'utf8');
        await query(sql);

        console.log('✓ Pages migration completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('✗ Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
