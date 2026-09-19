const { query, transaction } = require('./config/database');
const eventBus = require('./platform/events/EventBus'); // Fixed path

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
const HOME_DECOR_CAT_ID = '577c0281-bccb-4a16-9692-b73714c77299';

async function migrate() {
    try {
        console.log('--- STARTING BE3 PRODUCT REDISTRIBUTION (OPTION 1) ---');

        // 1. Get pool of vendors (6 total)
        const vendorsRes = await query(`
            SELECT DISTINCT u.id, u.email, u.business_name 
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            WHERE u.tenant_id = $1 
            AND (r.name = 'Vendor' OR (u.email = 'admin@demo.com' AND u.business_name IS NOT NULL))
        `, [TENANT_ID]);
        
        const vendors = vendorsRes.rows;
        const taye = vendors.find(v => v.email === 'taye@gmail.com');
        
        if (!taye) throw new Error('Could not find Taye in the vendor pool');
        console.log(`Targeting ${vendors.length} vendors for distribution.`);

        // 2. Identify ALL 60 Be3 products
        const be3Products = await query(`
            SELECT id, name, tags, attributes
            FROM products
            WHERE tenant_id = $1 AND (attributes->>'vendor' = 'Be3' OR tags @> ARRAY['Be3'])
        `, [TENANT_ID]);

        if (be3Products.rows.length !== 60) {
            console.warn(`Warning: Found ${be3Products.rows.length} products instead of exactly 60.`);
        }

        // 3. Identify products in Home Decor (via M2M)
        const hdMigrationIdsRes = await query(`
            SELECT product_id FROM product_categories WHERE category_id = $1
        `, [HOME_DECOR_CAT_ID]);
        const hdProductIds = new Set(hdMigrationIdsRes.rows.map(r => r.product_id));

        const productsForTaye = be3Products.rows.filter(p => hdProductIds.has(p.id));
        const otherProducts = be3Products.rows.filter(p => !hdProductIds.has(p.id));

        console.log(`-> ${productsForTaye.length} products destined for Taye (Home Decor)`);
        console.log(`-> ${otherProducts.length} products to be randomized among all vendors.`);

        // Shuffle other products for random distribution
        const shuffledExtras = otherProducts.sort(() => Math.random() - 0.5);

        await transaction(async (client) => {
            // A. Update Taye's Home Decor products
            for (const p of productsForTaye) {
                await updateProductOwner(client, p, taye);
            }

            // B. Update others randomly across the 6-vendor pool
            for (let i = 0; i < shuffledExtras.length; i++) {
                const targetVendor = vendors[i % vendors.length];
                await updateProductOwner(client, shuffledExtras[i], targetVendor);
            }
        });

        console.log('\n--- REDISTRIBUTION COMPLETE ---');
        console.log('Finished updating 60 products across 6 vendors.');

    } catch (e) {
        console.error('Migration Failed:', e);
    } finally {
        process.exit(0);
    }
}

async function updateProductOwner(client, product, vendor) {
    // 1. Tags: Remove 'Be3', Add new Business Name, and [BUSINESS_NAME] variable
    let newTags = (product.tags || []).filter(t => t.toLowerCase() !== 'be3');
    newTags.push(vendor.business_name);
    newTags.push('[BUSINESS_NAME]');
    newTags = Array.from(new Set(newTags)); // unique

    // 2. Attributes: Use exact Business Name (Option 1 as confirmed by user)
    const newAttributes = { ...(product.attributes || {}) };
    newAttributes.vendor = vendor.business_name;

    await client.query(`
        UPDATE products 
        SET created_by = $1, tags = $2, attributes = $3, updated_at = NOW()
        WHERE id = $4 AND tenant_id = $5
    `, [vendor.id, newTags, JSON.stringify(newAttributes), product.id, TENANT_ID]);

    // 3. Trigger search index update
    if (eventBus && typeof eventBus.emitEvent === 'function') {
        eventBus.emitEvent('product.updated', {
            id: product.id,
            tenantId: TENANT_ID,
            userId: vendor.id,
            data: { name: product.name }
        });
    }

    console.log(`  ✓ Migrated: ${product.name.padEnd(40)} -> ${vendor.business_name}`);
}

migrate();
