const { query } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

class BannerService {

    // Groups
    async getGroups(tenantId) {
        const sql = `
            SELECT * FROM banner_groups 
            WHERE tenant_id = $1 
            ORDER BY created_at DESC
        `;
        const { rows } = await query(sql, [tenantId]);
        return rows;
    }

    async getGroup(tenantId, id) {
        // Fetch group
        const groupSql = `SELECT * FROM banner_groups WHERE id = $1 AND tenant_id = $2`;
        const groupRes = await query(groupSql, [id, tenantId]);

        if (groupRes.rows.length === 0) return null;

        const group = groupRes.rows[0];

        // Fetch banners
        const bannersSql = `
            SELECT * FROM banners 
            WHERE group_id = $1 
            ORDER BY sort_order ASC
        `;
        const bannersRes = await query(bannersSql, [id]);

        group.banners = bannersRes.rows;
        return group;
    }

    async createGroup(tenantId, data) {
        const { name, banners = [] } = data;
        const groupId = uuidv4();

        // Start transaction manually if needed, or just sequential
        // 1. Create Group
        const groupSql = `
            INSERT INTO banner_groups (id, tenant_id, name)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const { rows } = await query(groupSql, [groupId, tenantId, name]);
        const group = rows[0];

        // 2. Create Banners
        if (banners.length > 0) {
            await this.updateBanners(groupId, banners);
        }

        return this.getGroup(tenantId, groupId);
    }

    async updateGroup(tenantId, id, data) {
        const { name, banners } = data;

        // Verify ownership
        const check = await query('SELECT id FROM banner_groups WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
        if (check.rows.length === 0) throw new Error('Group not found');

        // Update name
        if (name) {
            await query('UPDATE banner_groups SET name = $1 WHERE id = $2', [name, id]);
        }

        // Update banners (Full replace strategy for simplicity: Delete all, Re-insert)
        if (banners) {
            await query('DELETE FROM banners WHERE group_id = $1', [id]);
            await this.updateBanners(id, banners);
        }

        return this.getGroup(tenantId, id);
    }

    async deleteGroup(tenantId, id) {
        // Verify ownership
        const check = await query('SELECT id FROM banner_groups WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
        if (check.rows.length === 0) throw new Error('Group not found');

        // Cascade delete (if not handled by DB constraint)
        await query('DELETE FROM banners WHERE group_id = $1', [id]);
        await query('DELETE FROM banner_groups WHERE id = $1', [id]);
    }

    // Helper
    async updateBanners(groupId, banners) {
        if (!banners || banners.length === 0) return;

        // Bulk insert could be optimized, but loop is fine for small lists
        /*
          Banner Schema:
          id, group_id, type ('image', 'category', 'collection'), 
          url (target link),
          image_url,
          title (optional),
          subtitle (optional),
          resource_id (optional, for cat/col ID),
          sort_order
        */

        const sql = `
            INSERT INTO banners (id, group_id, type, url, image_url, title, subtitle, resource_id, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;

        for (let i = 0; i < banners.length; i++) {
            const b = banners[i];
            await query(sql, [
                uuidv4(),
                groupId,
                b.type || 'image',
                b.url || '',
                b.image_url || '',
                b.title || null,
                b.subtitle || null,
                b.resource_id || null, // For category/collection linking
                i // sort_order
            ]);
        }
    }
}

module.exports = new BannerService();
