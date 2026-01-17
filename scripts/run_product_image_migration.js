const { query } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        console.log('Running migration 016_add_product_image.sql...');
        const sql = fs.readFileSync(path.join(__dirname, '../migrations', '016_add_product_image.sql'), 'utf8');
        await query(sql);
        console.log('Migration completed successfully.');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        process.exit(0);
    }
}

runMigration();
