const { query } = require('./config/database');
const fs = require('fs');
const path = require('path');

async function run() {
    try {
        const sqlPath = path.join(__dirname, 'migrations', '029_add_collections.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('Running migration: 029_add_collections.sql');
        await query(sql);
        console.log('Migration completed successfully!');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit();
    }
}

run();
