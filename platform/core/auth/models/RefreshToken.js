/**
 * Refresh Token Model
 * 
 * PRINCIPLE: Multi-tenant by default
 */

const { query } = require('../../../../config/database');
const { tenantInsert } = require('../../../../utils/dbHelpers');

class RefreshToken {
    /**
     * Create a new refresh token
     */
    static async create(tenantId, userId, token, expiresAt) {
        const data = {
            user_id: userId,
            token,
            expires_at: expiresAt,
        };

        return await tenantInsert('refresh_tokens', tenantId, data);
    }

    /**
     * Find token by token string
     */
    static async findByToken(token) {
        const sql = `
      SELECT * FROM refresh_tokens 
      WHERE token = $1 AND revoked_at IS NULL
    `;
        const result = await query(sql, [token]);
        return result.rows[0] || null;
    }

    /**
     * Revoke a token
     */
    static async revoke(tokenId, replacedByToken = null) {
        const sql = `
      UPDATE refresh_tokens
      SET revoked_at = NOW(), replaced_by_token = $1
      WHERE id = $2
      RETURNING *
    `;
        const result = await query(sql, [replacedByToken, tokenId]);
        return result.rows[0];
    }

    /**
     * Revoke all tokens for a user
     */
    static async revokeAllForUser(tenantId, userId) {
        const sql = `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL
    `;
        await query(sql, [tenantId, userId]);
    }

    /**
     * Check if token is valid
     */
    static async isValid(token) {
        const refreshToken = await this.findByToken(token);

        if (!refreshToken) return false;
        if (refreshToken.revoked_at) return false;
        if (new Date(refreshToken.expires_at) < new Date()) return false;

        return true;
    }

    /**
     * Clean up expired tokens (for cron job)
     */
    static async cleanupExpired() {
        const sql = `
      DELETE FROM refresh_tokens
      WHERE expires_at < NOW() OR revoked_at < NOW() - INTERVAL '30 days'
    `;
        const result = await query(sql);
        return result.rowCount;
    }
}

module.exports = RefreshToken;
