
const { query } = require('./config/database');

async function run() {
    try {
        const handle = 'r-j4dcl';
        console.log(`Checking product: ${handle}`);

        // 1. Get Product
        const prodRes = await query("SELECT id, name, created_by, tenant_id FROM products WHERE handle = $1", [handle]);
        if (prodRes.rows.length === 0) {
            console.log('Product not found');
            process.exit(1);
        }
        const product = prodRes.rows[0];
        console.log('Product:', product);

        if (!product.created_by) {
            console.log('Product has no created_by (vendor)');
            process.exit(0);
        }

        // 2. Get Location
        const locRes = await query(
            "SELECT * FROM vendor_locations WHERE vendor_id = $1 AND tenant_id = $2",
            [product.created_by, product.tenant_id]
        );
        console.log(`Found ${locRes.rows.length} locations for vendor ${product.created_by}`);
        console.log('Locations:', locRes.rows);

        const primary = locRes.rows.find(l => l.is_primary);
        if (primary) {
            console.log('✅ Found primary location:', primary);
        } else {
            console.log('❌ No primary location set for this vendor');
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
