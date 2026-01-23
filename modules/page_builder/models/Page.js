/**
 * Page Model
 * Manages custom pages with SEO and navigation settings
 * PRINCIPLE: Multi-tenant by default
 */

const { query } = require('../../../config/database');
const { tenantInsert, tenantUpdate, findByIdTenant } = require('../../../utils/dbHelpers');

class Page {
    static async create(tenantId, pageData) {
        return await tenantInsert('pages', tenantId, {
            slug: pageData.slug,
            title: pageData.title,
            meta_description: pageData.meta_description || null,
            // SEO Meta Fields
            og_title: pageData.og_title || pageData.title,
            og_description: pageData.og_description || pageData.meta_description,
            og_image: pageData.og_image || null,
            og_type: pageData.og_type || 'website',
            twitter_card: pageData.twitter_card || 'summary_large_image',
            twitter_title: pageData.twitter_title || pageData.title,
            twitter_description: pageData.twitter_description || pageData.meta_description,
            twitter_image: pageData.twitter_image || pageData.og_image,
            canonical_url: pageData.canonical_url || null,
            robots: pageData.robots || 'index,follow',
            structured_data: pageData.structured_data ? JSON.stringify(pageData.structured_data) : null,
            // Page Settings
            is_published: pageData.is_published !== undefined ? pageData.is_published : false,
            show_in_nav: pageData.show_in_nav !== undefined ? pageData.show_in_nav : false,
            show_header: pageData.show_header !== undefined ? pageData.show_header : true,
            show_footer: pageData.show_footer !== undefined ? pageData.show_footer : true,
            is_system: pageData.is_system || false,
        });
    }

    static async findAll(tenantId, includeUnpublished = false) {
        const sql = includeUnpublished
            ? `SELECT * FROM pages WHERE tenant_id = $1 ORDER BY created_at DESC`
            : `SELECT * FROM pages WHERE tenant_id = $1 AND is_published = true ORDER BY created_at DESC`;

        const result = await query(sql, [tenantId]);
        return result.rows;
    }

    static async findById(tenantId, pageId) {
        return await findByIdTenant('pages', tenantId, pageId);
    }

    static async findBySlug(tenantId, slug) {
        const sql = `SELECT * FROM pages WHERE tenant_id = $1 AND slug = $2`;
        const result = await query(sql, [tenantId, slug]);
        return result.rows[0] || null;
    }

    static async update(tenantId, pageId, updates) {
        const allowedUpdates = {};

        if (updates.slug !== undefined) allowedUpdates.slug = updates.slug;
        if (updates.title !== undefined) allowedUpdates.title = updates.title;
        if (updates.meta_description !== undefined) allowedUpdates.meta_description = updates.meta_description;

        // SEO Meta Fields
        if (updates.og_title !== undefined) allowedUpdates.og_title = updates.og_title;
        if (updates.og_description !== undefined) allowedUpdates.og_description = updates.og_description;
        if (updates.og_image !== undefined) allowedUpdates.og_image = updates.og_image;
        if (updates.og_type !== undefined) allowedUpdates.og_type = updates.og_type;
        if (updates.twitter_card !== undefined) allowedUpdates.twitter_card = updates.twitter_card;
        if (updates.twitter_title !== undefined) allowedUpdates.twitter_title = updates.twitter_title;
        if (updates.twitter_description !== undefined) allowedUpdates.twitter_description = updates.twitter_description;
        if (updates.twitter_image !== undefined) allowedUpdates.twitter_image = updates.twitter_image;
        if (updates.canonical_url !== undefined) allowedUpdates.canonical_url = updates.canonical_url;
        if (updates.robots !== undefined) allowedUpdates.robots = updates.robots;
        if (updates.structured_data !== undefined) {
            allowedUpdates.structured_data = updates.structured_data ? JSON.stringify(updates.structured_data) : null;
        }

        // Page Settings
        if (updates.is_published !== undefined) allowedUpdates.is_published = updates.is_published;
        if (updates.show_in_nav !== undefined) allowedUpdates.show_in_nav = updates.show_in_nav;
        if (updates.show_header !== undefined) allowedUpdates.show_header = updates.show_header;
        if (updates.show_footer !== undefined) allowedUpdates.show_footer = updates.show_footer;

        return await tenantUpdate('pages', tenantId, pageId, allowedUpdates);
    }

    static async delete(tenantId, pageId) {
        // Check if it's a system page
        const page = await this.findById(tenantId, pageId);
        if (page && page.is_system) {
            throw new Error('Cannot delete system page');
        }

        const sql = `DELETE FROM pages WHERE id = $1 AND tenant_id = $2 RETURNING *`;
        const result = await query(sql, [pageId, tenantId]);
        return result.rows[0];
    }

    static async getNavigationPages(tenantId) {
        const sql = `SELECT * FROM pages WHERE tenant_id = $1 AND is_published = true AND show_in_nav = true ORDER BY title ASC`;
        const result = await query(sql, [tenantId]);
        return result.rows;
    }
}

module.exports = Page;
