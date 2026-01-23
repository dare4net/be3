const fs = require('fs');
const path = require('path');
const { pool } = require('./config/database');

async function runMigration() {
    console.log('=== Running Product & Category SEO Migration ===\n');

    const migrationPath = path.join(__dirname, 'migrations', '026_product_category_seo.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    try {
        console.log('Executing migration...');
        await pool.query(sql);
        console.log('✅ Migration completed successfully!');

        // Verify categories table
        const catCheck = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'categories' 
            AND column_name IN ('og_title', 'og_description', 'structured_data', 'robots')
            ORDER BY column_name
        `);

        console.log(`\n✅ Added ${catCheck.rows.length} SEO columns to categories table:`);
        catCheck.rows.forEach(col => {
            console.log(`  - ${col.column_name} (${col.data_type})`);
        });

        // Verify products table
        const prodCheck = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'products' 
            AND column_name IN ('category_id', 'og_title', 'og_image', 'structured_data')
            ORDER BY column_name
        `);

        console.log(`\n✅ Added ${prodCheck.rows.length} SEO columns to products table:`);
        prodCheck.rows.forEach(col => {
            console.log(`  - ${col.column_name} (${col.data_type})`);
        });

        // Check product_categories junction
        const junctionCheck = await pool.query(`
            SELECT COUNT(*) as exists 
            FROM information_schema.tables 
            WHERE table_name = 'product_categories'
        `);

        if (junctionCheck.rows[0].exists > 0) {
            console.log('\n✅ product_categories junction table created successfully');
        }

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

runMigration();
