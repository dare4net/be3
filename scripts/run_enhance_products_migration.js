const { query } = require('../config/database');
const fs = require('fs');

async function runMigration() {
    try {
        console.log('Enhancing products table...');

        const sql = fs.readFileSync('./migrations/015_enhance_products.sql', 'utf8');
        await query(sql);

        console.log('✓ Products enhancement migration completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('✗ Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
