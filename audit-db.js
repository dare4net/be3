const {pool} = require('./config/database');

async function main() {
    const client = await pool.connect();
    try {
        // 1. Check vendors table + owner_user_id
        try {
            const v = await client.query('SELECT id, name, owner_user_id FROM vendors LIMIT 5');
            console.log('VENDORS:', JSON.stringify(v.rows, null, 2));
        } catch(e) { console.log('VENDORS table error:', e.message); }

        // 2. Check chat_messages columns
        try {
            const chat = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='chat_messages'");
            console.log('CHAT_COLUMNS:', chat.rows.map(r => r.column_name).join(', '));
        } catch(e) { console.log('CHAT error:', e.message); }

        // 3. Check notification permissions seeded
        try {
            const perms = await client.query("SELECT DISTINCT permission FROM user_permissions WHERE permission LIKE 'notification%' LIMIT 10");
            console.log('NOTIF_PERMS:', JSON.stringify(perms.rows));
        } catch(e) { console.log('PERMS error:', e.message); }

        // 4. Check recent notifications in DB
        try {
            const notifs = await client.query('SELECT id, user_id, type, title, created_at FROM notifications ORDER BY created_at DESC LIMIT 10');
            console.log('RECENT_NOTIFICATIONS:', JSON.stringify(notifs.rows, null, 2));
        } catch(e) { console.log('NOTIFICATIONS error:', e.message); }

        // 5. Check if payment.success ever emitted (check orders with payment_status=paid)
        try {
            const orders = await client.query("SELECT id, order_number, user_id, vendor_id, payment_status FROM orders WHERE payment_status='paid' ORDER BY created_at DESC LIMIT 5");
            console.log('PAID_ORDERS:', JSON.stringify(orders.rows, null, 2));
        } catch(e) { console.log('ORDERS error:', e.message); }

    } finally {
        client.release();
        process.exit(0);
    }
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
