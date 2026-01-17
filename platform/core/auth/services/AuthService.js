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

        // Generate email verification token
        const emailVerificationToken = uuidv4();

        // Create user
        const user = await User.create(tenantId, {
            email: userData.email,
            password_hash: passwordHash,
            first_name: userData.first_name,
            last_name: userData.last_name,
            email_verification_token: emailVerificationToken,
        });

        // PRINCIPLE: All inter-module communication is event-based
        // Emit event for other modules (e.g., email service to send verification)
        eventBus.emitEvent('user.registered', {
            tenantId,
            userId: user.id,
            email: user.email,
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
        // Emit event
        eventBus.emitEvent('user.logged_in', {
            tenantId,
            userId: user.id,
            email: user.email,
        });

        // Get Permissions (add RBAC context)
        const permissions = await Permission.getUserPermissions(tenantId, user.id);

        return {
            user: this._sanitizeUser(user),
            accessToken,
            refreshToken,
            permissions,
        };
    }

    /**
     * Refresh access token
     */
    static async refreshAccessToken(refreshTokenString) {
        // Verify refresh token
        const isValid = await RefreshToken.isValid(refreshTokenString);
        if (!isValid) {
            throw new Error('Invalid or expired refresh token');
        }

        // Get token from database
        const tokenRecord = await RefreshToken.findByToken(refreshTokenString);
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
        const result = await User.findAll(tenantId, { limit: 1000 });
        const user = result.find(u =>
            u.password_reset_token === resetToken &&
            u.password_reset_expires &&
            new Date(u.password_reset_expires) > new Date()
        );

        if (!user) {
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
        const result = await User.findAll(tenantId, { limit: 1000 });
        const user = result.find(u => u.email_verification_token === token);

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

        // Handle password update
        if (updates.password) {
            allowedUpdates.password_hash = await bcrypt.hash(
                updates.password,
                parseInt(process.env.BCRYPT_ROUNDS) || 10
            );
        }

        // Use User.update
        const updatedUser = await User.update(tenantId, userId, allowedUpdates);
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
