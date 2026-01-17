const { query } = require('../config/database');

async function checkTables() {
    try {
        const res = await query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log('Tables:', res.rows.map(r => r.table_name));

        // Also check columns of attributes if it exists
        if (res.rows.find(r => r.table_name === 'attributes')) {
            const attrCols = await query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'attributes'
            `);
            console.log('Attributes Columns:', attrCols.rows);
        }

        // Check category_attributes
        if (res.rows.find(r => r.table_name === 'category_attributes')) {
            const catAttrCols = await query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'category_attributes'
            `);
            console.log('Category Attributes Columns:', catAttrCols.rows);
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

checkTables();
