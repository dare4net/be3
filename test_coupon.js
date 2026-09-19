require('dotenv').config();
const { query } = require('./config/database.js');

async function test() {
    try {
        const discountQuery = await query("SELECT * FROM discounts WHERE code = 'CAREANTHY' AND deleted_at IS NULL");
        const coupon = discountQuery.rows[0];
        
        if (!coupon) { console.log('not found'); return; }
        
        const tenantId = coupon.tenant_id;
        const code = coupon.code;
        const vendorId = coupon.vendor_id;
        
        const items = [
            { product_id: '5f3d89da-773b-4e65-ad8e-dd9e8acd1fba', price: 100, quantity: 1 }
        ];
        console.log('Coupon:', coupon.id);
        
        let productIds = items.map(i => i.product_id);
        let scopedProductIds = productIds;
        
        const vpQuery = await query(`SELECT id FROM products WHERE id = ANY($1) AND created_by = $2`, [productIds, coupon.vendor_id]);
        scopedProductIds = vpQuery.rows.map(r => r.id);
        console.log('Scoped Product IDs:', scopedProductIds);
        
        let eligibleProductIds = [];
        const catQuery = await query(`
            SELECT pc.product_id, pc.category_id 
            FROM product_categories pc 
            WHERE pc.product_id = ANY($1) AND pc.tenant_id = $2
        `, [scopedProductIds, tenantId]);
        
        console.log('Cat Query Rows:', catQuery.rows);
        
        for (const row of catQuery.rows) {
            console.log('Checking if', coupon.applicable_ids, 'includes', row.category_id);
            if (coupon.applicable_ids.includes(row.category_id)) {
                if (!eligibleProductIds.includes(row.product_id)) {
                    eligibleProductIds.push(row.product_id);
                }
            }
        }
        
        console.log('Eligible:', eligibleProductIds);
        
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
test();
