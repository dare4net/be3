const { query } = require('./config/database');

async function run() {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    const vendorId = '15915ce1-25ae-440f-ba95-dcdc6d0046bb';

    console.log("Testing with location_id = null");
    let res = await query(`
        SELECT * FROM vendor_shipping_zones WHERE tenant_id = $1 AND vendor_id = $2 
        AND (
            (location_type = 'country' AND location_id = $3) OR
            (location_type = 'state' AND location_id = $4) OR
            (location_type = 'landmark' AND location_id = $5)
        )
    `, [tenantId, vendorId, null, null, null]);
    console.log("Result w/ null", res.rows);

    console.log("Testing with location_id = 2, 0, 0");
    res = await query(`
        SELECT * FROM vendor_shipping_zones WHERE tenant_id = $1 AND vendor_id = $2 
        AND (
            (location_type = 'country' AND location_id = $3) OR
            (location_type = 'state' AND location_id = $4) OR
            (location_type = 'landmark' AND location_id = $5)
        )
    `, [tenantId, vendorId, 2, 0, 0]);
    console.log("Result w/ 2,0,0", res.rows);
}

run().catch(console.error).finally(() => process.exit());
