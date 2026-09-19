const { query } = require('./config/database');
const tid = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function auditAttributes() {
    try {
        console.log('--- VENDOR ATTRIBUTE STORAGE AUDIT ---');

        const samples = await query(`
            SELECT DISTINCT attributes->>'vendor' as vendor_val, count(*) 
            FROM products 
            WHERE tenant_id = $1 AND attributes->>'vendor' IS NOT NULL
            GROUP BY attributes->>'vendor'
        `, [tid]);

        console.log('Current distinct vendor values in attributes:');
        console.table(samples.rows);

        const varMatch = samples.rows.filter(r => r.vendor_val === '[BUSINESS_NAME]');
        const uuidMatch = samples.rows.filter(r => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.vendor_val));
        const stringMatch = samples.rows.filter(r => 
            r.vendor_val !== '[BUSINESS_NAME]' && 
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.vendor_val)
        );

        console.log(`\nResults:`);
        console.log(`- Products using literal '[BUSINESS_NAME]': ${varMatch.reduce((acc, r) => acc + parseInt(r.count), 0)}`);
        console.log(`- Products using UUID as vendor: ${uuidMatch.reduce((acc, r) => acc + parseInt(r.count), 0)}`);
        console.log(`- Products using static name: ${stringMatch.reduce((acc, r) => acc + parseInt(r.count), 0)}`);

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
auditAttributes();
