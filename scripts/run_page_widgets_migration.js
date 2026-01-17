const { query } = require('../config/database');
const fs = require('fs');

async function runMigration() {
    try {
        console.log('Running page_widgets migration...');

        const sql = fs.readFileSync('./migrations/012_page_widgets.sql', 'utf8');
        await query(sql);

        console.log('✓ Migration completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('✗ Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
