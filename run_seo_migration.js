const fs = require('fs');
const path = require('path');
const { pool } = require('./config/database');

async function runMigration() {
    console.log('=== Running SEO Metadata Expansion Migration ===\n');

    const migrationPath = path.join(__dirname, 'migrations', '025_expand_seo_metadata.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    try {
        console.log('Executing migration...');
        await pool.query(sql);
        console.log('✅ Migration completed successfully!');

        // Verify columns were added
        const result = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'pages' 
            AND column_name IN ('og_title', 'og_description', 'twitter_card', 'canonical_url', 'robots', 'structured_data')
            ORDER BY column_name
        `);

        console.log(`\n✅ Added ${result.rows.length} new columns to pages table:`);
        result.rows.forEach(col => {
            console.log(`  - ${col.column_name} (${col.data_type})`);
        });

        // Check seo_presets table
        const presetCheck = await pool.query(`
            SELECT COUNT(*) as exists 
            FROM information_schema.tables 
            WHERE table_name = 'seo_presets'
        `);

        if (presetCheck.rows[0].exists > 0) {
            console.log('\n✅ seo_presets table created successfully');
        }

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

runMigration();
