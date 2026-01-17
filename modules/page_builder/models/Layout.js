/**
 * Layout Model
 * Manages storefront versions/layouts
 */

const { query } = require('../../../config/database');

class Layout {
    /**
     * Find active layout for tenant
     */
    static async findActive(tenantId) {
        const sql = `
            SELECT * FROM layouts 
            WHERE tenant_id = $1 AND is_active = true
            LIMIT 1
        `;
        const result = await query(sql, [tenantId]);
        return result.rows[0];
    }

    /**
     * Find default layout (fallback)
     */
    static async findDefault(tenantId) {
        const sql = `
            SELECT * FROM layouts 
            WHERE tenant_id = $1 AND name = 'Default'
            LIMIT 1
        `;
        const result = await query(sql, [tenantId]);
        return result.rows[0];
    }
}

module.exports = Layout;
