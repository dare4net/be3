/**
 * WA Auth Module — Bootstrap
 * Registers all /wa-auth routes
 */

const express = require('express');
const { asyncHandler } = require('../../middleware/errorHandler');
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const waAuthService = require('./services/wa_auth.service');

const INTERNAL_SECRET = process.env.WA_AUTH_INTERNAL_SECRET || '';

/**
 * Middleware to verify that the caller is be3-WA (internal service)
 */
function internalAuth(req, res, next) {
    const secret = req.headers['x-internal-secret'];
    if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

async function bootstrap(context) {
    const { app } = context;

    try {
        const router = express.Router();

        // ── Public / Internal Routes ────────────────────────────────────────

        /**
         * POST /wa-auth/verify
         * Called by be3-WA when a user sends a verification code.
         * Protected by internal secret.
         */
        router.post('/verify', internalAuth, asyncHandler(async (req, res) => {
            const { phone, code, tenant_id } = req.body;
            console.log('[WA Auth] /verify called — body:', { phone, code, tenant_id });

            if (!phone || !code || !tenant_id) {
                console.warn('[WA Auth] /verify missing fields:', { phone: !!phone, code: !!code, tenant_id: !!tenant_id });
                return res.status(400).json({ error: 'phone, code, and tenant_id are required' });
            }

            const result = await waAuthService.verifyCode(phone, code, tenant_id);
            console.log('[WA Auth] verifyCode result:', result);

            if (!result.success) {
                return res.status(400).json({ success: false, reason: result.reason });
            }

            res.json({ success: true, user_id: result.user_id, wa_phone: result.wa_phone });
        }));

        /**
         * POST /wa-auth/resolve
         * Resolve which user a WA phone number belongs to.
         * Called by be3-WA to attach user identity to sessions.
         * Protected by internal secret.
         */
        router.post('/resolve', internalAuth, asyncHandler(async (req, res) => {
            const { phone, tenant_id } = req.body;
            if (!phone || !tenant_id) {
                return res.status(400).json({ error: 'phone and tenant_id are required' });
            }
            const userId = await waAuthService.resolveUser(phone, tenant_id);
            res.json({ user_id: userId || null });
        }));

        /**
         * POST /wa-auth/magic/consume
         * Consume a one-time magic token, returns a short-lived JWT.
         * Called from the storefront magic link landing page.
         */
        router.post('/magic/consume', asyncHandler(async (req, res) => {
            const { token } = req.body;
            if (!token) return res.status(400).json({ error: 'token is required' });

            const result = await waAuthService.consumeMagicToken(token);
            if (!result.success) {
                return res.status(400).json({ success: false, reason: result.reason });
            }

            console.log('[WA Auth] /magic/consume success. Metadata being returned:', result.metadata);

            res.json({
                success: true,
                jwt: result.jwt,
                user: result.user,
                destination: result.destination,
                user_id: result.user_id,
                metadata: result.metadata || {}  // ← was missing, frontend needs this
            });
        }));

        // ── Authenticated User Routes ───────────────────────────────────────

        /**
         * POST /wa-auth/initiate
         * Start a WA phone verification for the logged-in storefront user.
         */
        router.post('/initiate', authenticate, asyncHandler(async (req, res) => {
            const { phone } = req.body;
            const { tenantId, user } = req;

            if (!phone) return res.status(400).json({ error: 'phone is required' });
            if (!user?.id) return res.status(401).json({ error: 'Unauthorized' });

            const result = await waAuthService.initiateVerification(user.id, phone, tenantId);
            res.json(result);
        }));

        /**
         * GET /wa-auth/status
         * Return all WA numbers linked to the logged-in user.
         */
        router.get('/status', authenticate, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const numbers = await waAuthService.getLinkedNumbers(user.id, tenantId);
            res.json({ connected: numbers });
        }));

        /**
         * DELETE /wa-auth/disconnect
         * Disconnect a WA number from the logged-in user's account.
         */
        router.delete('/disconnect', authenticate, asyncHandler(async (req, res) => {
            const { phone } = req.body;
            const { tenantId, user } = req;

            if (!phone) return res.status(400).json({ error: 'phone is required' });

            const removed = await waAuthService.disconnectNumber(user.id, phone, tenantId);
            if (!removed) {
                return res.status(404).json({ error: 'Number not found or not linked to your account' });
            }
            res.json({ success: true, message: 'Number disconnected' });
        }));

        /**
         * POST /wa-auth/magic/generate
         * Generate a magic link token for the logged-in user.
         * Called by be3_ai when building authenticated CTA URLs.
         * Protected by internal secret OR user auth.
         */
        router.post('/magic/generate', asyncHandler(async (req, res) => {
            // Accept either internal service call or logged-in user
            const isInternal = req.headers['x-internal-secret'] === INTERNAL_SECRET;
            const { user_id, wa_phone, tenant_id, destination, target_app, metadata } = req.body;

            if (!isInternal) {
                // Require user auth
                if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            }

            const tid = tenant_id || req.tenantId;
            const uid = user_id || req.user?.id;
            const wp = wa_phone;

            if (!uid || !wp || !tid) {
                return res.status(400).json({ error: 'user_id, wa_phone, and tenant_id are required' });
            }

            const result = await waAuthService.generateMagicToken(uid, wp, tid, destination, target_app, metadata);

            // Build absolute link based on target app
            const adminUrl = process.env.ADMIN_URL || process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3001';
            const storefrontUrl = process.env.STOREFRONT_URL || process.env.FRONTEND_URL || 'http://localhost:3003';
            const baseUrl = target_app === 'admin' ? adminUrl : storefrontUrl;
            const link = `${baseUrl}/auth/magic?token=${result.token}`;

            res.json({ success: true, ...result, link });
        }));


        app.use('/wa-auth', router);

        // Clean up expired rows every 15 minutes
        setInterval(() => waAuthService.purgeExpired().catch(console.error), 15 * 60 * 1000);

        console.log('[WA Auth] Module initialized');
        return true;
    } catch (error) {
        console.error('[WA Auth] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
