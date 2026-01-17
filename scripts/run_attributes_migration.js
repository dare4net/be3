const { query } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        console.log('Running migration 017_create_attributes_system.sql...');
        const sql = fs.readFileSync(path.join(__dirname, '../migrations', '017_create_attributes_system.sql'), 'utf8');
        await query(sql);
        console.log('Migration completed successfully.');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        process.exit(0);
    }
}

runMigration();
