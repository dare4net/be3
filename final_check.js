const { query } = require('./config/database');

async function check() {
    try {
        const counts = await query(`
            SELECT collection_type, is_active, COUNT(*) 
            FROM collections 
            GROUP BY collection_type, is_active
        `);
        console.log('Collection Statistics:');
        console.table(counts.rows);

        const vendorCols = await query(`
            SELECT name, slug, collection_type, is_active, created_by 
            FROM collections 
            WHERE collection_type = 'vendor' 
            LIMIT 5
        `);
        console.log('Vendor Collections Sample:');
        console.table(vendorCols.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
check();
