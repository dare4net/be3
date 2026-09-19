'use strict';

const { query } = require('../../config/database');
const TYPES = require('./types');
const inapp = require('./channels/inapp');
const email = require('./channels/email');
const fcm = require('./channels/fcm');
const RecipientResolver = require('./RecipientResolver');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3003';
const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:3001';

/* ── Preference check ──────────────────────────────────────── */
async function isEnabled(userId, type, channel) {
    if (!userId) return true;
    const res = await query(
        `SELECT enabled FROM notification_preferences WHERE user_id = $1 AND type = $2 AND channel = $3`,
        [userId, type, channel]
    );
    // Default ON if no preference row
    return res.rows[0] ? res.rows[0].enabled : true;
}

/* ── Core send: one recipient ──────────────────────────────── */
async function send(app, tenantId, userId, type, { title, message, actionUrl, templateData = {}, target = 'customer' } = {}) {
    const config = TYPES[type];
    if (!config) {
        console.warn(`[Notifications] Unknown type: ${type}`);
        return;
    }

    const metadata = { target, type, ...templateData };

    try {
        // 1. In-app (always, no preference check — user can clear in UI)
        if (config.inapp) {
            await inapp.deliver({ app, tenantId, userId, type, title, message, actionUrl, metadata });
        }

        // 2. Email
        if (config.email && await isEnabled(userId, type, 'email')) {
            await email.deliver({ userId, type, title, message, actionUrl, templateData });
        }

        // 3. FCM (browser + PWA)
        if (config.fcm && await isEnabled(userId, type, 'fcm')) {
            await fcm.deliver({ userId, title, message, actionUrl, metadata: { type } });
        }
    } catch (err) {
        console.error(`[Notifications] Error sending ${type} to ${userId}:`, err.message);
    }
}

/* ── Admin broadcast: resolves recipients first ────────────── */
async function sendAdmin(app, tenantId, vendorId, permissionScope, type, payload) {
    const config = TYPES[type];
    if (!config) return;

    const recipients = await RecipientResolver.resolve(tenantId, vendorId, permissionScope);
    await Promise.allSettled(
        recipients.map(uid => send(app, tenantId, uid, type, { ...payload, target: 'admin' }))
    );
}

module.exports = { send, sendAdmin };
