const path = require('path');
const { query } = require('../../../config/database');

let admin = null;
let messaging = null;

function getMessaging() {
    if (messaging) return messaging;

    try {
        if (!admin) {
            let serviceAccount;

            // 1. Production: Base64 Encoded JSON string
            if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
                serviceAccount = JSON.parse(
                    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
                );
            }
            // 2. Production: Individual Environment Variables
            else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
                serviceAccount = {
                    type: 'service_account',
                    project_id: process.env.FIREBASE_PROJECT_ID,
                    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
                    client_email: process.env.FIREBASE_CLIENT_EMAIL,
                    // Replace literal \n with actual newlines (dotenv may or may not expand them)
                    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                };
            }
            // 3. Local Development: File Path
            else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
                const rawPath = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
                serviceAccount = require(path.resolve(rawPath));
            } else {
                console.warn('[FCM] No Firebase credentials provided (Base64, Env Vars, or Path) — push disabled');
                return null;
            }

            admin = require('firebase-admin');
            if (!admin.apps.length) {
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
