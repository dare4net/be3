const { query } = require('./config/database');
const ProductService = require('./modules/products/services/ProductService');

async function test() {
    console.log("Starting test...");
    const tenant = await query('SELECT id FROM tenants LIMIT 1');
    const tenantId = tenant.rows[0].id;
    console.log("Tenant:", tenantId);

    const pData = await query('SELECT * FROM products WHERE tenant_id = $1 AND created_by IS NOT NULL LIMIT 1', [tenantId]);
    const p = pData.rows[0];
    if (!p) return console.log('no products found matching criteria');

    console.log("Found product:", p.name, "- created_by:", p.created_by);

    const resolved = await ProductService.resolve(tenantId, p.created_by, [p]);
    console.log("=== VENDOR STATS ===");
    console.dir(resolved[0].vendor_stats, { depth: null });
    console.log("=== STORE COLLECTION ===");
    console.dir(resolved[0].store_collection, { depth: null });

    process.exit(0);
}

test().catch(e => {
    console.error(e);
    process.exit(1);
});
