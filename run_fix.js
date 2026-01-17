const { pool } = require('./config/database');
const fs = require('fs');
const path = require('path');

async function runFix() {
    console.log('🔧 Running Database Fixes...\n');

    try {
        const sql = fs.readFileSync(path.join(__dirname, 'modules/marketing/database/fix_coupons.sql'), 'utf8');
        await pool.query(sql);
        console.log('✅ Coupons table patched successfully');
    } catch (err) {
        console.error('❌ Failed to patch coupons:', err.message);
    }

    process.exit();
}

runFix();
