/**
 * Filter Service
 * Manages faceted filtering
 */

const { query } = require('../../../config/database');

class FilterService {
    /**
     * Get available filters for tenant
     * @param {string} tenantId
     * @returns {Array}
     */
    async getFilters(tenantId) {
        const sql = `
            SELECT * FROM search_filters
            WHERE tenant_id = $1
            AND is_active = true
            ORDER BY sort_order ASC, label ASC
        `;

        const results = await query(sql, [tenantId]);
        return results.rows;
    }

    /**
     * Create a filter configuration
     * @param {string} tenantId
     * @param {Object} filterData
     * @returns {Object}
     */
    async createFilter(tenantId, filterData) {
        const {
            filter_key,
            filter_type,
            label,
            config = {},
            sort_order = 0
        } = filterData;

        const sql = `
            INSERT INTO search_filters
            (tenant_id, filter_key, filter_type, label, config, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;

        const result = await query(sql, [
            tenantId,
            filter_key,
            filter_type,
            label,
            JSON.stringify(config),
            sort_order
        ]);

        return result.rows[0];
    }

    /**
     * Update a filter configuration
     * @param {string} tenantId
     * @param {string} filterId
     * @param {Object} updates
     * @returns {Object}
     */
    async updateFilter(tenantId, filterId, updates) {
        const allowedFields = ['filter_key', 'filter_type', 'label', 'config', 'sort_order', 'is_active'];
        const updateFields = [];
        const values = [tenantId, filterId];
        let paramIndex = 3;

        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                if (key === 'config') {
                    updateFields.push(`${key} = $${paramIndex}`);
                    values.push(JSON.stringify(updates[key]));
                } else {
                    updateFields.push(`${key} = $${paramIndex}`);
                    values.push(updates[key]);
                }
                paramIndex++;
            }
        });

        if (updateFields.length === 0) {
            throw new Error('No valid fields to update');
        }

        const sql = `
            UPDATE search_filters
            SET ${updateFields.join(', ')}, updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2
            RETURNING *
        `;

        const result = await query(sql, values);
        return result.rows[0];
    }

    /**
     * Delete a filter configuration
     * @param {string} tenantId
     * @param {string} filterId
     */
    async deleteFilter(tenantId, filterId) {
        const sql = `
            DELETE FROM search_filters
            WHERE tenant_id = $1 AND id = $2
        `;

        await query(sql, [tenantId, filterId]);
    }
}

module.exports = FilterService;
