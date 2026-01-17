const { pool } = require('./config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    console.log('🚀 Migrating Attributes Schema...\n');

    try {
        const sql = fs.readFileSync(path.join(__dirname, 'modules/products/database/migrations/002_add_attributes.sql'), 'utf8');
        await pool.query(sql);
        console.log('✅ Attributes schema applied successfully');
    } catch (err) {
        console.error('❌ Failed to migrate attributes:', err.message);
    }

    process.exit();
}

runMigration();
