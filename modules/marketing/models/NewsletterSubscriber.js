/**
 * Newsletter Subscriber Model
 */

const { query } = require('../../../config/database');

class NewsletterSubscriber {
    static async create(tenantId, email) {
        const sql = `
            INSERT INTO newsletter_subscribers (tenant_id, email, status)
            VALUES ($1, $2, 'active')
            ON CONFLICT (tenant_id, email) 
            DO UPDATE SET status = 'active', subscribed_at = NOW(), unsubscribed_at = NULL
            RETURNING *
        `;
        const result = await query(sql, [tenantId, email]);
        return result.rows[0];
    }

    static async findAll(tenantId) {
        const sql = `SELECT * FROM newsletter_subscribers WHERE tenant_id = $1 ORDER BY subscribed_at DESC`;
        const result = await query(sql, [tenantId]);
        return result.rows;
    }

    static async unsubscribe(tenantId, email) {
        const sql = `
            UPDATE newsletter_subscribers 
            SET status = 'unsubscribed', unsubscribed_at = NOW()
            WHERE tenant_id = $1 AND email = $2
            RETURNING *
        `;
        const result = await query(sql, [tenantId, email]);
        return result.rows[0];
    }
}

module.exports = NewsletterSubscriber;
