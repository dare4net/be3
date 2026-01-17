/**
 * PageWidget Model
 * Manages customizable widgets for storefront pages
 * PRINCIPLE: Multi-tenant by default
 */

const { query } = require('../../../config/database');
const { tenantInsert, tenantUpdate, findByIdTenant } = require('../../../utils/dbHelpers');

class PageWidget {
    static async create(tenantId, widgetData) {
        // Sanitize parent_id
        let parentId = widgetData.parent_id;
        if (!parentId || parentId.toString().startsWith('temp_')) {
            parentId = null;
        }

        return await tenantInsert('page_widgets', tenantId, {
            page_type: widgetData.page_type || 'home',
            widget_type: widgetData.widget_type,
            config: JSON.stringify(widgetData.config || {}),
            sort_order: widgetData.sort_order || 0,
            is_active: widgetData.is_active !== undefined ? widgetData.is_active : true,
            parent_id: parentId, // Support nesting
            layout_id: widgetData.layout_id
        });
    }

    static async findById(tenantId, widgetId) {
        return await findByIdTenant('page_widgets', tenantId, widgetId);
    }

    static async findByPage(tenantId, pageType, layoutId, includeInactive = false) {
        let sql = `
            SELECT * FROM page_widgets 
            WHERE tenant_id = $1 
            AND page_type = $2
            AND layout_id = $3
        `;

        if (!includeInactive) {
            sql += ` AND is_active = true`;
        }

        sql += ` ORDER BY sort_order ASC`;

        const result = await query(sql, [tenantId, pageType, layoutId]);
        return result.rows;
    }

    static async update(tenantId, widgetId, updates) {
        const allowedUpdates = {};

        if (updates.widget_type !== undefined) allowedUpdates.widget_type = updates.widget_type;
        if (updates.config !== undefined) allowedUpdates.config = JSON.stringify(updates.config);
        if (updates.sort_order !== undefined) allowedUpdates.sort_order = updates.sort_order;
        if (updates.is_active !== undefined) allowedUpdates.is_active = updates.is_active;
        if (updates.parent_id !== undefined) {
            allowedUpdates.parent_id = (!updates.parent_id || updates.parent_id.toString().startsWith('temp_')) ? null : updates.parent_id;
        }

        return await tenantUpdate('page_widgets', tenantId, widgetId, allowedUpdates);
    }

    static async delete(tenantId, widgetId) {
        const sql = `DELETE FROM page_widgets WHERE id = $1 AND tenant_id = $2 RETURNING *`;
        const result = await query(sql, [widgetId, tenantId]);
        return result.rows[0];
    }

    static async reorder(tenantId, widgetOrders) {
        if (!Array.isArray(widgetOrders)) {
            return false;
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

        for (const item of widgetOrders) {
            if (!item || !item.id) continue;

            // Validate UUID format to prevent DB crashes
            if (!uuidRegex.test(item.id)) continue;

            await query(
                `UPDATE page_widgets SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
                [item.sort_order, item.id, tenantId]
            );
        }
        return true;
    }
}

module.exports = PageWidget;
