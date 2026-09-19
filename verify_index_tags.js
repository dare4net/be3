const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function verify() {
    try {
        // Check what's stored in metadata.tags for a vendor product
        const res = await query(`
            SELECT si.metadata->'tags' as tags, si.metadata->>'created_by' as created_by, p.name
            FROM search_indexes si
            JOIN products p ON si.content_id = p.id
            WHERE si.tenant_id = $1 AND si.content_type = 'product'
            AND p.created_by IS NOT NULL
            LIMIT 15
        `, [tid]);
        
        console.log('Sample index metadata tags:');
        res.rows.forEach(r => {
            console.log(`${r.name}: tags=${JSON.stringify(r.tags)}, created_by=${r.created_by}`);
        });

        // Check if "Be3" or "[BUSINESS_NAME]" still appear in any tags
        const be3Check = await query(`
            SELECT count(*) FROM search_indexes 
            WHERE tenant_id = $1 AND content_type = 'product'
            AND metadata->'tags' @> '["Be3"]'
        `, [tid]);
        const varCheck = await query(`
            SELECT count(*) FROM search_indexes 
            WHERE tenant_id = $1 AND content_type = 'product'
            AND metadata::text LIKE '%[BUSINESS_NAME]%'
        `, [tid]);
        console.log(`\nProducts with "Be3" tag in index: ${be3Check.rows[0].count}`);
        console.log(`Products with unresolved [BUSINESS_NAME] in index: ${varCheck.rows[0].count}`);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
verify();
