/**
 * Theme Model
 * Manages storefront themes
 * PRINCIPLE: Multi-tenant by default
 */

const { query, transaction } = require('../../../config/database');
const { tenantInsert, tenantUpdate, findByIdTenant, tenantDelete, tenantQuery } = require('../../../utils/dbHelpers');

class Theme {
    static async create(tenantId, themeData) {
        return await tenantInsert('themes', tenantId, {
            name: themeData.name,
            variables: JSON.stringify(themeData.variables || {}),
            is_active: themeData.is_active || false
        });
    }

    static async findById(tenantId, themeId) {
        return await findByIdTenant('themes', tenantId, themeId);
    }

    static async findAll(tenantId) {
        // Simple list, ordered by name
        return await tenantQuery('themes', tenantId, {}, 'name ASC');
    }

    static async findActive(tenantId) {
        const result = await query(
            `SELECT * FROM themes WHERE tenant_id = $1 AND is_active = true LIMIT 1`,
            [tenantId]
        );
        return result.rows[0];
    }

    static async update(tenantId, themeId, updates) {
        const allowedUpdates = {};
        if (updates.name !== undefined) allowedUpdates.name = updates.name;
        if (updates.variables !== undefined) allowedUpdates.variables = JSON.stringify(updates.variables);

        // We explicitly do NOT allow updating is_active here to prevent accidents.
        // Use activate() method instead.

        return await tenantUpdate('themes', tenantId, themeId, allowedUpdates);
    }

    static async delete(tenantId, themeId) {
        return await tenantDelete('themes', tenantId, themeId);
    }

    static async activate(tenantId, themeId) {
        // Transaction to ensure atomicity
        return await transaction(async (client) => {
            // 1. Deactivate all themes for this tenant
            await client.query(
                `UPDATE themes SET is_active = false, updated_at = NOW() WHERE tenant_id = $1`,
                [tenantId]
            );

            // 2. Activate specific theme
            const result = await client.query(
                `UPDATE themes SET is_active = true, updated_at = NOW() WHERE id = $2 AND tenant_id = $1 RETURNING *`,
                [tenantId, themeId]
            );

            return result.rows[0];
            return result.rows[0];
        });
    }

    static async deactivate(tenantId) {
        return await query(
            `UPDATE themes SET is_active = false, updated_at = NOW() WHERE tenant_id = $1`,
            [tenantId]
        );
    }
}

module.exports = Theme;
