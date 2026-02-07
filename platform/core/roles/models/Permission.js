/**
 * Permission Model
 * Permissions are global (not tenant-scoped)
 */

const { query } = require('../../../../config/database');

class Permission {
    static async create(permissionData) {
        const sql = `INSERT INTO permissions (name, module, description) VALUES ($1, $2, $3) RETURNING *`;
        const result = await query(sql, [permissionData.name, permissionData.module, permissionData.description]);
        return result.rows[0];
    }

    static async findByName(name) {
        const sql = `SELECT * FROM permissions WHERE name = $1`;
        const result = await query(sql, [name]);
        return result.rows[0] || null;
    }

    static async findAll() {
        const sql = `SELECT * FROM permissions ORDER BY module, name`;
        const result = await query(sql);
        return result.rows;
    }

    static async findByModule(moduleName) {
        const sql = `SELECT * FROM permissions WHERE module = $1 ORDER BY name`;
        const result = await query(sql, [moduleName]);
        return result.rows;
    }

    static async userHasPermission(tenantId, userId, permissionName) {
        const sql = `
      SELECT COUNT(*) as count FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN user_roles ur ON rp.role_id = ur.role_id
      WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND p.name = $3
    `;
        const result = await query(sql, [tenantId, userId, permissionName]);
        return parseInt(result.rows[0].count) > 0;
    }

    static async getUserPermissions(tenantId, userId) {
        const sql = `
            SELECT DISTINCT p.name 
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            JOIN user_roles ur ON rp.role_id = ur.role_id
            WHERE ur.tenant_id = $1 AND ur.user_id = $2
        `;
        const result = await query(sql, [tenantId, userId]);
        return result.rows.map(r => r.name);
    }

    /**
     * Get user's allowed categories
     * Returns empty array if user has unrestricted access (no category restrictions)
     * Returns array of category IDs if user has category restrictions
     */
    static async getUserAllowedCategories(tenantId, userId) {
        const sql = `
            SELECT category_id 
            FROM user_category_permissions 
            WHERE tenant_id = $1 AND user_id = $2
        `;
        const result = await query(sql, [tenantId, userId]);
        return result.rows.map(r => r.category_id);
    }

    /**
     * Check if user has unrestricted category access
     * Returns true if user can access ALL categories (no restrictions)
     * Returns false if user has category restrictions
     */
    static async hasUnrestrictedCategoryAccess(tenantId, userId) {
        const sql = `
            SELECT COUNT(*) as count 
            FROM user_category_permissions 
            WHERE tenant_id = $1 AND user_id = $2
        `;
        const result = await query(sql, [tenantId, userId]);
        return parseInt(result.rows[0].count) === 0;
    }

    /**
     * Assign category permissions to a user
     */
    static async assignCategoriesToUser(tenantId, userId, categoryIds) {
        // First, remove existing category permissions
        await query('DELETE FROM user_category_permissions WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);

        // Then add new ones
        if (categoryIds && categoryIds.length > 0) {
            const values = categoryIds.map((catId, idx) =>
                `($1, $2, $${idx + 3})`
            ).join(', ');

            const sql = `
                INSERT INTO user_category_permissions (tenant_id, user_id, category_id) 
                VALUES ${values}
            `;

            await query(sql, [tenantId, userId, ...categoryIds]);
        }
    }

    /**
     * Remove all category restrictions for a user (grant full access)
     */
    static async removeUserCategoryPermissions(tenantId, userId) {
        await query('DELETE FROM user_category_permissions WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
    }
}

module.exports = Permission;
