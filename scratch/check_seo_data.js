const { query } = require('../config/database');

async function checkSeoColumns() {
    try {
        console.log("Searching database schema for SEO-related columns...");
        
        const res = await query(`
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND (
                column_name ILIKE '%seo%' 
                OR column_name ILIKE 'meta_title'
                OR column_name ILIKE 'meta_description'
                OR column_name ILIKE 'meta_keywords'
            )
            ORDER BY table_name, column_name;
        `);

        if (res.rows.length === 0) {
            console.log("No SEO related columns found.");
        } else {
            const tables = {};
            res.rows.forEach(r => {
                if (!tables[r.table_name]) tables[r.table_name] = [];
                tables[r.table_name].push(r.column_name);
            });

            console.log("\nTables containing SEO data fields:");
            for (const [table, cols] of Object.entries(tables)) {
                console.log(`- ${table}: ${cols.join(', ')}`);
            }
        }
    } catch(e) {
        console.error("Error:", e.message);
    } finally {
        process.exit();
    }
}

checkSeoColumns();
