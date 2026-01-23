/**
 * Super Admin Module
 * Platform-wide administration
 * NOT tenant-scoped - operates at platform level
 */

const express = require('express');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { clearRateLimitForTenant } = require('../config/redis');

async function bootstrap(context) {
    const { app } = context;
    const router = express.Router();
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcrypt');

    // Super Admin Login
    router.post('/login', asyncHandler(async (req, res) => {
        const { email, password } = req.body;

        // Validate against env vars
        if (email === process.env.SUPER_ADMIN_EMAIL && password === process.env.SUPER_ADMIN_PASSWORD) {

            // Generate Token
            const token = jwt.sign(
                { role: 'super_admin', email },
                process.env.JWT_ACCESS_SECRET,
                { expiresIn: '1d' }
            );

            return res.json({
                success: true,
                data: {
                    accessToken: token,
                    user: {
                        id: 'super-admin',
                        email,
                        role: 'super_admin'
                    }
                }
            });
        }

        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }));

    // Middleware to require super admin (simplified - would check JWT claim)
    const requireSuperAdmin = (req, res, next) => {
        // In production, verify super admin JWT claim
        // For now, allow all (would need proper auth)
        next();
    };

    router.use(requireSuperAdmin);

    // Get all tenants
    router.get('/tenants', asyncHandler(async (req, res) => {
        const result = await query('SELECT * FROM tenants ORDER BY created_at DESC');
        res.json({ success: true, tenants: result.rows });
    }));

    // Get one tenant by id
    router.get('/tenants/:tenantId', asyncHandler(async (req, res) => {
        const result = await query('SELECT * FROM tenants WHERE id = $1', [req.params.tenantId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tenant not found' });
        }
        res.json({ success: true, tenant: result.rows[0] });
    }));

    // --- Rate limiting (super admin) ---

    // GET /admin/rate-limit - comprehensive rate limit details and controls
    router.get('/rate-limit', asyncHandler(async (req, res) => {
        const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000;
        const max = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000;

        const exemptRes = await query(
            'SELECT id, name, subdomain, rate_limit_exempt FROM tenants WHERE rate_limit_exempt = true ORDER BY name'
        );

        res.json({
            success: true,
            rateLimit: {
                howItWorks: {
                    scope: 'Per-tenant for tenant-scoped routes (X-Tenant-ID or subdomain). Per-IP for public routes (/health, /admin, /tenants, etc.).',
                    store: 'Redis (rate-limit:<tenantId|ip>)',
                    skip: 'Super admin (req.user.isSuperAdmin) and tenants with rate_limit_exempt=true are never limited.',
                },
                config: {
                    windowMs,
                    windowMinutes: Math.round(windowMs / 60000),
                    max,
                    env: {
                        RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS || '(default 900000)',
                        RATE_LIMIT_MAX_REQUESTS: process.env.RATE_LIMIT_MAX_REQUESTS || '(default 1000)',
                    },
                },
                exemptTenants: exemptRes.rows,
                exemptCount: exemptRes.rows.length,
            },
            actions: {
                setExempt: 'POST /admin/tenants/:tenantId/rate-limit-exempt { "exempt": true|false }',
                clearNow: 'POST /admin/tenants/:tenantId/rate-limit-clear — wipe Redis counters for this tenant (one-time relief, counters will grow again).',
            },
        });
    }));

    // POST /admin/tenants/:tenantId/rate-limit-exempt — set rate_limit_exempt for a tenant
    router.post('/tenants/:tenantId/rate-limit-exempt', asyncHandler(async (req, res) => {
        const { tenantId } = req.params;
        const exempt = !!req.body?.exempt;

        const result = await query(
            'UPDATE tenants SET rate_limit_exempt = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, subdomain, rate_limit_exempt',
            [exempt, tenantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tenant not found' });
        }

        res.json({
            success: true,
            message: `Tenant is now ${exempt ? 'exempt from' : 'subject to'} rate limiting.`,
            tenant: result.rows[0],
        });
    }));

    // POST /admin/tenants/:tenantId/rate-limit-clear — clear Redis rate-limit keys for this tenant (one-time)
    router.post('/tenants/:tenantId/rate-limit-clear', asyncHandler(async (req, res) => {
        const { tenantId } = req.params;

        const exists = await query('SELECT 1 FROM tenants WHERE id = $1', [tenantId]);
        if (exists.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tenant not found' });
        }

        const deleted = await clearRateLimitForTenant(tenantId);

        res.json({
            success: true,
            message: `Cleared ${deleted} rate-limit key(s) for this tenant. Counters will start from zero; limits still apply unless tenant is exempt.`,
            keysDeleted: deleted,
        });
    }));

    // Get all subscription plans
    router.get('/plans', asyncHandler(async (req, res) => {
        const result = await query('SELECT * FROM subscription_plans ORDER BY price_monthly');
        res.json({ success: true, plans: result.rows });
    }));

    // Create subscription plan
    router.post('/plans', asyncHandler(async (req, res) => {
        const sql = `
      INSERT INTO subscription_plans (name, description, price_monthly, price_yearly)
      VALUES ($1, $2, $3, $4) RETURNING *
    `;
        const result = await query(sql, [
            req.body.name,
            req.body.description,
            req.body.price_monthly,
            req.body.price_yearly
        ]);
        res.status(201).json({ success: true, plan: result.rows[0] });
    }));

    // Add module to plan
    router.post('/plans/:planId/modules', asyncHandler(async (req, res) => {
        const sql = `
      INSERT INTO plan_modules (plan_id, module_name, is_enabled)
      VALUES ($1, $2, true)
      ON CONFLICT (plan_id, module_name) DO UPDATE SET is_enabled = true
      RETURNING *
    `;
        const result = await query(sql, [req.params.planId, req.body.module_name]);
        res.status(201).json({ success: true, module: result.rows[0] });
    }));

    // Get users for a tenant
    router.get('/tenants/:tenantId/users', asyncHandler(async (req, res) => {
        const sql = `
            SELECT 
                u.id, 
                u.email, 
                u.first_name, 
                u.last_name, 
                u.status, 
                u.created_at, 
                u.last_login_at,
                COALESCE(STRING_AGG(r.name, ', '), 'No Role') as role
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id
            LEFT JOIN roles r ON ur.role_id = r.id AND ur.tenant_id = r.tenant_id
            WHERE u.tenant_id = $1
            GROUP BY u.id, u.email, u.first_name, u.last_name, u.status, u.created_at, u.last_login_at
            ORDER BY u.created_at DESC
        `;
        const result = await query(sql, [req.params.tenantId]);
        res.json({ success: true, users: result.rows });
    }));

    // Reset user password
    router.post('/tenants/:tenantId/users/:userId/reset-password', asyncHandler(async (req, res) => {
        const { password } = req.body;

        // Hash password
        const passwordHash = await bcrypt.hash(
            password,
            parseInt(process.env.BCRYPT_ROUNDS) || 10
        );

        const sql = `
            UPDATE users 
            SET password_hash = $1, updated_at = NOW()
            WHERE id = $2 AND tenant_id = $3
            RETURNING id, email
        `;

        const result = await query(sql, [passwordHash, req.params.userId, req.params.tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, message: 'Password updated successfully' });
    }));

    // Get platform stats
    router.get('/stats', asyncHandler(async (req, res) => {
        const tenantsCount = await query('SELECT COUNT(*) FROM tenants');
        const usersCount = await query('SELECT COUNT(*) FROM users');
        const ordersCount = await query('SELECT COUNT(*) FROM orders');

        res.json({
            success: true,
            stats: {
                tenants: parseInt(tenantsCount.rows[0].count),
                users: parseInt(usersCount.rows[0].count),
                orders: parseInt(ordersCount.rows[0].count),
            },
        });
    }));

    // Sync/Register all modules (ensures all modules are in the registry)
    router.post('/modules/sync', asyncHandler(async (req, res) => {
        const allModules = [
            { name: 'storefront', display_name: 'Storefront', version: '1.0.0', description: 'Storefront themes, pages, navigation, and SEO' },
            { name: 'products', display_name: 'Products', version: '1.0.0', description: 'Product catalog with variants, categories, and media' },
            { name: 'cart', display_name: 'Shopping Cart', version: '1.0.0', description: 'Shopping cart for guest and authenticated users' },
            { name: 'checkout', display_name: 'Checkout', version: '1.0.0', description: 'Checkout flow and validation' },
            { name: 'orders', display_name: 'Orders', version: '1.0.0', description: 'Order lifecycle management' },
            { name: 'page_builder', display_name: 'Page Builder', version: '1.0.0', description: 'CMS page builder with widgets, layouts, and themes' },
            { name: 'payments', display_name: 'Payments', version: '1.0.0', description: 'Payment processing and webhooks' },
            { name: 'shipping', display_name: 'Shipping', version: '1.0.0', description: 'Shipping zones, rates, and tracking' },
            { name: 'marketing', display_name: 'Marketing', version: '1.0.0', description: 'Promotions, campaigns, and coupons' },
            { name: 'analytics', display_name: 'Analytics', version: '1.0.0', description: 'Metrics, reporting, and funnel tracking' },
            { name: 'search', display_name: 'Search', version: '1.0.0', description: 'Advanced search with filters, autocomplete, and analytics' },
        ];

        const synced = [];
        for (const mod of allModules) {
            await query(`
                INSERT INTO modules (name, display_name, version, is_core, description)
                VALUES ($1, $2, $3, false, $4)
                ON CONFLICT (name) DO UPDATE 
                SET display_name = EXCLUDED.display_name,
                    description = EXCLUDED.description,
                    version = EXCLUDED.version
            `, [mod.name, mod.display_name, mod.version, mod.description]);
            synced.push(mod.name);
        }

        res.json({ 
            success: true, 
            message: `Synced ${synced.length} modules`,
            modules: synced
        });
    }));

    // Get modules for a tenant (convenience endpoint)
    router.get('/tenants/:tenantId/modules', asyncHandler(async (req, res) => {
        // Get all available modules
        const allModulesRes = await query(`SELECT * FROM modules WHERE is_core = false ORDER BY name`);
        
        // Get enabled modules for this tenant
        const enabledRes = await query(
            `SELECT * FROM tenant_modules WHERE tenant_id = $1 AND is_enabled = true`,
            [req.params.tenantId]
        );

        // Map enabled status
        const modules = allModulesRes.rows.map(mod => {
            const isEnabled = enabledRes.rows.some(em => em.module_name === mod.name);
            return { 
                ...mod, 
                is_enabled: isEnabled,
                enabled_at: enabledRes.rows.find(em => em.module_name === mod.name)?.enabled_at || null
            };
        });

        res.json({ success: true, modules });
    }));

    // Toggle module for tenant (super admin)
    router.post('/tenants/:tenantId/modules/:moduleName/toggle', asyncHandler(async (req, res) => {
        const { is_enabled } = req.body;
        const { setModuleAccessCache } = require('../config/redis');

        let sql;
        if (is_enabled) {
            sql = `
                INSERT INTO tenant_modules (tenant_id, module_name, is_enabled)
                VALUES ($1, $2, true)
                ON CONFLICT (tenant_id, module_name) 
                DO UPDATE SET is_enabled = true, enabled_at = NOW()
                RETURNING *
            `;
        } else {
            sql = `
                UPDATE tenant_modules 
                SET is_enabled = false, disabled_at = NOW()
                WHERE tenant_id = $1 AND module_name = $2
                RETURNING *
            `;
        }

        const result = await query(sql, [req.params.tenantId, req.params.moduleName]);

        // Update cache
        await setModuleAccessCache(req.params.tenantId, req.params.moduleName, is_enabled);

        res.json({ 
            success: true, 
            message: `Module ${is_enabled ? 'enabled' : 'disabled'}`,
            module: result.rows[0] || { module_name: req.params.moduleName, is_enabled }
        });
    }));

    app.use('/admin', router);
    console.log('✓ Super Admin panel initialized at /admin');
}

module.exports = { bootstrap };
