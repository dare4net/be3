const { query } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
    try {
        // 1. Products: whats_in_the_box column
        console.log('Running: 004_add_whats_in_the_box.sql ...');
        const sql1 = fs.readFileSync(
            path.join(__dirname, '../modules/products/database/migrations/004_add_whats_in_the_box.sql'), 'utf8'
        );
        await query(sql1);
        console.log('✓ whats_in_the_box column added');

        // 2. Reviews: all 6 tables
        console.log('\nRunning: reviews/database/schema.sql ...');
        const sql2 = fs.readFileSync(
            path.join(__dirname, '../modules/reviews/database/schema.sql'), 'utf8'
        );
        await query(sql2);
        console.log('✓ Reviews tables created');

        console.log('\n✅ All migrations completed successfully');
    } catch (e) {
        console.error('Migration failed:', e.message);
    } finally {
        process.exit();
    }
}

runMigrations();
