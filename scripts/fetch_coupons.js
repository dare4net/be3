require('dotenv').config();
const { query } = require('../config/database.js');

async function main() {
    try {
        console.log('Fetching all coupons from the system...\n');
        const sql = `
            SELECT 
                d.code, 
                d.type, 
                d.value,
                COALESCE(u.email, 'Platform') as vendor_name,
                d.used_count, 
                d.max_uses,
                d.max_uses_per_user,
                d.is_active, 
                d.deleted_at
            FROM discounts d
            LEFT JOIN users u ON d.vendor_id = u.id
            ORDER BY d.created_at DESC
        `;
        const res = await query(sql);
        
        const coupons = res.rows.map(c => {
            let status = c.deleted_at ? 'DELETED' : (c.is_active ? 'ACTIVE' : 'DISABLED');
            return {
                Code: c.code,
                Vendor: c.vendor_name,
                Type: c.type,
                Value: c.value,
                Used: c.used_count,
                MaxUses: c.max_uses === null ? 'Unlimited' : c.max_uses,
                MaxPerUser: c.max_uses_per_user === null ? 'Unlimited' : c.max_uses_per_user,
                Status: status,
                DeletedAt: c.deleted_at ? c.deleted_at.toISOString().slice(0, 19).replace('T', ' ') : 'N/A'
            };
        });

        if (coupons.length === 0) {
            console.log('No coupons found in the system.');
        } else {
            console.table(coupons);
        }

    } catch (err) {
        console.error('Error fetching coupons:', err);
    } finally {
        process.exit(0);
    }
}

main();
