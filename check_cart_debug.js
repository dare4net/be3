const { query } = require('./config/database');

async function checkCart() {
    try {
        const tenant = await query('SELECT id FROM tenants LIMIT 1');
        const tenantId = tenant.rows[0].id;
        console.log('Tenant:', tenantId);

        const cart = await query("SELECT id FROM carts WHERE tenant_id = $1 AND status = 'active' LIMIT 1", [tenantId]);
        if (!cart.rows[0]) {
            console.log('No active cart found');
            process.exit(0);
        }
        const cartId = cart.rows[0].id;
        console.log('Cart ID:', cartId);

        const itemsResult = await query(
            `SELECT 
                ci.*, 
                p.name as product_name, 
                p.image_url,
                p.created_by as vendor_id
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.cart_id = $1 AND ci.tenant_id = $2`,
            [cartId, tenantId]
        );
        console.log('Items:', itemsResult.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

checkCart();
