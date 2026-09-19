'use strict';

const { query } = require('../../config/database');

/**
 * Resolves admin notification recipients for a given order/payment event.
 *
 * Rules (matching actual schema — no `vendors` or `user_permissions` tables):
 *  - vendor_id in orders IS the vendor's user_id directly → notify them
 *  - Also notify all users with the 'Admin' role for the tenant
 *  (deduplicated by user_id)
 */
async function resolve(tenantId, vendorId, permissionScope) {
    const ids = new Set();

    // 1. vendor_id IS the vendor's user_id — notify them directly
    if (vendorId) {
        ids.add(vendorId);
    }

    // 2. Notify all Admin-role users for this tenant
    try {
        const adminRes = await query(
            `SELECT DISTINCT ur.user_id
             FROM user_roles ur
             JOIN roles r ON ur.role_id = r.id
             WHERE ur.tenant_id = $1 AND r.name = 'Admin'`,
            [tenantId]
        );
        adminRes.rows.forEach(r => ids.add(r.user_id));
    } catch (e) {
        console.warn('[RecipientResolver] Could not query admin users:', e.message);
    }

    return [...ids];
}

module.exports = { resolve };
