
require('dotenv').config();
const { query } = require('./config/database');

async function migrate() {
    try {
        console.log('Starting migration: Add parent_id to page_widgets');

        // Check if column exists
        const checkSql = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'page_widgets' AND column_name = 'parent_id'
        `;
        const checkRes = await query(checkSql);

        if (checkRes.rows.length === 0) {
            console.log('Adding parent_id column...');
            await query(`ALTER TABLE page_widgets ADD COLUMN parent_id UUID REFERENCES page_widgets(id) ON DELETE CASCADE`);
            console.log('Column added successfully.');
        } else {
            console.log('Column already exists. Skipping.');
        }

        console.log('Migration complete.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
