const { query } = require('./config/database');
const VendorService = require('./modules/vendor/services/VendorService');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function bringToParity() {
    try {
        console.log(`--- BRINGING ALL 6 VENDORS TO PARITY FOR TENANT: ${TENANT_ID} ---`);

        // 1. Get all vendors (those with Vendor role OR Admin with business_name)
        const vendors = await query(`
            SELECT DISTINCT u.id, u.email, u.business_name, u.first_name, u.last_name 
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            WHERE u.tenant_id = $1 
            AND (r.name = 'Vendor' OR (u.email = 'admin@demo.com' AND u.business_name IS NOT NULL))
        `, [TENANT_ID]);

        console.log(`Found ${vendors.rows.length} vendors to process.`);

        for (const vendor of vendors.rows) {
            console.log(`\nProcessing Vendor: ${vendor.email} (${vendor.id}) - Business: ${vendor.business_name || 'N/A'}`);
            
            // initializeVendor handles:
            // - Creating/Updating collection
            // - Setting rules to attribute 'vendor' = resolved business_name
            // - Syncing products
            // - Setting collection_type = 'vendor'
            await VendorService.initializeVendor(TENANT_ID, vendor.id);
            
            console.log(`✓ Parity achieved for ${vendor.email}`);
        }

        console.log('\n--- ALL VENDORS ARE NOW AT PARITY ---');

    } catch (e) {
        console.error('Parity failed:', e);
    } finally {
        process.exit(0);
    }
}

bringToParity();
