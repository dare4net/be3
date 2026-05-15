'use strict';

const express = require('express');
const { query, pool } = require('../../config/database');
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../middleware/errorHandler');
const listeners = require('./listeners');
const migration = require('../../database/migrations/083_notifications');

const router = express.Router();

/* ── Routes ────────────────────────────────────────────────── */

// GET /notifications
router.get('/', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const page    = parseInt(req.query.page)     || 1;
    const perPage = Math.min(parseInt(req.query.per_page) || 20, 50);
    const offset  = (page - 1) * perPage;

    const [result, countRes] = await Promise.all([
        query(
            `SELECT * FROM notifications WHERE tenant_id = $1 AND user_id = $2
             ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
            [tenantId, user.id, perPage, offset]
        ),
        query(
            `SELECT COUNT(*) FROM notifications WHERE tenant_id = $1 AND user_id = $2`,
            [tenantId, user.id]
        ),
    ]);

    res.json({
        success: true,
        data: result.rows,
        pagination: {
            page, perPage,
            total: parseInt(countRes.rows[0].count),
            totalPages: Math.ceil(parseInt(countRes.rows[0].count) / perPage),
        },
    });
}));

// GET /notifications/unread-count
router.get('/unread-count', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const r = await query(
        `SELECT COUNT(*) FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND is_read = false`,
        [tenantId, user.id]
    );
    res.json({ success: true, count: parseInt(r.rows[0].count) });
}));

// PATCH /notifications/read-all  (must come before /:id/read)
router.patch('/read-all', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    await query(
        `UPDATE notifications SET is_read = true, read_at = NOW()
         WHERE tenant_id = $1 AND user_id = $2 AND is_read = false`,
        [tenantId, user.id]
    );
    res.json({ success: true });
}));

// PATCH /notifications/:id/read
router.patch('/:id/read', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    await query(
        `UPDATE notifications SET is_read = true, read_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
        [req.params.id, tenantId, user.id]
    );
    res.json({ success: true });
}));

// POST /notifications/fcm/token — register FCM token
router.post('/fcm/token', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { token, platform = 'web' } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });

    await query(
        `INSERT INTO fcm_tokens (tenant_id, user_id, token, platform, user_agent, last_used_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (token) DO UPDATE SET last_used_at = NOW(), user_id = $2`,
        [tenantId, user.id, token, platform, req.headers['user-agent'] || null]
    );
    res.json({ success: true });
}));

// DELETE /notifications/fcm/token — unregister (on logout or permission revoke)
router.delete('/fcm/token', authenticate, asyncHandler(async (req, res) => {
    const { user } = req;
    const { token } = req.body;
    if (token) {
        await query(`DELETE FROM fcm_tokens WHERE token = $1 AND user_id = $2`, [token, user.id]);
    } else {
        await query(`DELETE FROM fcm_tokens WHERE user_id = $1`, [user.id]);
    }
    res.json({ success: true });
}));

// GET /notifications/preferences
router.get('/preferences', authenticate, asyncHandler(async (req, res) => {
    const { user } = req;
    const r = await query(
        `SELECT type, channel, enabled FROM notification_preferences WHERE user_id = $1`,
        [user.id]
    );
    res.json({ success: true, preferences: r.rows });
}));

// PATCH /notifications/preferences
router.patch('/preferences', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { type, channel, enabled } = req.body;
    if (!type || !channel || typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'type, channel, and enabled (boolean) are required' });
    }
    await query(
        `INSERT INTO notification_preferences (tenant_id, user_id, type, channel, enabled)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, type, channel) DO UPDATE SET enabled = $5, updated_at = NOW()`,
        [tenantId, user.id, type, channel, enabled]
    );
    res.json({ success: true });
}));

// POST /notifications/test — fires a real notification to the authenticated user
// Useful for local dev testing. Remove or gate behind NODE_ENV check in production.
router.post('/test', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const NotificationService = require('./NotificationService');
    const type = req.body.type || 'payment.success';
    const title = req.body.title || '🧪 Test Notification';
    const message = req.body.message || 'This is a test notification from the server.';
    const actionUrl = req.body.actionUrl || null;

    await NotificationService.send(req.app, tenantId, user.id, type, {
        title,
        message,
        actionUrl,
        templateData: { test: true },
        target: 'customer',
    });

    res.json({ success: true, message: `Notification fired to user ${user.id}` });
}));

/* ── Bootstrap ─────────────────────────────────────────────── */
async function bootstrap({ app, eventBus }) {
    try {
        // 1. Run DB migration (idempotent — IF NOT EXISTS guards)
        const client = await pool.connect();
        try {
            await migration.up(client);
        } catch (err) {
            if (!err.message.includes('already exists')) {
                console.warn('[Notifications] Migration warning:', err.message);
            }
        } finally {
            client.release();
        }

        // 2. Register eventBus listeners
        listeners.register(eventBus, app);

        // 3. Mount routes
        app.use('/notifications', router);

        console.log('[Notifications] Module initialized');
        return true;
    } catch (err) {
        console.error('[Notifications] Bootstrap failed:', err.message);
        return false;
    }
}

module.exports = { bootstrap };
