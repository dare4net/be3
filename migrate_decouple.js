const { pool } = require('./config/database');
const fs = require('fs');
const path = require('path');

async function runDecouple() {
    console.log('🚀 Migrating Decoupled Attributes...\n');
    try {
        const sql = fs.readFileSync(path.join(__dirname, 'modules/products/database/migrations/003_decoupled_attributes.sql'), 'utf8');
        await pool.query(sql);
        console.log('✅ Decoupled attributes schema applied');
    } catch (err) {
        console.error('❌ Failed:', err.message);
    }
    process.exit();
}

runDecouple();
