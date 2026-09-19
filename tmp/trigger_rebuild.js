const { query, pool } = require('../config/database');
const VendorService = require('../modules/vendor/services/VendorService');

async function triggerRebuild() {
    try {
        const sysAttr = await query(`SELECT id FROM system_attributes WHERE code = 'vendor'`);
        if (sysAttr.rows.length > 0) {
            await VendorService.rebuildVendorOptions(sysAttr.rows[0].id);
            console.log("Successfully ran rebuildVendorOptions!");
        } else {
            console.log("Vendor Attribute not found.");
        }
    } catch (e) {
        console.error("Error during rebuild:", e);
    } finally {
        pool.end();
    }
}

triggerRebuild();
