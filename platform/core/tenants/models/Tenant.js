/**
 * Tenant Model
 * 
 * PRINCIPLE: Multi-tenant by default - this is the foundation of multi-tenancy
 * PRINCIPLE: No cross-module database foreign keys
 */

const { query } = require('../../../../config/database');

class Tenant {
    /**
     * Create a new tenant
     */
    static async create(tenantData) {
        const sql = `
      INSERT INTO tenants (
        name,
        subdomain,
        domain,
        status,
        settings,
        logo_url,
        timezone,
        trial_ends_at,
        setup_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 14); // 14-day trial

        const result = await query(sql, [
            tenantData.name,
            tenantData.subdomain.toLowerCase(),
            tenantData.domain || null,
            'trial',
            JSON.stringify(tenantData.settings || {}),
            tenantData.logo_url || null,
            tenantData.timezone || 'UTC',
            tenantData.trial_ends_at || trialEndsAt,
            tenantData.setup_status || 'NEW'
        ]);

        return result.rows[0];
    }

    /**
     * Find tenant by ID
     */
    static async findById(tenantId) {
        const sql = `
      SELECT * FROM tenants 
      WHERE id = $1 AND deleted_at IS NULL
    `;
        const result = await query(sql, [tenantId]);
        return result.rows[0] || null;
    }

    /**
     * Find tenant by subdomain
     */
    static async findBySubdomain(subdomain) {
        const sql = `
      SELECT * FROM tenants 
      WHERE subdomain = $1 AND deleted_at IS NULL
    `;
        const result = await query(sql, [subdomain.toLowerCase()]);
        return result.rows[0] || null;
    }

    /**
     * Update tenant
     */
    static async update(tenantId, updates) {
        const allowedFields = ['name', 'domain', 'status', 'settings', 'logo_url', 'timezone', 'setup_status'];
        const fields = [];
        const values = [];
        let paramCount = 1;

        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                fields.push(`${key} = $${paramCount}`);
                values.push(typeof updates[key] === 'object' ? JSON.stringify(updates[key]) : updates[key]);
                paramCount++;
            }
        });

        if (fields.length === 0) {
            throw new Error('No valid fields to update');
        }

        fields.push(`updated_at = NOW()`);
        values.push(tenantId);

        const sql = `
      UPDATE tenants 
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

        const result = await query(sql, values);
        return result.rows[0];
    }

    /**
     * Get all tenants (for super admin)
     */
    static async findAll(options = {}) {
        let sql = 'SELECT * FROM tenants WHERE deleted_at IS NULL';
        const params = [];
        let paramCount = 1;

        if (options.status) {
            sql += ` AND status = $${paramCount}`;
            params.push(options.status);
            paramCount++;
        }

        sql += ' ORDER BY created_at DESC';

        if (options.limit) {
            sql += ` LIMIT ${parseInt(options.limit)}`;
        }

        const result = await query(sql, params);
        return result.rows;
    }

    /**
     * Soft delete tenant
     */
    static async softDelete(tenantId) {
        const sql = `
      UPDATE tenants
      SET deleted_at = NOW(), status = 'cancelled'
      WHERE id = $1
      RETURNING *
    `;
        const result = await query(sql, [tenantId]);
        return result.rows[0];
    }

    /**
     * Check if subdomain is available
     */
    static async isSubdomainAvailable(subdomain) {
        const sql = `
      SELECT COUNT(*) FROM tenants WHERE subdomain = $1
    `;
        const result = await query(sql, [subdomain.toLowerCase()]);
        return parseInt(result.rows[0].count) === 0;
    }

    /**
     * Update tenant settings
     */
    static async updateSettings(tenantId, settings) {
        const sql = `
      UPDATE tenants
      SET settings = settings || $1::jsonb, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
        const result = await query(sql, [JSON.stringify(settings), tenantId]);
        return result.rows[0];
    }

    /**
     * Get tenant settings
     */
    static async getSettings(tenantId) {
        const tenant = await this.findById(tenantId);
        return tenant ? tenant.settings : null;
    }
}

module.exports = Tenant;
