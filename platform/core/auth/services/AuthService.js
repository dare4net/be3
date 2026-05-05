/**
 * Authentication Service
 * 
 * PRINCIPLE: Multi-tenant by default
 * PRINCIPLE: Modules do not import other modules (uses event bus for communication)
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const Permission = require('../../roles/models/Permission');
const eventBus = require('../../../events/EventBus');

class AuthService {
    /**
     * Register a new user
     */
    static async register(tenantId, userData) {
        // Check if user already exists
        const existingUser = await User.findByEmail(tenantId, userData.email);
        if (existingUser) {
            throw new Error('User with this email already exists');
        }

        // Hash password
        const passwordHash = await bcrypt.hash(
            userData.password,
            parseInt(process.env.BCRYPT_ROUNDS) || 10
        );

        // Generate email verification token with 24h expiry
        const emailVerificationToken = uuidv4();
        const emailVerificationExpires = new Date();
        emailVerificationExpires.setHours(emailVerificationExpires.getHours() + 24);

        // Create user
        const user = await User.create(tenantId, {
            email: userData.email,
            password_hash: passwordHash,
            first_name: userData.first_name,
            last_name: userData.last_name,
            email_verification_token: emailVerificationToken,
            email_verification_expires: emailVerificationExpires,
        });

        // PRINCIPLE: All inter-module communication is event-based
        // Emit event for other modules (e.g., email service to send verification)
        eventBus.emitEvent('user.registered', {
            tenantId,
            userId: user.id,
            email: user.email,
            firstName: user.first_name,
            emailVerificationToken,
        });

        // Return user without sensitive data
        return this._sanitizeUser(user);
    }

    /**
     * Login user
     */
    static async login(tenantId, email, password) {
        // Find user
        const user = await User.findByEmail(tenantId, email);
        if (!user) {
            throw new Error('Invalid email or password');
        }

        // Check if user is active
        if (user.status !== 'active') {
            throw new Error('Account is suspended or deleted');
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            throw new Error('Invalid email or password');
        }

        // Update last login
        await User.updateLastLogin(tenantId, user.id);

        // Generate tokens
        const accessToken = this._generateAccessToken(user);
        const refreshToken = this._generateRefreshToken(user);

        // Store refresh token
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
        await RefreshToken.create(tenantId, user.id, refreshToken, expiresAt);

        // Emit event
        eventBus.emitEvent('user.logged_in', {
            tenantId,
            userId: user.id,
            email: user.email,
        });

        // Get comprehensive permission context (permissions, roles, category access)
        const PermissionService = require('../../roles/services/PermissionService');
        const permissionContext = await PermissionService.getUserPermissionContext(tenantId, user.id);

        return {
            user: this._sanitizeUser(user),
            accessToken,
            refreshToken,
            permissions: permissionContext.permissions,
            roles: permissionContext.roles,
            allowedCategories: permissionContext.categoryAccess.allowedCategories,
            hasUnrestrictedCategoryAccess: permissionContext.categoryAccess.hasUnrestrictedAccess
        };
    }

    /**
     * Login or Register user via Google OAuth
     */
    static async googleLogin(tenantId, profile) {
        if (!tenantId) {
            throw new Error('Tenant ID is required for OAuth login');
        }

        const email = profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null;
        if (!email) {
            throw new Error('Google account must have an email address');
        }

        const googleId = profile.id;
        const firstName = profile.name ? profile.name.givenName : '';
        const lastName = profile.name ? profile.name.familyName : '';
        const avatarUrl = profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null;
        
        let gender = null;
        let dob = null;
        if (profile._json) {
            if (profile._json.gender) gender = profile._json.gender;
            if (profile._json.birthday) dob = profile._json.birthday;
        }

        // 1. Try to find user by Google ID
        let user = await User.findByGoogleId(tenantId, googleId);

        if (!user) {
            // 2. Try to find user by Email
            user = await User.findByEmail(tenantId, email);

            if (user) {
                // Link Google ID to existing account and backfill missing data
                const updates = { google_id: googleId };
                if (!user.avatar_url && avatarUrl) updates.avatar_url = avatarUrl;
                if (!user.gender && gender) updates.gender = gender;
                if (!user.dob && dob) updates.dob = dob;

                await User.update(tenantId, user.id, updates);
                user.google_id = googleId;
                if (updates.avatar_url) user.avatar_url = avatarUrl;
                if (updates.gender) user.gender = gender;
                if (updates.dob) user.dob = dob;
            } else {
                // 3. Create new user
                user = await User.create(tenantId, {
                    email: email,
                    google_id: googleId,
                    first_name: firstName,
                    last_name: lastName,
                    avatar_url: avatarUrl,
                    gender: gender,
                    dob: dob,
                    email_verification_token: null, // OAuth implies email is verified
                });
                
                // Assign default role (e.g., Customer)
                const RoleService = require('../../roles/services/RoleService');
                try {
                    await RoleService.assignRoleToUser(tenantId, user.id, 'Customer');
                } catch (err) {
                    console.error('Failed to assign default role to OAuth user:', err);
                }
            }
        }

        // Check if user is active
        if (user.status !== 'active') {
            throw new Error('Account is suspended or deleted');
        }

        // Update last login
        await User.updateLastLogin(tenantId, user.id);

        // Generate tokens
        const accessToken = this._generateAccessToken(user);
        const newRefreshToken = this._generateRefreshToken(user);

        // Store refresh token
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await RefreshToken.create(tenantId, user.id, newRefreshToken, expiresAt);

        // Emit event
        eventBus.emitEvent('user.logged_in', {
            tenantId,
            userId: user.id,
            email: user.email,
            method: 'google'
        });

        // Get comprehensive permission context
        const PermissionService = require('../../roles/services/PermissionService');
        const permissionContext = await PermissionService.getUserPermissionContext(tenantId, user.id);

        return {
            user: this._sanitizeUser(user),
            accessToken,
            refreshToken: newRefreshToken,
            permissions: permissionContext.permissions,
            roles: permissionContext.roles,
            allowedCategories: permissionContext.categoryAccess.allowedCategories,
            hasUnrestrictedCategoryAccess: permissionContext.categoryAccess.hasUnrestrictedAccess
        };
    }

    /**
     * Refresh access token
     */
    static async refreshAccessToken(refreshTokenString, tenantId) {
        const isValid = await RefreshToken.isValid(refreshTokenString, tenantId);
        if (!isValid) {
            console.error(`[AuthService] Refresh token invalid or expired check failed (Tenant: ${tenantId})`);
            throw new Error('Invalid or expired refresh token');
        }

        // Get token from database
        const tokenRecord = await RefreshToken.findByToken(refreshTokenString, tenantId);
        if (!tokenRecord) {
            throw new Error('Refresh token not found');
        }

        // Get user
        const user = await User.findById(tokenRecord.tenant_id, tokenRecord.user_id);
        if (!user || user.status !== 'active') {
            throw new Error('User not found or inactive');
        }

        // Generate new tokens (token rotation)
        const newAccessToken = this._generateAccessToken(user);
        const newRefreshToken = this._generateRefreshToken(user);

        // Revoke old refresh token and create new one
        await RefreshToken.revoke(tokenRecord.id, newRefreshToken);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await RefreshToken.create(tokenRecord.tenant_id, user.id, newRefreshToken, expiresAt);

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        };
    }

    /**
     * Logout user
     */
    static async logout(tenantId, userId, refreshTokenString) {
        // Revoke refresh token
        const tokenRecord = await RefreshToken.findByToken(refreshTokenString);
        if (tokenRecord) {
            await RefreshToken.revoke(tokenRecord.id);
        }

        // Emit event
        eventBus.emitEvent('user.logged_out', {
            tenantId,
            userId,
        });

        return true;
    }

    /**
     * Initiate password reset
     */
    static async forgotPassword(tenantId, email) {
        const user = await User.findByEmail(tenantId, email);
        if (!user) {
            // Don't reveal if user exists
            return true;
        }

        // Generate reset token
        const resetToken = uuidv4();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour

        await User.setPasswordResetToken(tenantId, user.id, resetToken, expiresAt);

        // Emit event for email service
        eventBus.emitEvent('password.reset_requested', {
            tenantId,
            userId: user.id,
            email: user.email,
            resetToken,
        });

        return true;
    }

    /**
     * Reset password with token
     */
    static async resetPassword(tenantId, resetToken, newPassword) {
        // Find user by reset token
        const user = await User.findByResetToken(tenantId, resetToken);

        if (!user || !user.password_reset_expires || new Date(user.password_reset_expires) < new Date()) {
            throw new Error('Invalid or expired reset token');
        }

        // Hash new password
        const passwordHash = await bcrypt.hash(
            newPassword,
            parseInt(process.env.BCRYPT_ROUNDS) || 10
        );

        // Update password
        await User.updatePassword(tenantId, user.id, passwordHash);

        // Revoke all refresh tokens for security
        await RefreshToken.revokeAllForUser(tenantId, user.id);

        // Emit event
        eventBus.emitEvent('password.reset_completed', {
            tenantId,
            userId: user.id,
        });

        return true;
    }

    /**
     * Verify email
     */
    static async verifyEmail(tenantId, token) {
        const user = await User.findByVerificationToken(tenantId, token);

        if (!user) {
            throw new Error('Invalid verification token');
        }

        await User.verifyEmail(tenantId, user.id);

        // Emit event
        eventBus.emitEvent('email.verified', {
            tenantId,
            userId: user.id,
            email: user.email,
        });

        return true;
    }

    /**
     * Resend verification email
     */
    static async resendVerification(tenantId, email) {
        const user = await User.findByEmail(tenantId, email);
        if (!user) {
            throw new Error('User not found');
        }

        if (user.email_verified) {
            throw new Error('Email is already verified');
        }

        // Generate new token with 24h expiry
        const token = uuidv4();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await User.setEmailVerificationToken(tenantId, user.id, token, expiresAt);

        // Emit event for mail service
        eventBus.emitEvent('user.registered', {
            tenantId,
            userId: user.id,
            email: user.email,
            firstName: user.first_name,
            emailVerificationToken: token,
        });

        return true;
    }

    /**
     * List users (paginated)
     */
    static async listUsers(tenantId, options) {
        const result = await User.findAllPaginated(tenantId, options);
        // Sanitize users in the list
        result.data = result.data.map(user => this._sanitizeUser(user));
        return result;
    }

    /**
     * Get user details
     */
    static async getUser(tenantId, userId) {
        const user = await User.findById(tenantId, userId);
        if (!user) return null;

        // Fetch roles
        const Role = require('../../roles/models/Role');
        const roles = await Role.getUserRoles(tenantId, userId);
        user.roles = roles;

        return this._sanitizeUser(user);
    }

    /**
     * Update user details
     */
    static async updateUser(tenantId, userId, updates) {
        const allowedUpdates = {};

        if (updates.first_name !== undefined) allowedUpdates.first_name = updates.first_name;
        if (updates.last_name !== undefined) allowedUpdates.last_name = updates.last_name;
        if (updates.business_name !== undefined) allowedUpdates.business_name = updates.business_name;
        if (updates.business_thumbnail !== undefined) allowedUpdates.business_thumbnail = updates.business_thumbnail;
        if (updates.business_backdrop !== undefined) allowedUpdates.business_backdrop = updates.business_backdrop;
        if (updates.business_description !== undefined) allowedUpdates.business_description = updates.business_description;
        if (updates.checkout_style !== undefined) allowedUpdates.checkout_style = updates.checkout_style;
        if (updates.whatsapp_phone !== undefined) allowedUpdates.whatsapp_phone = updates.whatsapp_phone;
        if (updates.avatar_url !== undefined) allowedUpdates.avatar_url = updates.avatar_url;
        if (updates.gender !== undefined) allowedUpdates.gender = updates.gender;
        if (updates.dob !== undefined) allowedUpdates.dob = updates.dob;

        // Handle password update
        if (updates.password) {
            allowedUpdates.password_hash = await bcrypt.hash(
                updates.password,
                parseInt(process.env.BCRYPT_ROUNDS) || 10
            );
        }

        // Use User.update
        const updatedUser = await User.update(tenantId, userId, allowedUpdates);

        // Hook: Update vendor context if business_name, description, thumbnail or business_backdrop changed
        if (updates.business_name !== undefined || updates.business_description !== undefined || updates.business_thumbnail !== undefined || updates.business_backdrop !== undefined) {
            const eventBus = require('../../../events/EventBus');
            eventBus.emitEvent('user.profile_updated', {
                tenantId,
                userId,
                businessName: updates.business_name,
                businessDescription: updates.business_description,
                businessThumbnail: updates.business_thumbnail,
                businessBackdrop: updates.business_backdrop
            });
        }

        return this._sanitizeUser(updatedUser);
    }

    /**
     * Generate JWT access token
     */
    static _generateAccessToken(user) {
        const payload = {
            userId: user.id,
            tenantId: user.tenant_id,
            email: user.email,
        };

        return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
            expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m',
        });
    }

    /**
     * Generate refresh token
     */
    static _generateRefreshToken(user) {
        const payload = {
            userId: user.id,
            tenantId: user.tenant_id,
            type: 'refresh',
        };

        return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
            expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d',
        });
    }

    /**
     * Remove sensitive data from user object
     */
    static _sanitizeUser(user) {
        const { password_hash, password_reset_token, email_verification_token, ...sanitized } = user;
        return sanitized;
    }
}

module.exports = AuthService;
