const path = require('path');
const { query } = require('../../../config/database');

let admin = null;
let messaging = null;

function getMessaging() {
    if (messaging) return messaging;

    const rawPath = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!rawPath || !rawPath.trim()) {
        console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT_JSON not set — push notifications disabled');
        return null;
    }

    const serviceAccountPath = path.resolve(rawPath.trim());

    try {
        if (!admin) {
            admin = require('firebase-admin');
            if (!admin.apps.length) {
                const serviceAccount = require(serviceAccountPath);
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                });
                console.log('[FCM] Firebase Admin initialized ✓');
            }
        }
        messaging = admin.messaging();
        return messaging;
    } catch (err) {
        console.error('[FCM] Failed to initialize Firebase:', err.message);
        return null;
    }
}

/**
 * Sends a push notification to all FCM tokens registered for a user.
 * Silently skips if Firebase is not configured.
 * Removes invalid/expired tokens automatically.
 */
async function deliver({ userId, title, message, actionUrl, metadata = {} }) {
    const fcm = getMessaging();
    if (!fcm || !userId) return;

    // Fetch all user tokens
    const tokenRes = await query(
        `SELECT id, token FROM fcm_tokens WHERE user_id = $1`,
        [userId]
    );
    if (!tokenRes.rows.length) return;

    const tokens = tokenRes.rows.map(r => r.token);
    const staleIds = [];

    const payload = {
        notification: { title, body: message || '' },
        data: {
            actionUrl: actionUrl || '/',
            type: metadata.type || '',
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        webpush: {
            notification: {
                icon: '/favicon.ico'
            },
            fcmOptions: actionUrl ? { link: actionUrl } : undefined,
        },
    };

    // Send to each token individually to track failures
    await Promise.allSettled(
        tokenRes.rows.map(async ({ id, token }) => {
            try {
                await fcm.send({ ...payload, token });
                // Update last_used_at
                await query(`UPDATE fcm_tokens SET last_used_at = NOW() WHERE id = $1`, [id]);
            } catch (err) {
                const code = err.errorInfo?.code || '';
                if (
                    code === 'messaging/registration-token-not-registered' ||
                    code === 'messaging/invalid-registration-token'
                ) {
                    staleIds.push(id);
                } else {
                    console.error(`[FCM] Send error for token ${token.slice(0, 20)}…:`, err.message);
                }
            }
        })
    );

    // Purge stale tokens
    if (staleIds.length) {
        await query(
            `DELETE FROM fcm_tokens WHERE id = ANY($1::uuid[])`,
            [staleIds]
        );
        console.log(`[FCM] Removed ${staleIds.length} stale token(s) for user ${userId}`);
    }
}

module.exports = { deliver };
