/**
 * be3_ai Module Bootstrapper
 * 
 * Houses the Search Interface Service — the backend bridge
 * for the AI pipeline's structured search execution.
 * 
 * PRINCIPLE: Modules do not import other modules
 * PRINCIPLE: Any module can be removed without crashing the system
 */

const express = require('express');
const { registerSearchRoutes } = require('./routes/search.routes');

async function bootstrap(context) {
    const { app } = context;

    try {
        const router = express.Router();

        // Register search routes
        registerSearchRoutes(router);

        const { query } = require('../../config/database');

        /**
         * POST /be3-ai/internal/profile (Internal)
         * Resolves the user's first name, last name, and email by WhatsApp sender JID.
         */
        router.post('/internal/profile', async (req, res) => {
            const INTERNAL_SECRET = process.env.WA_AUTH_INTERNAL_SECRET || 'damilare';
            if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const { sender_jid, tenant_id } = req.body;
            if (!sender_jid || !tenant_id) {
                return res.status(400).json({ error: 'sender_jid and tenant_id required' });
            }

            // Normalise fallback phone (remove non-digits just in case)
            const normPhone = sender_jid.replace(/\D/g, '');

            try {
                // 1. Resolve user ID from wa_sessions
                const resolveRes = await query(
                    `SELECT user_id FROM wa_sessions WHERE tenant_id = $1 AND (sender_jid = $2 OR wa_phone = $3) LIMIT 1`,
                    [tenant_id, sender_jid, normPhone || sender_jid]
                );

                if (!resolveRes.rows || resolveRes.rows.length === 0) {
                    return res.json({ success: true, user: null }); // Not connected
                }
                const userId = resolveRes.rows[0].user_id;

                // 2. Fetch basic profile from users
                const userRes = await query(
                    `SELECT id, first_name, last_name, email FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
                    [userId, tenant_id]
                );

                const user = userRes.rows[0];
                if (!user) {
                    return res.json({ success: true, user: null });
                }

                // 3. Resolve RBAC roles for vendor status
                try {
                    const Role = require('../../platform/core/roles/models/Role');
                    const roles = await Role.getUserRoles(tenant_id, userId);
                    const isVendor = roles.some(r => r.name.toLowerCase() === 'vendor' || r.name.toLowerCase() === 'admin');
                    user.role = isVendor ? 'VENDOR' : 'USER';
                } catch (e) {
                    console.error('[be3_ai] Failed to resolve roles:', e.message);
                    user.role = 'USER';
                }

                res.json({ success: true, user });
            } catch (err) {
                console.error('[be3_ai] Profile fetch error:', err.message);
                res.status(500).json({ error: 'Database query failed' });
            }
        });

        // Mount router
        app.use('/be3-ai', router);

        console.log('[be3_ai] Module initialized');
        return true;
    } catch (error) {
        console.error('[be3_ai] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
