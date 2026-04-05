const { query } = require('../config/database');

async function migrate() {
    console.log('[Migration] Adding "collection_type" column to collections table...');

    try {
        // 1. Add the column if it doesn't exist
        await query(`
            ALTER TABLE collections 
            ADD COLUMN IF NOT EXISTS collection_type VARCHAR(50) DEFAULT 'manual'
        `);
        console.log('[Migration] Column "collection_type" added successfully.');

        // 2. Update existing vendor collections
        // Vendor collections are identified by having a created_by that has the 'Vendor' role.
        // For simplicity, we'll mark all collections that HAVE a created_by as 'vendor' if they
        // aren't already categorized, as system collections usually have created_by = null.
        // However, looking at products.routes.js:177, manual ones also have created_by.
        // A better heuristic: if the rules contain an attribute field for 'vendor', it's likely a vendor collection.
        
        const result = await query(`
            UPDATE collections 
            SET collection_type = 'vendor' 
            WHERE rules::text LIKE '%"attribute_code": "vendor"%'
        `);
        
        console.log(`[Migration] Updated ${result.rowCount} existing vendor collections.`);

    } catch (error) {
        console.error('[Migration] Failed:', error.message);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

migrate();
