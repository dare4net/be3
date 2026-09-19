const { query } = require('./config/database');

async function patch() {
    try {
        await query(`
            UPDATE search_indexes si 
            SET metadata = jsonb_set(metadata, '{delivery_type}', to_jsonb(p.delivery_type::text)) 
            FROM products p 
            WHERE si.content_type = 'product' AND si.content_id = p.id
        `);
        console.log("Index patched successfully!");
    } catch (err) {
        console.error(err);
    }
    process.exit(0);
}
patch();
