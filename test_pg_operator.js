const { query } = require('./config/database');

async function test() {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    // Use the IDs from our earlier Electronic search
    const ids = ['2ff218a6-65e9-456e-878a-300f1217798f', '95bd9dc5-2630-4e32-9df7-28054c272a27', '3e5781a6-5500-476f-8612-bdd16e690025'];

    console.log('--- Test 1: Without explicit cast ---');
    try {
        const res1 = await query(`
            SELECT COUNT(*) 
            FROM search_indexes 
            WHERE tenant_id = $1 
            AND content_type = 'product'
            AND metadata->'category_ids' ?| $2
        `, [tenantId, ids]);
        console.log('Count:', res1.rows[0].count);
    } catch (e) {
        console.error('Test 1 failed:', e.message);
    }

    console.log('\n--- Test 2: With explicit cast to text[] ---');
    try {
        const res2 = await query(`
            SELECT COUNT(*) 
            FROM search_indexes 
            WHERE tenant_id = $1 
            AND content_type = 'product'
            AND metadata->'category_ids' ?| $2::text[]
        `, [tenantId, ids]);
        console.log('Count:', res2.rows[0].count);
    } catch (e) {
        console.error('Test 2 failed:', e.message);
    }

    console.log('\n--- Test 3: Checking metadata type ---');
    const sample = await query(`
        SELECT metadata->'category_ids' as cats, pg_typeof(metadata->'category_ids') as type
        FROM search_indexes 
        WHERE tenant_id = $1 AND content_type = 'product'
        LIMIT 1
    `, [tenantId]);
    console.log(JSON.stringify(sample.rows[0], null, 2));
}

test().catch(console.error).finally(() => process.exit());
