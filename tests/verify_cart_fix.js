const { query } = require('../config/database');

async function verifyCartFix() {
    try {
        console.log("🚀 Verifying Cart Quantity Increment Fix...");

        // 1. Create a dummy tenant and product if needed, but let's assume we have data
        // For testing, we'll try to find an existing cart or create a test one
        const tenantId = '00000000-0000-0000-0000-000000000000'; // Default test tenant
        const productId = '00000000-0000-0000-0000-000000000001'; // Dummy product
        const sessionId = 'test-session-' + Date.now();

        // Ensure product exists (minimal)
        await query(`INSERT INTO products (id, tenant_id, name, price, handle) VALUES ($1, $2, 'Test Product', 10, 'test-p') ON CONFLICT DO NOTHING`, [productId, tenantId]);

        // Mock a cart addition
        async function addToCart(qty) {
            // This replicates the logic in our POST /cart/items route
            // First find/create cart
            let cartRes = await query(`SELECT id FROM carts WHERE tenant_id = $1 AND session_id = $2 AND status = 'active'`, [tenantId, sessionId]);
            let cartId;
            if (cartRes.rows.length === 0) {
                const ins = await query(`INSERT INTO carts (tenant_id, session_id, status) VALUES ($1, $2, 'active') RETURNING id`, [tenantId, sessionId]);
                cartId = ins.rows[0].id;
            } else {
                cartId = cartRes.rows[0].id;
            }

            // check existing
            const existing = await query(`SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2`, [cartId, productId]);
            if (existing.rows.length > 0) {
                await query(`UPDATE cart_items SET quantity = quantity + $1 WHERE id = $2`, [qty, existing.rows[0].id]);
            } else {
                await query(`INSERT INTO cart_items (tenant_id, cart_id, product_id, quantity, price) VALUES ($1, $2, $3, $4, 10)`, [tenantId, cartId, productId, qty]);
            }
        }

        console.log("Adding product with qty 2...");
        await addToCart(2);

        console.log("Adding same product with qty 3...");
        await addToCart(3);

        const finalItems = await query(`SELECT * FROM cart_items ci JOIN carts c ON ci.cart_id = c.id WHERE c.session_id = $1`, [sessionId]);

        console.log("Cart Items found:", finalItems.rows.length);
        if (finalItems.rows.length === 1 && parseInt(finalItems.rows[0].quantity) === 5) {
            console.log("✅ SUCCESS: Quantity correctly incremented to 5.");
        } else {
            console.error("❌ FAILURE: Expected 1 item with qty 5, but got:", finalItems.rows);
        }

    } catch (err) {
        console.error("Verification failed:", err);
    }
}

verifyCartFix();
