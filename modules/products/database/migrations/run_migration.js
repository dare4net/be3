const fs = require('fs');
const path = require('path');
const { pool } = require('../../../../config/database');

async function migrate() {
    console.log('Applying Category Migrations...');

    const sqlValues = fs.readFileSync(path.join(__dirname, '001_add_categories.sql'), 'utf8');

    try {
        await pool.query(sqlValues);
        console.log('✅ Categories table created!');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
    } finally {
        process.exit();
    }
}

migrate();
