/**
 * Authentication Routes
 * 
 * PRINCIPLE: Multi-tenant by default - all routes require tenant context
 * PRINCIPLE: Modules do not import other modules
 */

const express = require('express');
const Joi = require('joi');
const AuthService = require('./services/AuthService');
const { authenticate } = require('./middleware/authenticate');
const authorize = require('../roles/middleware/authorize');
const { asyncHandler } = require('../../../middleware/errorHandler');

const router = express.Router();

/**
 * Validation schemas
 */
const registerSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    first_name: Joi.string().optional(),
    last_name: Joi.string().optional(),
});

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
});

const refreshSchema = Joi.object({
    refreshToken: Joi.string().required(),
});

const forgotPasswordSchema = Joi.object({
    email: Joi.string().email().required(),
});

const resetPasswordSchema = Joi.object({
    token: Joi.string().required(),
    newPassword: Joi.string().min(8).required(),
});

/**
 * POST /auth/signup
 * Combined tenant + user signup (for new companies)
 */
router.post('/signup', asyncHandler(async (req, res) => {
    const Joi = require('joi');
    const TenantService = require('../tenants/services/TenantService');

    const signupSchema = Joi.object({
        companyName: Joi.string().required(),
        subdomain: Joi.string().pattern(/^[a-z0-9-]+$/).required(),
        name: Joi.string().required(),
        email: Joi.string().email().required(),
        password: Joi.string().min(8).required(),
    });

    const { error, value } = signupSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            error: 'ValidationError',
            message: error.details[0].message,
        });
    }

    console.log('[Signup] Starting signup for:', value.email, 'subdomain:', value.subdomain);

    try {
        // Step 1: Create the tenant
        console.log('[Signup] Step 1: Creating tenant...');
        const tenant = await TenantService.createTenant({
            name: value.companyName,
            subdomain: value.subdomain,
        });
        console.log('[Signup] Tenant created:', tenant.id);

        // Step 2: Create the first user (admin) for this tenant
        console.log('[Signup] Step 2: Creating user for tenant:', tenant.id);
        const user = await AuthService.register(tenant.id, {
            email: value.email,
            password: value.password,
            first_name: value.name,
        });
        console.log('[Signup] User created:', user.id, user.email);

        // Step 3: Assign admin role to the first user (if roles exist)
        // This would be done via the roles module, but skipping for now

        // Step 4: Generate tokens and auto-login
        console.log('[Signup] Step 4: Generating tokens...');
        const tokens = await AuthService.login(tenant.id, value.email, value.password);
        console.log('[Signup] Signup complete, user logged in');

        res.status(201).json({
            success: true,
            message: 'Account created successfully',
            tenant: {
                id: tenant.id,
                name: tenant.name,
                subdomain: tenant.subdomain,
            },
            token: tokens.accessToken,  // Match login response format
            user: tokens.user,
            refreshToken: tokens.refreshToken,
        });
    } catch (err) {
        console.error('[Signup] Signup failed:', err.message);
        console.error('[Signup] Stack:', err.stack);
        res.status(400).json({
            error: 'SignupFailed',
            message: err.message,
        });
    }
}));

/**
 * POST /auth/register
 * Register a new user
 */
router.post('/register', asyncHandler(async (req, res) => {
    const { tenantId } = req;

    if (!tenantId) {
        return res.status(400).json({
            error: 'TenantRequired',
            message: 'Tenant context is required for registration',
        });
    }

    // Validate input
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            error: 'ValidationError',
            message: error.details[0].message,
        });
    }

    try {
        const user = await AuthService.register(tenantId, value);

        res.status(201).json({
            success: true,
            message: 'User registered successfully. Please verify your email.',
            user,
        });
    } catch (err) {
        res.status(400).json({
            error: 'RegistrationFailed',
            message: err.message,
        });
    }
}));

/**
 * POST /auth/login
 * Login user
 */
