
const { pool } = require('../config/database');

async function migrate() {
    try {
        console.log('Adding thumbnail_url to collections table...');
        await pool.query(`ALTER TABLE collections ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`);
        console.log('✓ thumbnail_url added successfully');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await pool.end();
    }
}

migrate();
