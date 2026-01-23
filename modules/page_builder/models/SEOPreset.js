/**
 * SEOPreset Model
 * Manages reusable SEO templates for pages
 * PRINCIPLE: Multi-tenant by default
 */

const { query } = require('../../../config/database');
const { tenantInsert, tenantUpdate, findByIdTenant } = require('../../../utils/dbHelpers');

class SEOPreset {
    static async create(tenantId, presetData) {
        return await tenantInsert('seo_presets', tenantId, {
            name: presetData.name,
            description: presetData.description || null,
            og_image: presetData.og_image || null,
            og_type: presetData.og_type || 'website',
            twitter_card: presetData.twitter_card || 'summary_large_image',
            robots: presetData.robots || 'index,follow',
            structured_data: presetData.structured_data ? JSON.stringify(presetData.structured_data) : null
        });
    }

    static async findAll(tenantId) {
        const sql = `SELECT * FROM seo_presets WHERE tenant_id = $1 ORDER BY name ASC`;
        const result = await query(sql, [tenantId]);
        return result.rows;
    }

    static async findById(tenantId, presetId) {
        return await findByIdTenant('seo_presets', tenantId, presetId);
    }

    static async update(tenantId, presetId, updates) {
        const allowedUpdates = {};

        if (updates.name !== undefined) allowedUpdates.name = updates.name;
        if (updates.description !== undefined) allowedUpdates.description = updates.description;
        if (updates.og_image !== undefined) allowedUpdates.og_image = updates.og_image;
        if (updates.og_type !== undefined) allowedUpdates.og_type = updates.og_type;
        if (updates.twitter_card !== undefined) allowedUpdates.twitter_card = updates.twitter_card;
        if (updates.robots !== undefined) allowedUpdates.robots = updates.robots;
        if (updates.structured_data !== undefined) {
            allowedUpdates.structured_data = updates.structured_data ? JSON.stringify(updates.structured_data) : null;
        }

        return await tenantUpdate('seo_presets', tenantId, presetId, allowedUpdates);
    }

    static async delete(tenantId, presetId) {
        const sql = `DELETE FROM seo_presets WHERE id = $1 AND tenant_id = $2 RETURNING *`;
        const result = await query(sql, [presetId, tenantId]);
        return result.rows[0];
    }
}

module.exports = SEOPreset;
