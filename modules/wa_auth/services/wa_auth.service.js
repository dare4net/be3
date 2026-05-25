/**
 * WA Auth Service
 * Handles phone binding verification codes and magic link tokens
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('../../../config/database');
const User = require('../../../platform/core/auth/models/User');

const MAGIC_TOKEN_SECRET = process.env.MAGIC_TOKEN_SECRET || 'wa_magic_secret_change_me';
const CODE_TTL_MINUTES = 10;
const MAGIC_TOKEN_TTL_MINUTES = 15;

/**
 * Generate a human-readable verification code: BE3-XXXX
 */
function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O, 0, I, 1 to avoid confusion
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars[crypto.randomInt(0, chars.length)];
    }
    return `BE3-${code}`;
}

/**
 * Normalise incoming phone to E.164 (digits only, no +)
 */
function normalisePhone(phone) {
    return String(phone).replace(/\D/g, '');
}

/**
 * Initiate a WA verification — store a pending code for a user's phone number.
 * Returns the code + a pre-filled wa.me link.
 */
async function initiateVerification(userId, phone, tenantId) {
    const normPhone = normalisePhone(phone);
    if (!normPhone || normPhone.length < 7) {
        throw new Error('Invalid phone number');
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    // Remove any previous pending verifications for this user + phone
    await query(
        `DELETE FROM wa_verifications WHERE user_id = $1 AND phone = $2 AND tenant_id = $3`,
        [userId, normPhone, tenantId]
    );

    await query(
        `INSERT INTO wa_verifications (tenant_id, user_id, phone, code, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, userId, normPhone, code, expiresAt]
    );

    const botNumber = process.env.WA_BOT_NUMBER || '';
    const waMeLink = botNumber
        ? `https://wa.me/${botNumber}?text=${encodeURIComponent(code)}`
        : null;

    return { code, wa_me_link: waMeLink, expires_in_minutes: CODE_TTL_MINUTES };
}

/**
 * Verify an incoming code from the bot.
 * Called by be3-WA with the sender's WA phone + the code they typed.
 * On success creates a permanent wa_sessions binding.
 */
async function verifyCode(senderPhone, code, tenantId) {
    const normPhone = normalisePhone(senderPhone);
    const normCode = String(code).trim().toUpperCase();

    console.log('[WA Auth] verifyCode — querying with:', { normPhone, normCode, tenantId });

    // Match by code + tenant only — phone match is skipped because WhatsApp
    // @lid mode means the sender JID may not match the enrolled phone number.
    // Security: codes expire in 10 min and are single-use random strings.
    const result = await query(
        `SELECT * FROM wa_verifications
         WHERE code = $1 AND tenant_id = $2 AND expires_at > NOW()
         LIMIT 1`,
        [normCode, tenantId]
    );

    console.log('[WA Auth] verifyCode — rows found:', result.rows.length);
    if (result.rows.length === 0) {
        const allRows = await query(
            `SELECT phone, code, expires_at FROM wa_verifications WHERE tenant_id = $1`,
            [tenantId]
        );
        console.log('[WA Auth] verifyCode — all pending codes for tenant:', allRows.rows);
        return { success: false, reason: 'invalid_or_expired' };
    }

    const verification = result.rows[0];

    // wa_phone  = declared phone (from storefront initiate — the number the user owns, shown in UI)
    // sender_jid = actual sender key (may be @lid digits or real phone — used for fast lookup)
    await query(
        `INSERT INTO wa_sessions (tenant_id, user_id, wa_phone, sender_jid)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, wa_phone)
         DO UPDATE SET user_id = EXCLUDED.user_id,
                       sender_jid = EXCLUDED.sender_jid,
                       connected_at = NOW()`,
        [tenantId, verification.user_id, verification.phone, normPhone]
    );

    // Clean up used verification
    await query(`DELETE FROM wa_verifications WHERE id = $1`, [verification.id]);

    return { success: true, user_id: verification.user_id, wa_phone: verification.phone };
}


/**
 * Resolve which user account a WA sender belongs to.
 * Checks sender_jid first (handles @lid), then wa_phone as fallback.
 */
async function resolveUser(waPhone, tenantId) {
    const normPhone = normalisePhone(waPhone);
    const result = await query(
        `SELECT user_id FROM wa_sessions
         WHERE tenant_id = $1 AND (sender_jid = $2 OR wa_phone = $2)
         LIMIT 1`,
        [tenantId, normPhone]
    );
    return result.rows[0]?.user_id || null;
}

/**
 * Get all WA numbers linked to a user's account.
 */
async function getLinkedNumbers(userId, tenantId) {
    const result = await query(
        `SELECT wa_phone, connected_at FROM wa_sessions
         WHERE tenant_id = $1 AND user_id = $2
         ORDER BY connected_at ASC`,
        [tenantId, userId]
    );
    return result.rows;
}

/**
 * Disconnect a WA number from an account.
 */
async function disconnectNumber(userId, waPhone, tenantId) {
    const normPhone = normalisePhone(waPhone);
    const result = await query(
        `DELETE FROM wa_sessions WHERE tenant_id = $1 AND user_id = $2 AND wa_phone = $3 RETURNING id`,
        [tenantId, userId, normPhone]
    );
    return result.rows.length > 0;
}

/**
 * Generate a single-use magic link token for authenticated CTA links.
 */
async function generateMagicToken(userId, waPhone, tenantId, destination = '/', target_app = 'storefront', metadata = {}) {
    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + MAGIC_TOKEN_TTL_MINUTES * 60 * 1000);

    const safeMetadata = metadata ? JSON.stringify(metadata) : '{}';

    await query(
        `INSERT INTO magic_tokens (token, tenant_id, user_id, wa_phone, destination, target_app, metadata, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [token, tenantId, userId, normalisePhone(waPhone), destination, target_app, safeMetadata, expiresAt]
    );

    return { token, expires_in_minutes: MAGIC_TOKEN_TTL_MINUTES };
}

/**
 * Consume a magic token — validates, deletes, and returns a short-lived JWT.
 */
async function consumeMagicToken(token) {
    const result = await query(
        `DELETE FROM magic_tokens WHERE token = $1 AND expires_at > NOW() RETURNING *`,
        [token]
    );

    if (result.rows.length === 0) {
        return { success: false, reason: 'invalid_or_expired' };
    }

    const row = result.rows[0];

    // Fetch full user so the frontend can store auth_user directly (no second /auth/me call)
    const user = await User.findById(row.tenant_id, row.user_id);

    // Sign with JWT_ACCESS_SECRET and camelCase payload to match what the authenticate middleware reads
    const jwtSecret = process.env.JWT_ACCESS_SECRET || process.env.MAGIC_TOKEN_SECRET || 'wa_magic_secret_change_me';
    const jwt_token = jwt.sign(
        { userId: row.user_id, tenantId: row.tenant_id, wa_phone: row.wa_phone },
        jwtSecret,
        { expiresIn: '2h' }
    );

    return {
        success: true,
        jwt: jwt_token,
        user: user || null,
        destination: row.destination || '/',
        user_id: row.user_id,
        metadata: row.metadata || {}
    };
}

/**
 * Periodically purge expired rows (call from a cron/setInterval if desired).
 */
async function purgeExpired() {
    await query(`DELETE FROM wa_verifications WHERE expires_at < NOW()`);
    await query(`DELETE FROM magic_tokens WHERE expires_at < NOW()`);
}

module.exports = {
    initiateVerification,
    verifyCode,
    resolveUser,
    getLinkedNumbers,
    disconnectNumber,
    generateMagicToken,
    consumeMagicToken,
    purgeExpired,
    normalisePhone
};
