/**
 * Run vendor system migrations (076–079)
 */
const { query } = require('./config/database');
const path = require('path');

async function run() {
    const migrations = [
        '076_tiered_verification.js',
        '077_vendor_applications.js',
        '078_vendor_test_products.js',
        '079_vendor_permissions.js',
    ];

    for (const file of migrations) {
        try {
            console.log(`\n▶ Running ${file}...`);
            const mod = require(path.join(__dirname, 'migrations', file));
            await mod.up({ query });
            console.log(`✓ ${file} complete`);
        } catch (err) {
            console.error(`✗ ${file} failed:`, err.message);
            process.exit(1);
        }
    }

    console.log('\n✅ All vendor migrations complete');
    process.exit(0);
}

run();