router.post('/login', asyncHandler(async (req, res) => {
    let { tenantId } = req;

    console.log('[Login] Request received, tenantId from middleware:', tenantId);

    // Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            error: 'ValidationError',
            message: error.details[0].message,
        });
    }

    console.log('[Login] Email:', value.email);

    // If no tenant context (e.g., Admin Dashboard login), find user's tenant by email
    if (!tenantId) {
        console.log('[Login] No tenant context, looking up tenant by email...');
        const User = require('./models/User');
        const { query } = require('../../../config/database');

        // Search for user across all tenants
        const result = await query(
            `SELECT tenant_id FROM users WHERE email = $1 AND status = 'active' LIMIT 1`,
            [value.email]
        );

        console.log('[Login] Tenant lookup result:', result.rows);

        if (result.rows.length === 0) {
            console.log('[Login] No user found with email:', value.email);
            return res.status(401).json({
                error: 'LoginFailed',
                message: 'Invalid email or password',
            });
        }

        tenantId = result.rows[0].tenant_id;
        console.log('[Login] Found tenantId:', tenantId);
    }

    try {
        console.log('[Login] Attempting login for tenant:', tenantId);
        const result = await AuthService.login(tenantId, value.email, value.password);

        console.log('[Login] Login successful, user:', result.user.email);

        res.json({
            success: true,
            message: 'Login successful',
            token: result.accessToken,  // Match signup response
            ...result,
        });
    } catch (err) {
        console.error('[Login] Login failed:', err.message);
        res.status(401).json({
            error: 'LoginFailed',
            message: err.message,
        });
    }
}));

/**
 * POST /auth/refresh
 * Refresh access token
 */
router.post('/refresh', asyncHandler(async (req, res) => {
    // Validate input
    const { error, value } = refreshSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            error: 'ValidationError',
            message: error.details[0].message,
        });
    }

    try {
        const tokens = await AuthService.refreshAccessToken(value.refreshToken);

        res.json({
            success: true,
            ...tokens,
        });
    } catch (err) {
        res.status(401).json({
            error: 'RefreshFailed',
            message: err.message,
        });
    }
}));

/**
 * POST /auth/logout
 * Logout user
 */
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { refreshToken } = req.body;

    await AuthService.logout(tenantId, user.id, refreshToken);

    res.json({
        success: true,
        message: 'Logged out successfully',
    });
}));

/**
 * POST /auth/forgot-password
 * Initiate password reset
 */
router.post('/forgot-password', asyncHandler(async (req, res) => {
    const { tenantId } = req;

    if (!tenantId) {
        return res.status(400).json({
            error: 'TenantRequired',
            message: 'Tenant context is required',
        });
    }

    const { error, value } = forgotPasswordSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            error: 'ValidationError',
            message: error.details[0].message,
        });
    }

    await AuthService.forgotPassword(tenantId, value.email);

    // Always return success to prevent email enumeration
    res.json({
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.',
    });
}));

/**
 * POST /auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', asyncHandler(async (req, res) => {
    const { tenantId } = req;

    if (!tenantId) {
        return res.status(400).json({
            error: 'TenantRequired',
            message: 'Tenant context is required',
        });
    }

    const { error, value } = resetPasswordSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            error: 'ValidationError',
            message: error.details[0].message,
        });
    }

    try {
        await AuthService.resetPassword(tenantId, value.token, value.newPassword);

        res.json({
            success: true,
            message: 'Password reset successfully. You can now login with your new password.',
        });
    } catch (err) {
        res.status(400).json({
            error: 'ResetFailed',
            message: err.message,
        });
    }
}));

/**
 * GET /auth/verify-email/:token
 * Verify email address
 */
router.get('/verify-email/:token', asyncHandler(async (req, res) => {
    const { tenantId } = req;
    const { token } = req.params;

    if (!tenantId) {
        return res.status(400).json({
            error: 'TenantRequired',
            message: 'Tenant context is required',
        });
    }

    try {
        await AuthService.verifyEmail(tenantId, token);

        res.json({
            success: true,
            message: 'Email verified successfully',
        });
    } catch (err) {
        res.status(400).json({
            error: 'VerificationFailed',
            message: err.message,
        });
    }
}));

/**
 * GET /auth/me
 * Get current user (protected route)
 */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
    res.json({
        success: true,
        user: req.user,
    });
}));

/**
 * PATCH /auth/me
 * Update current user profile
 */
router.patch('/me', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;

    const updatedUser = await AuthService.updateUser(tenantId, user.id, req.body);

    res.json({
        success: true,
        user: updatedUser
    });
}));

/**
 * GET /auth/users
 * List users (protected, admin/manager only)
 */
router.get('/users', authenticate, authorize('users.view'), asyncHandler(async (req, res) => {
    const { tenantId } = req;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';

    const result = await AuthService.listUsers(tenantId, {
        page,
        perPage: limit,
        search
    });

    res.json({
        success: true,
        data: result.data,
        pagination: result.pagination
    });
}));

/**
 * GET /auth/users/:id
 * Get user details
 */
router.get('/users/:id', authenticate, authorize('users.view'), asyncHandler(async (req, res) => {
    const { tenantId } = req;
    const { id } = req.params;

    const user = await AuthService.getUser(tenantId, id);

    if (!user) {
        return res.status(404).json({
            error: 'NotFound',
            message: 'User not found'
        });
    }

    res.json({
        success: true,
        user
    });
}));

module.exports = router;
