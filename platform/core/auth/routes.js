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
const passport = require('./passport');

// Helper to set HTTP-Only cookies
function setTokenCookies(res, tokens) {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieOpts = { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax' };
    if (tokens.accessToken) {
        res.cookie('accessToken', tokens.accessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
    }
    if (tokens.refreshToken) {
        res.cookie('refreshToken', tokens.refreshToken, { ...cookieOpts, maxAge: 7 * 24 * 60 * 60 * 1000 });
    }
}

function clearTokenCookies(res) {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieOpts = { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax' };
    res.clearCookie('accessToken', cookieOpts);
    res.clearCookie('refreshToken', cookieOpts);
}

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

        // Step 2: Seed Default Roles & Permissions
        console.log('[Signup] Step 2: Seeding Roles...');
        const RoleService = require('../roles/services/RoleService');
        await RoleService.seedDefaultRoles(tenant.id);

        // Step 3: Ensure Functional Admin Account (admin@subdomain.com) - The "Owner"
        const adminEmail = `admin@${value.subdomain}.com`;
        console.log(`[Signup] Step 3: Ensuring Functional Admin (${adminEmail})...`);

        let adminUser = null;
        try {
            // Try to create the admin user
            adminUser = await AuthService.register(tenant.id, {
                email: adminEmail,
                password: '123456789', // Default password for internal admin
                first_name: 'Store',
                last_name: 'Admin',
            });
            console.log('✓ Functional Admin created');
        } catch (adminErr) {
            console.warn('⚠️ Functional admin creation note (might already exist):', adminErr.message);
            // If creation failed, try to find the existing user
            try {
                // Dynamically import User model to avoid circular checks if not available
                const User = require('./models/User');
                adminUser = await User.findByEmail(tenant.id, adminEmail);
                if (adminUser) console.log('✓ Functional Admin found (already existed)');
            } catch (findErr) {
                console.error('❌ Failed to find existing functional admin:', findErr);
            }
        }

        // Assign 'Admin' role to the functional admin (whether new or existing)
        if (adminUser) {
            try {
                await RoleService.assignRoleToUser(tenant.id, adminUser.id, 'Admin');
                console.log('✓ Functional Admin assigned Admin role');
            } catch (roleErr) {
                console.error('❌ Failed to assign Admin role to functional admin:', roleErr);
            }
        } else {
            console.error('❌ Could not find or create functional admin user. Role assignment skipped.');
        }

        // Step 4: Create Personal User Account (The Signup User)
        console.log('[Signup] Step 4: Creating Personal User...');
        const user = await AuthService.register(tenant.id, {
            email: value.email,
            password: value.password,
            first_name: value.name,
        });
        console.log('[Signup] User created:', user.id, user.email);

        // Step 5: Assign Store Manager Role to Personal User
        await RoleService.assignRoleToUser(tenant.id, user.id, 'Store Manager');
        console.log('✓ Personal User assigned Store Manager role');

        // Step 6: Generate tokens and auto-login as Personal User
        console.log('[Signup] Step 6: Generating tokens...');
        const tokens = await AuthService.login(tenant.id, value.email, value.password);
        console.log('[Signup] Signup complete, user logged in');

        // Set HTTP-Only cookies
        setTokenCookies(res, tokens);

        res.status(201).json({
            success: true,
            message: 'Account created successfully',
            tenant: {
                id: tenant.id,
                name: tenant.name,
                subdomain: tenant.subdomain,
            },
            token: tokens.accessToken,
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

        // Set HTTP-Only cookies
        setTokenCookies(res, result);

        res.json({
            success: true,
            message: 'Login successful',
            token: result.accessToken,  // Keep for backwards compatibility if needed
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
        const { tenantId } = req;
        // Check cookie first, fallback to body
        const tokenToRefresh = req.cookies?.refreshToken || value.refreshToken;
        
        if (!tokenToRefresh) {
            return res.status(400).json({ error: 'ValidationError', message: 'Refresh token required' });
        }

        const tokens = await AuthService.refreshAccessToken(tokenToRefresh, tenantId);

        // Set new HTTP-Only cookies
        setTokenCookies(res, tokens);

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
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (refreshToken) {
        await AuthService.logout(tenantId, user.id, refreshToken);
    }

    clearTokenCookies(res);

    res.json({
        success: true,
        message: 'Logged out successfully',
    });
}));

/**
 * GET /auth/google
 * Initiate Google OAuth login
 */
router.get('/google', (req, res, next) => {
    const tenantId = req.query.tenantId;
    if (!tenantId) {
        return res.status(400).json({ error: 'TenantRequired', message: 'tenantId query parameter is required' });
    }
    
    // Determine where to send the user back to
    let returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    if (req.query.returnUrl) {
        returnUrl = req.query.returnUrl;
    } else if (req.headers.referer) {
        try {
            const url = new URL(req.headers.referer);
            returnUrl = url.origin;
        } catch (e) {}
    }

    // Encode both into state
    const stateObj = { t: tenantId, r: returnUrl };
    const stateStr = Buffer.from(JSON.stringify(stateObj)).toString('base64');

    passport.authenticate('google', { 
        scope: [
            'profile', 
            'email',
            'https://www.googleapis.com/auth/user.birthday.read',
            'https://www.googleapis.com/auth/user.gender.read'
        ], 
        state: stateStr 
    })(req, res, next);
});

/**
 * GET /auth/google/callback
 * Google OAuth callback
 */
router.get('/google/callback', (req, res, next) => {
    // Decode frontendUrl from state early so failureRedirect can point there
    let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    try {
        const stateStr = req.query.state;
        if (stateStr) {
            const decoded = JSON.parse(Buffer.from(stateStr, 'base64').toString('utf8'));
            if (decoded.r) frontendUrl = decoded.r;
        }
    } catch (e) { /* use default */ }

    passport.authenticate('google', { session: false }, async (err, user, info) => {
        if (err || !user) {
            console.error('[OAuth] Passport authentication failed:', err || info);
            return res.redirect(`${frontendUrl}/login?error=auth_failed`);
        }

        const stateStr = req.query.state;
        let tenantId = null;

        try {
            const decodedState = JSON.parse(Buffer.from(stateStr, 'base64').toString('utf8'));
            tenantId = decodedState.t;
            if (decodedState.r) frontendUrl = decodedState.r;
        } catch (e) {
            tenantId = stateStr;
        }

        if (!tenantId) {
            console.error('[OAuth] No tenantId found in state');
            return res.redirect(`${frontendUrl}/login?error=auth_failed`);
        }

        try {
            const tokens = await AuthService.googleLogin(tenantId, user);

            // Set HTTP-Only cookies
            setTokenCookies(res, tokens);

            // Redirect back to dynamic frontendUrl
            res.redirect(`${frontendUrl}/auth/callback?success=true`);
        } catch (loginErr) {
            console.error('[OAuth] Google login failed:', loginErr);
            res.redirect(`${frontendUrl}/login?error=oauth_failed`);
        }
    })(req, res, next);
});

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
 * POST /auth/resend-verification
 * Resend verification email
 */
router.post('/resend-verification', asyncHandler(async (req, res) => {
    const { tenantId } = req;
    const { email } = req.body;

    if (!tenantId) {
        return res.status(400).json({ error: 'TenantRequired', message: 'Tenant context is required' });
    }

    if (!email) {
        return res.status(400).json({ error: 'ValidationError', message: 'Email is required' });
    }

    try {
        await AuthService.resendVerification(tenantId, email);
        res.json({ success: true, message: 'Verification email resent successfully' });
    } catch (err) {
        res.status(400).json({ error: 'ResendFailed', message: err.message });
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

/**
 * GET /auth/me/verification-status
 * Returns the user's current verification tier statuses
 */
router.get('/me/verification-status', authenticate, asyncHandler(async (req, res) => {
    const { user } = req;

    res.json({
        success: true,
        verification: {
            tier1: {
                label: 'Email Verification',
                verified: !!user.email_verified,
            },
            tier2: {
                label: 'Identity Verification (KYC)',
                status: user.kyc_status || 'none',
                submitted_at: user.kyc_submitted_at || null,
                reviewed_at: user.kyc_reviewed_at || null,
                rejection_reason: user.kyc_status === 'rejected' ? user.kyc_rejection_reason : null,
            },
            tier3: {
                label: 'Business Verification (KYB)',
                status: user.kyb_status || 'none',
                submitted_at: user.kyb_submitted_at || null,
                reviewed_at: user.kyb_reviewed_at || null,
                rejection_reason: user.kyb_status === 'rejected' ? user.kyb_rejection_reason : null,
                // KYB is locked until KYC is approved
                locked: user.kyc_status !== 'approved',
            },
        }
    });
}));

/**
 * POST /auth/me/kyc/submit
 * User submits their KYC document and liveness data
 * Sets kyc_status = 'submitted' for admin review
 */
router.post('/me/kyc/submit', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { document_url, liveness_url } = req.body;

    if (!document_url) {
        return res.status(400).json({
            error: 'ValidationError',
            message: 'document_url is required'
        });
    }

    // Can only submit if none or rejected
    if (user.kyc_status === 'approved') {
        return res.status(400).json({
            error: 'AlreadyVerified',
            message: 'Your KYC has already been approved'
        });
    }
    if (user.kyc_status === 'submitted') {
        return res.status(400).json({
            error: 'AlreadySubmitted',
            message: 'Your KYC is already under review'
        });
    }

    const User = require('./models/User');
    const updatedUser = await User.update(tenantId, user.id, {
        kyc_status: 'submitted',
        kyc_document_url: document_url,
        kyc_liveness_url: liveness_url || null,
        kyc_submitted_at: new Date(),
        kyc_reviewed_at: null,
        kyc_reviewed_by: null,
        kyc_rejection_reason: null,
    });

    // Emit event for notifications
    const eventBus = require('../../events/EventBus');
    eventBus.emitEvent('user.kyc.submitted', {
        tenantId,
        userId: user.id,
        userEmail: user.email,
    });

    res.json({
        success: true,
        message: 'KYC documents submitted successfully. You will be notified once reviewed.',
        kyc_status: 'submitted'
    });
}));

/**
 * POST /auth/me/kyb/submit
 * User submits their KYB business document
 * Requires KYC to be approved first
 */
router.post('/me/kyb/submit', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { document_url } = req.body;

    if (!document_url) {
        return res.status(400).json({
            error: 'ValidationError',
            message: 'document_url is required'
        });
    }

    // KYB requires KYC to be approved first
    if (user.kyc_status !== 'approved') {
        return res.status(403).json({
            error: 'KYCRequired',
            message: 'You must complete Identity Verification (KYC) before applying for Business Verification (KYB)'
        });
    }

    if (user.kyb_status === 'approved') {
        return res.status(400).json({
            error: 'AlreadyVerified',
            message: 'Your KYB has already been approved'
        });
    }
    if (user.kyb_status === 'submitted') {
        return res.status(400).json({
            error: 'AlreadySubmitted',
            message: 'Your KYB is already under review'
        });
    }

    const User = require('./models/User');
    await User.update(tenantId, user.id, {
        kyb_status: 'submitted',
        kyb_document_url: document_url,
        kyb_submitted_at: new Date(),
        kyb_reviewed_at: null,
        kyb_reviewed_by: null,
        kyb_rejection_reason: null,
    });

    const eventBus = require('../../events/EventBus');
    eventBus.emitEvent('user.kyb.submitted', {
        tenantId,
        userId: user.id,
        userEmail: user.email,
    });

    res.json({
        success: true,
        message: 'KYB documents submitted successfully. You will be notified once reviewed.',
        kyb_status: 'submitted'
    });
}));

module.exports = router;

