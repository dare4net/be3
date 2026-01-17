/**
 * Role Model
 * PRINCIPLE: Multi-tenant by default
 */

const { query } = require('../../../../config/database');
const { tenantInsert, tenantUpdate, findByIdTenant } = require('../../../../utils/dbHelpers');

class Role {
    static async create(tenantId, roleData) {
        return await tenantInsert('roles', tenantId, {
            name: roleData.name,
            description: roleData.description || null,
            is_system: roleData.is_system || false,
        });
    }

    static async findById(tenantId, roleId) {
        return await findByIdTenant('roles', tenantId, roleId);
    }

    static async findByName(tenantId, name) {
        const sql = `SELECT * FROM roles WHERE tenant_id = $1 AND name = $2`;
        const result = await query(sql, [tenantId, name]);
        return result.rows[0] || null;
    }

    static async findAll(tenantId) {
        const sql = `SELECT * FROM roles WHERE tenant_id = $1 ORDER BY created_at DESC`;
        const result = await query(sql, [tenantId]);
        return result.rows;
    }

    static async update(tenantId, roleId, updates) {
        return await tenantUpdate('roles', tenantId, roleId, updates);
    }

    static async delete(tenantId, roleId) {
        const sql = `DELETE FROM roles WHERE id = $1 AND tenant_id = $2 AND is_system = false RETURNING *`;
        const result = await query(sql, [roleId, tenantId]);
        return result.rows[0];
    }

    static async assignPermission(tenantId, roleId, permissionId) {
        const sql = `INSERT INTO role_permissions (tenant_id, role_id, permission_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`;
        const result = await query(sql, [tenantId, roleId, permissionId]);
        return result.rows[0];
    }

    static async removePermission(tenantId, roleId, permissionId) {
        const sql = `DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2 AND permission_id = $3`;
        await query(sql, [tenantId, roleId, permissionId]);
    }

    static async getPermissions(tenantId, roleId) {
        const sql = `
      SELECT p.* FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      WHERE rp.tenant_id = $1 AND rp.role_id = $2
    `;
        const result = await query(sql, [tenantId, roleId]);
        return result.rows;
    }

    static async assignToUser(tenantId, userId, roleId) {
        const sql = `INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`;
        const result = await query(sql, [tenantId, userId, roleId]);
        return result.rows[0];
    }

    static async removeFromUser(tenantId, userId, roleId) {
        const sql = `DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`;
        await query(sql, [tenantId, userId, roleId]);
    }

    static async getUserRoles(tenantId, userId) {
        const sql = `
      SELECT r.* FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.tenant_id = $1 AND ur.user_id = $2
    `;
        const result = await query(sql, [tenantId, userId]);
        return result.rows;
    }
}

module.exports = Role;
