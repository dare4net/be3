const fs = require('fs');
const path = require('path');
const { query, pool } = require('../config/database');

async function runMigration() {
    try {
        const sqlPath = path.join(__dirname, '../migrations/020_advanced_theming.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Executing migration 020...');
        await query(sql);
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

runMigration();
