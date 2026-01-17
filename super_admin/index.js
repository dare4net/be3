/**
 * Super Admin Module
 * Platform-wide administration
 * NOT tenant-scoped - operates at platform level
 */

const express = require('express');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

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

    app.use('/admin', router);
    console.log('✓ Super Admin panel initialized at /admin');
}

module.exports = { bootstrap };
