/**
 * Search Synonym Model
 */

const { query } = require('../../../config/database');

class SearchSynonym {
    /**
     * Find all active synonyms for a tenant
     * @param {string} tenantId
     * @returns {Array}
     */
    static async findActive(tenantId) {
        const sql = `
            SELECT * FROM search_synonyms
            WHERE tenant_id = $1
            AND is_active = true
            ORDER BY term ASC
        `;

        const result = await query(sql, [tenantId]);
        return result.rows;
    }

    /**
     * Find all synonyms for a tenant
     * @param {string} tenantId
     * @returns {Array}
     */
    static async findAll(tenantId) {
        const sql = `
            SELECT * FROM search_synonyms
            WHERE tenant_id = $1
            ORDER BY term ASC
        `;

        const result = await query(sql, [tenantId]);
        return result.rows;
    }

    /**
     * Find synonym by ID
     * @param {string} tenantId
     * @param {string} id
     * @returns {Object|null}
     */
    static async findById(tenantId, id) {
        const sql = `
            SELECT * FROM search_synonyms
            WHERE tenant_id = $1 AND id = $2
        `;

        const result = await query(sql, [tenantId, id]);
        return result.rows[0] || null;
    }

    /**
     * Create a synonym
     * @param {string} tenantId
     * @param {Object} data - { term, synonyms, is_active }
     * @returns {Object}
     */
    static async create(tenantId, data) {
        const { term, synonyms, is_active = true } = data;

        if (!Array.isArray(synonyms) || synonyms.length === 0) {
            throw new Error('Synonyms must be a non-empty array');
        }

        const sql = `
            INSERT INTO search_synonyms
            (tenant_id, term, synonyms, is_active)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;

        const result = await query(sql, [tenantId, term, synonyms, is_active]);
        return result.rows[0];
    }

    /**
     * Update a synonym
     * @param {string} tenantId
     * @param {string} id
     * @param {Object} updates
     * @returns {Object}
     */
    static async update(tenantId, id, updates) {
        const allowedFields = ['term', 'synonyms', 'is_active'];
        const updateFields = [];
        const values = [tenantId, id];
        let paramIndex = 3;

        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                if (key === 'synonyms' && Array.isArray(updates[key])) {
                    updateFields.push(`${key} = $${paramIndex}`);
                    values.push(updates[key]);
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
            UPDATE search_synonyms
            SET ${updateFields.join(', ')}, updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2
            RETURNING *
        `;

        const result = await query(sql, values);
        return result.rows[0];
    }

    /**
     * Delete a synonym
     * @param {string} tenantId
     * @param {string} id
     */
    static async delete(tenantId, id) {
        const sql = `
            DELETE FROM search_synonyms
            WHERE tenant_id = $1 AND id = $2
        `;

        await query(sql, [tenantId, id]);
    }
}

module.exports = SearchSynonym;
