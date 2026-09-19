/**
 * User Model
 * 
 * PRINCIPLE: Multi-tenant by default - all queries are tenant-scoped
 * PRINCIPLE: No cross-module database foreign keys
 */

const { query } = require('../../../../config/database');
const {
    tenantQuery,
    tenantInsert,
    tenantUpdate,
    findByIdTenant,
    paginatedTenantQuery,
} = require('../../../../utils/dbHelpers');

class User {
    /**
     * Create a new user
     * PRINCIPLE: Multi-tenant by default
     */
    static async create(tenantId, userData) {
        const data = {
            email: userData.email.toLowerCase(),
            password_hash: userData.password_hash,
            first_name: userData.first_name || null,
            last_name: userData.last_name || null,
            business_name: userData.business_name || null,
            business_thumbnail: userData.business_thumbnail || null,
            business_backdrop: userData.business_backdrop || null,
            business_description: userData.business_description || null,
            checkout_style: userData.checkout_style || 'inhouse',
            whatsapp_phone: userData.whatsapp_phone || null,
            avatar_url: userData.avatar_url || null,
            gender: userData.gender || null,
            dob: userData.dob || null,
            status: 'active',
            email_verified: userData.email_verified === true || false,
            email_verification_token: userData.email_verification_token || null,
            email_verification_expires: userData.email_verification_expires || null,
        };

        return await tenantInsert('users', tenantId, data);
    }

    /**
     * Find user by ID
     */
    static async findById(tenantId, userId) {
        return await findByIdTenant('users', tenantId, userId);
    }

    /**
     * Find user by email (tenant-scoped)
     */
    static async findByEmail(tenantId, email) {
        const sql = `
      SELECT * FROM users 
      WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL
    `;
        const result = await query(sql, [tenantId, email.toLowerCase()]);
        return result.rows[0] || null;
    }

    /**
     * Find user by Google ID (tenant-scoped)
     */
    static async findByGoogleId(tenantId, googleId) {
        const sql = `
      SELECT * FROM users 
      WHERE tenant_id = $1 AND google_id = $2 AND deleted_at IS NULL
    `;
        const result = await query(sql, [tenantId, googleId]);
        return result.rows[0] || null;
    }

    /**
     * Find user by verification token
     */
    static async findByVerificationToken(tenantId, token) {
        const sql = `
      SELECT * FROM users 
      WHERE tenant_id = $1 AND email_verification_token = $2 
      AND (email_verification_expires IS NULL OR email_verification_expires > NOW())
      AND deleted_at IS NULL
    `;
        const result = await query(sql, [tenantId, token]);
        return result.rows[0] || null;
    }

    /**
     * Find user by password reset token
     */
    static async findByResetToken(tenantId, token) {
        const sql = `
      SELECT * FROM users 
      WHERE tenant_id = $1 AND password_reset_token = $2 AND deleted_at IS NULL
    `;
        const result = await query(sql, [tenantId, token]);
        return result.rows[0] || null;
    }

    /**
     * Update user
     */
    static async update(tenantId, userId, updates) {
        return await tenantUpdate('users', tenantId, userId, updates);
    }

    /**
     * Verify email
     */
    static async verifyEmail(tenantId, userId) {
        return await tenantUpdate('users', tenantId, userId, {
            email_verified: true,
            email_verification_token: null,
            email_verification_expires: null,
        });
    }

    /**
     * Set email verification token
     */
    static async setEmailVerificationToken(tenantId, userId, token, expiresAt) {
        return await tenantUpdate('users', tenantId, userId, {
            email_verification_token: token,
            email_verification_expires: expiresAt,
        });
    }

    /**
     * Set password reset token
     */
    static async setPasswordResetToken(tenantId, userId, token, expiresAt) {
        return await tenantUpdate('users', tenantId, userId, {
            password_reset_token: token,
            password_reset_expires: expiresAt,
        });
    }

    /**
     * Update password
     */
    static async updatePassword(tenantId, userId, newPasswordHash) {
        return await tenantUpdate('users', tenantId, userId, {
            password_hash: newPasswordHash,
            password_reset_token: null,
            password_reset_expires: null,
        });
    }

    /**
     * Update last login time
     */
    static async updateLastLogin(tenantId, userId) {
        return await tenantUpdate('users', tenantId, userId, {
            last_login_at: new Date(),
        });
    }

    /**
     * Get all users for a tenant (with pagination)
     */
    static async findAll(tenantId, options = {}) {
        const conditions = {};

        if (options.status) {
            conditions.status = options.status;
        }

        return await tenantQuery(
            'users',
            tenantId,
            conditions,
            options.orderBy || 'created_at DESC',
            options.limit
        );
    }

    /**
     * Get paginated users for a tenant
     */
    static async findAllPaginated(tenantId, options = {}) {
        const conditions = {};

        if (options.status) {
            conditions.status = options.status;
        }

        return await paginatedTenantQuery(
            'users',
            tenantId,
            {
                page: options.page,
                perPage: options.perPage,
                orderBy: options.orderBy || 'created_at DESC',
                conditions,
                search: options.search
            }
        );
    }

    /**
     * Soft delete user
     */
    static async softDelete(tenantId, userId) {
        return await tenantUpdate('users', tenantId, userId, {
            deleted_at: new Date(),
            status: 'deleted',
        });
    }
}

module.exports = User;
