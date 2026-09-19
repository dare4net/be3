
const { query } = require('./config/database');

async function run() {
    try {
        const handle = 'r-j4dcl';
        const prodRes = await query("SELECT created_by FROM products WHERE handle = $1", [handle]);
        const vendorId = prodRes.rows[0].created_by;

        console.log(`Setting primary location for vendor ${vendorId}...`);

        await query(
            "UPDATE vendor_locations SET is_primary = true WHERE vendor_id = $1",
            [vendorId]
        );

        console.log("✅ Location set as primary!");
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
